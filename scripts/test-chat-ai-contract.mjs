import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const edgePath = path.join(root, 'supabase', 'functions', 'chat-ai', 'index.ts');
const uiPath = path.join(root, 'app', 'ai-guidance.tsx');
const edge = await fs.readFile(edgePath, 'utf8');
const ui = await fs.readFile(uiPath, 'utf8');

const checks = [
  ['latest-five-history', /MAX_HISTORY_ITEMS\s*=\s*5/.test(edge)],
  ['structured-json-response', /response_format:\s*\{\s*type:\s*["']json_object/.test(edge)],
  ['intent-field', /intent:\s*ConversationIntent/.test(edge) && /"intent"/.test(edge)],
  ['clinical-summary-field', /clinicalSummary/.test(edge) && /clinical_summary/.test(ui)],
  ['emergency-safety-override', /detectEmergencySignal/.test(edge) && /consultPriority\s*=\s*["']immediate/.test(edge)],
  ['consult-now-fields', /consultRecommended/.test(edge) && /needsHumanReview/.test(edge) && /riskScore/.test(edge)],
  ['latest-topic-priority', /prioritize the patient's latest clear medical question/i.test(edge)],
  ['raw-json-ui-guard', /extractReplyFromStructuredText/.test(ui)],
  ['thinking-placeholder-cleanup', /withoutThinking/.test(ui)],
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) console.log(`PASS  ${name}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

if (failed > 0) process.exit(1);
console.log(`\nChat AI contract checks passed: ${checks.length}`);
