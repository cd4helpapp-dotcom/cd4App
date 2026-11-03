// Everything for the Play Store build reads .env.prod, and the server functions read .env.server.prod.
//   npm run prod:check    checks both files, showing names only and never values
//   npm run prod:start    runs the app locally on the production settings
//   npm run prod:push     uploads .env.prod to EAS, which builds cannot read from this machine
//   npm run prod:build    checks, uploads and builds the Play Store bundle
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OLD_PROJECT_REF = 'prcpnwectrptrpblmezy';

const readEnv = (file) => {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return null;
  const values = {};
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return values;
};

const check = () => {
  const problems = [];
  const app = readEnv('.env.prod');
  const server = readEnv('.env.server.prod');
  if (!app) problems.push('.env.prod is missing');
  if (!server) problems.push('.env.server.prod is missing');

  if (app) {
    for (const [name, value] of Object.entries(app)) {
      if (!name.startsWith('EXPO_PUBLIC_')) problems.push(`.env.prod: ${name} is not public, so it belongs in .env.server.prod`);
      if (!value) problems.push(`.env.prod: ${name} is empty`);
    }
    if ((app.EXPO_PUBLIC_SUPABASE_URL || '').includes(OLD_PROJECT_REF)) problems.push('.env.prod: EXPO_PUBLIC_SUPABASE_URL still points at the old project');
    if (app.EXPO_PUBLIC_RAZORPAY_KEY_ID && !app.EXPO_PUBLIC_RAZORPAY_KEY_ID.startsWith('rzp_live_')) problems.push('.env.prod: EXPO_PUBLIC_RAZORPAY_KEY_ID is not a live key');
    if (app.EXPO_PUBLIC_AGENT_WS_FIRST !== 'off') problems.push('.env.prod: EXPO_PUBLIC_AGENT_WS_FIRST must be off, because that connection drops mid-answer');
    if (!['true', 'false'].includes(app.EXPO_PUBLIC_PRO_PLAN_ENABLED)) problems.push('.env.prod: EXPO_PUBLIC_PRO_PLAN_ENABLED must be true or false');
  }

  if (server) {
    for (const [name, value] of Object.entries(server)) {
      if (name.startsWith('EXPO_PUBLIC_')) problems.push(`.env.server.prod: ${name} belongs in .env.prod`);
      // Supabase provides these itself and refuses to set them.
      if (name.startsWith('SUPABASE_')) problems.push(`.env.server.prod: remove ${name}, Supabase provides it`);
      if (!value) problems.push(`.env.server.prod: ${name} is empty`);
    }
    if (server.RAZORPAY_KEY_ID && !server.RAZORPAY_KEY_ID.startsWith('rzp_live_')) problems.push('.env.server.prod: RAZORPAY_KEY_ID is not a live key');
    if (app && server.RAZORPAY_KEY_ID && server.RAZORPAY_KEY_ID !== app.EXPO_PUBLIC_RAZORPAY_KEY_ID) problems.push('Razorpay key id differs between the two files');
    if (app && server.AGORA_APP_ID && server.AGORA_APP_ID !== app.EXPO_PUBLIC_AGORA_APP_ID) problems.push('Agora app id differs between the two files');
    if (app && server.PRO_PLAN_ENABLED !== app.EXPO_PUBLIC_PRO_PLAN_ENABLED) problems.push('The Pro plan switch differs between the two files');
  }

  if (problems.length) {
    console.log(`Not ready. ${problems.length} to fix:`);
    problems.forEach((problem) => console.log(`  - ${problem}`));
    return false;
  }
  console.log('.env.prod and .env.server.prod are ready.');
  return true;
};

const run = (command, env = process.env) => {
  const result = spawnSync(command, { cwd: root, env, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const push = () => run('npx eas-cli env:push production --path .env.prod --force');

const action = process.argv[2];
if (action === 'check') {
  process.exit(check() ? 0 : 1);
} else if (action === 'start') {
  const app = readEnv('.env.prod');
  if (!app) {
    console.log('.env.prod is missing');
    process.exit(1);
  }
  // Values already in the process win over .env, and --clear stops Metro reusing values it inlined earlier.
  run('npx expo start --clear', { ...process.env, ...app });
} else if (action === 'push') {
  if (!check()) process.exit(1);
  push();
} else if (action === 'build') {
  if (!check()) process.exit(1);
  push();
  run('npx eas-cli build --platform android --profile production');
} else {
  console.log('Use: check, start, push or build');
  process.exit(1);
}
