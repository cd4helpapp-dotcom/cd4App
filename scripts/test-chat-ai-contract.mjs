import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const edgePath = path.join(root, 'supabase', 'functions', 'chat-ai', 'index.ts');
const brainPath = path.join(root, 'supabase', 'functions', '_shared', 'clinicalBrain.ts');
const voicePath = path.join(root, 'src', 'services', 'realtimeVoice.ts');
const uiPath = path.join(root, 'app', 'ai-guidance.tsx');
const edge = await fs.readFile(edgePath, 'utf8');
const brain = await fs.readFile(brainPath, 'utf8');
const voice = await fs.readFile(voicePath, 'utf8');
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
  ['broader-emergency-keywords', /seizure/.test(edge) && /suicidal/.test(edge) && /neck stiffness/.test(edge) && /severe dehydration/.test(voice)],
  ['safe-parse-fallback-review', /safety_check_unavailable/.test(edge) && /needsHumanReview:\s*true/.test(edge)],
  ['adaptive-history-domains', /hospital admission or surgery/.test(brain) && /pediatric|older adults/.test(brain) && /chronological symptom timeline/.test(brain)],
  ['one-question-clarification', /If the patient cannot answer, record uncertainty/.test(brain) && /Ask exactly one focused question/.test(brain)],
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
