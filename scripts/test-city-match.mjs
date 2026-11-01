// Unit tests for src/utils/city.ts (doctor city matching).
//   node scripts/test-city-match.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = fs.readFileSync(new URL('../src/utils/city.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: 'CommonJS', target: 'ES2022' } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { isCityMatch, formatCityName } = mod.exports;

let failures = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

eq('same city', isCityMatch('Patna', 'Patna'), true);
eq('case-insensitive', isCityMatch('patna', 'Patna'), true);
eq('city with state', isCityMatch('Patna, Bihar', 'Patna'), true);
eq('Visakhapatnam is not Patna (old substring bug)', isCityMatch('Visakhapatnam', 'Patna'), false);
eq('New Delhi ~ Delhi', isCityMatch('New Delhi', 'Delhi'), true);
eq('Navi Mumbai ~ Mumbai', isCityMatch('Navi Mumbai', 'Mumbai'), true);
eq('different cities', isCityMatch('Mumbai', 'Pune'), false);
eq('empty city', isCityMatch('', 'Patna'), false);
eq('format city', [formatCityName('patna'), formatCityName('new delhi')], ['Patna', 'New Delhi']);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll city tests passed');
process.exit(failures ? 1 : 0);
