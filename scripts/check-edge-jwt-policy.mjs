#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const configPath = path.join(rootDir, 'supabase', 'config.toml');

const ALLOWED_NO_VERIFY = new Set([
  'chat-agent-ws', // WebSocket auth token is validated inside function (query/header token flow).
  'health-reminders', // Cron/manual-secret path supports non-JWT invocations.
  'security-ops-monitor', // Cron/manual-secret path supports non-JWT invocations.
]);

const parseFunctionConfigs = (rawToml) => {
  const lines = rawToml.split(/\r?\n/);
  const results = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const headerMatch = line.match(/^\[functions\.([^\]]+)\]$/);
    if (headerMatch) {
      if (current) results.push(current);
      current = { name: headerMatch[1], verifyJwt: null };
      continue;
    }

    if (!current) continue;
    const verifyMatch = line.match(/^verify_jwt\s*=\s*(true|false)\s*$/i);
    if (verifyMatch) {
      current.verifyJwt = verifyMatch[1].toLowerCase() === 'true';
    }
  }

  if (current) results.push(current);
  return results;
};

const main = () => {
  if (!fs.existsSync(configPath)) {
    console.error(`[edge-jwt-check] Missing config: ${configPath}`);
    process.exit(1);
  }

  const configRaw = fs.readFileSync(configPath, 'utf8');
  const parsed = parseFunctionConfigs(configRaw);
  const violations = [];

  for (const fn of parsed) {
    if (fn.verifyJwt !== false) continue;
    if (ALLOWED_NO_VERIFY.has(fn.name)) continue;
    violations.push(fn.name);
  }

  if (violations.length > 0) {
    console.error(
      `[edge-jwt-check] verify_jwt=false is not allowed for: ${violations.join(', ')}.\n` +
      `Allowed no-verify list: ${Array.from(ALLOWED_NO_VERIFY).join(', ')}`
    );
    process.exit(1);
  }

  console.log(
    `[edge-jwt-check] OK. no-verify-jwt functions: ` +
    `${Array.from(ALLOWED_NO_VERIFY).join(', ')}`
  );
};

main();
