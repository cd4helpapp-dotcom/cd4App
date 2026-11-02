// Connection details for the knowledge scripts. Embeddings are made inside Supabase, so only the service key is needed here.
// The key comes from SUPABASE_SERVICE_ROLE_KEY, or else from the logged-in Supabase CLI. It stays in memory and is never printed.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const fileEnv = () => {
  try {
    return Object.fromEntries(
      fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '')])
    );
  } catch {
    return {};
  }
};

export const SUPABASE_URL = process.env.SUPABASE_URL || fileEnv().EXPO_PUBLIC_SUPABASE_URL;
export let SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const keyFromCli = () => {
  const ref = String(SUPABASE_URL || '').match(/^https:\/\/([^.]+)\./)?.[1];
  if (!ref) return '';
  try {
    const output = execSync(`npx supabase projects api-keys --project-ref ${ref} -o json`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    return JSON.parse(output).find((row) => row.name === 'service_role')?.api_key || '';
  } catch {
    return '';
  }
};

export const requireService = () => {
  if (!SERVICE_KEY) SERVICE_KEY = keyFromCli();
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Could not get the service key. Run `npx supabase login`, or set SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
};

export const embedTexts = async (texts) => {
  const vectors = [];
  for (let i = 0; i < texts.length; i += 64) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/embed-knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ texts: texts.slice(i, i + 64) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) throw new Error(payload.message || `embed-knowledge failed: ${response.status}. Is it deployed?`);
    vectors.push(...payload.embeddings);
  }
  return vectors;
};
