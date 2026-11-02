// Finds syntax errors, misspelled methods and undefined names in Supabase Edge Functions before they are deployed.
// The functions start with `// @ts-nocheck`, so a typo like shifted.getUTCFulloear() only shows up at runtime.
//   node scripts/check-edge-functions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = path.resolve(new URL('../supabase/functions', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const files = [];
const collect = (folder) => {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
};
collect(root);

// 2304: cannot find name. 2552: cannot find name, did you mean. 2551: property does not exist, did you mean.
const CODES = new Set([2304, 2551, 2552]);
const DENO_GLOBALS = new Set(['Deno', 'EdgeRuntime', 'Buffer']);

const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [], noResolve: false };
const host = ts.createCompilerHost(options);
const readFile = host.getSourceFile.bind(host);
host.getSourceFile = (fileName, languageVersion, ...rest) => {
  const normal = path.resolve(fileName);
  if (normal.startsWith(root)) {
    // Check the function as if @ts-nocheck were not there.
    const text = fs.readFileSync(normal, 'utf8').replace(/^\/\/ @ts-nocheck.*$/m, '');
    return ts.createSourceFile(fileName, text, languageVersion, true);
  }
  return readFile(fileName, languageVersion, ...rest);
};

const program = ts.createProgram(files, options, host);
let problems = 0;
for (const file of files) {
  const source = program.getSourceFile(file);
  if (!source) continue;
  // A syntax error stops the deploy, so it always counts.
  for (const diagnostic of program.getSyntacticDiagnostics(source)) {
    problems += 1;
    const { line } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    console.log(`${path.relative(root, file)}:${line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
  for (const diagnostic of program.getSemanticDiagnostics(source)) {
    if (!CODES.has(diagnostic.code)) continue;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    const name = message.match(/'([^']+)'/)?.[1] || '';
    if (DENO_GLOBALS.has(name)) continue;
    const { line } = source.getLineAndCharacterOfPosition(diagnostic.start);
    problems += 1;
    console.log(`${path.relative(root, file)}:${line + 1}  ${message}`);
  }
}
console.log(problems ? `\n${problems} problem(s) found in ${files.length} files` : `\nNo misspelled methods or undefined names in ${files.length} files`);
process.exit(problems ? 1 : 0);
