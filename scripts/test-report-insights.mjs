// Unit tests for src/utils/reportInsights.ts using samples shaped like real analysis output.
//   node scripts/test-report-insights.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = fs.readFileSync(new URL('../src/utils/reportInsights.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: 'CommonJS', target: 'ES2022' } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const t = mod.exports;

let failures = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const now = Date.now();
const base = { fileName: 'Lab_Report_.pdf', reportType: 'lab_report', source: 'upload', aiSummary: '', aiKeyPoints: [], aiStructured: {}, analysisStatus: 'completed', updatedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), fileSizeBytes: 2_500_000 };

const lab = {
  ...base,
  aiSummary: '⚠️ The main concerns are markedly elevated cholesterol levels, with LDL cholesterol 180.12 mg/dL and triglycerides 204.90 mg/dL.\nHbA1c is 5.8%.',
  aiStructured: {
    parameter_highlights: [
      'Hemoglobin / 14.2 / g/dL / reference 13-17 / normal',
      'LDL cholesterol / 180.12 / mg/dL / reference <100.00 / high',
      'Triglycerides / 204.90 / mg/dL / reference <150.00 / high',
      'Vitamin D / 18 / ng/mL / reference 30-100 / low',
      'No clinical parameters or test values visible',
    ],
    abnormal_findings: ['Total cholesterol: 267.20 mg/dL (reference <200.00), elevated.', 'No abnormal findings are visible in the provided image'],
    suggested_followups: ['Book a non-urgent appointment with a physician.'],
    caution_flags: ['⚠️ Elevated LDL warrants timely clinician review.'],
    report_identity: { report_date: '28/12/2025 2:31:47 PM', lab_name: 'Dr Lal PathLabs' },
  },
};

eq('kind: lab_report type -> lab', t.getReportKind(lab), 'lab');
eq('kind: prescription_upload source -> prescription', t.getReportKind({ ...base, source: 'prescription_upload', reportType: null }), 'prescription');
eq('kind: medicines present -> prescription', t.getReportKind({ ...base, reportType: 'other', aiStructured: { prescription_details: { medications: [{ medicine_name: 'Dolo' }] } } }), 'prescription');
eq('kind: chat screenshot -> other', t.getReportKind({ ...base, reportType: 'other', aiStructured: { parameter_highlights: ['No clinical parameters or test values visible in this chat-based session'] } }), 'other');

eq('state: completed -> ready', t.getReportState(lab, now), 'ready');
eq('state: failed -> failed', t.getReportState({ ...base, analysisStatus: 'failed' }, now), 'failed');
eq('state: processing just now -> scanning', t.getReportState({ ...base, analysisStatus: 'processing' }, now), 'scanning');
eq('state: processing for 2.5 months -> stuck', t.getReportState({ ...base, analysisStatus: 'processing', updatedAt: '2026-08-11T10:00:00Z', createdAt: '2026-08-11T10:00:00Z' }, now), 'stuck');
eq('state: pending 6 minutes -> stuck', t.getReportState({ ...base, analysisStatus: 'pending', updatedAt: new Date(now - 6 * 60000).toISOString() }, now), 'stuck');

const highlights = t.getHighlights(lab, 4);
eq('highlights: attention values come first', highlights.map((h) => `${h.name}:${h.flag}`), ['LDL cholesterol:high', 'Triglycerides:high', 'Vitamin D:low', 'Hemoglobin:normal']);
eq('highlights: placeholder line dropped', highlights.some((h) => /No clinical/.test(h.name)), false);
eq('highlights: value/unit/reference parsed', highlights[0], { name: 'LDL cholesterol', value: '180.12', unit: 'mg/dL', reference: 'below 100', flag: 'high' });
eq('format: ranges and zeros', [t.formatReference('4.00-5.60'), t.formatReference('reference 13-17'), t.formatReference('>40.00'), t.formatValue('204.90'), t.formatValue('Positive'), t.formatLabel('  LDL   cholesterol')], ['4 – 5.6', '13 – 17', 'above 40', '204.9', 'Positive', 'LDL cholesterol']);
eq('attention count uses high/low flags', t.getAttentionCount(lab), 3);
eq('attention items drop "No abnormal findings"', t.getAttentionItems(lab), ['Total cholesterol: 267.20 mg/dL (reference <200.00), elevated.']);
eq('cautions strip emoji', t.getCautions(lab), ['Elevated LDL warrants timely clinician review.']);

eq('summary: emoji + newline removed', t.getPlainSummary(lab, 400), 'The main concerns are markedly elevated cholesterol levels, with LDL cholesterol 180.12 mg/dL and triglycerides 204.90 mg/dL. HbA1c is 5.8%.');
eq('summary: long text cut at a sentence with ellipsis', t.getPlainSummary(lab, 100).endsWith('…'), true);
eq('summary: JSON string is unwrapped', t.getPlainSummary({ ...base, aiSummary: '{"summary":"Blood sugar is normal.","key_points":[]}' }), 'Blood sugar is normal.');
eq('summary: ```json fenced is unwrapped', t.getPlainSummary({ ...base, aiSummary: '```json\n{"patient_friendly_explanation":"All good."}\n```' }), 'All good.');

eq('title: Lab_Report_.pdf', t.getReportTitle(lab), 'Lab Report');
eq('title: screenshot name falls back to kind', t.getReportTitle({ ...base, fileName: 'Screenshot_20260710-212336.png', reportType: 'other' }), 'Medical document');
eq('title: IMG name on a prescription', t.getReportTitle({ ...base, fileName: 'IMG_2031.jpg', source: 'prescription_upload' }), 'Prescription');

const printed = t.getReportDate(lab);
eq('date: printed dd/mm/yyyy preferred', [printed.isUploadDate, printed.date.getFullYear(), printed.date.getMonth(), printed.date.getDate()], [false, 2025, 11, 28]);
eq('date: falls back to upload date', t.getReportDate({ ...base }).isUploadDate, true);

eq('size: 2.5 MB', t.formatFileSize(2_500_000), '2.4 MB');
eq('size: 340 KB', t.formatFileSize(340_000), '332 KB');
eq('size: unknown', t.formatFileSize(0), '');

eq('followups: drops AI self-reference', t.getFollowUps({ ...base, aiStructured: { suggested_followups: ["Provide detailed answers to the AI's questions to help guide next steps.", 'Book a non-urgent appointment with a physician.'] } }), ['Book a non-urgent appointment with a physician.']);

eq('highlights: name with slash + no numeric value', [t.parseHighlightLine('Creatinine / eGFR / 1.03 / mg/dL / reference 0.67-1.17 / normal')?.name, t.parseHighlightLine('Urine colour / Pale yellow / - / - / normal')], ['Creatinine / eGFR', null]);

// Second format, copied from a live analysis on 2026-11-01.
eq('highlights: pipe format (live data)', [
  t.parseHighlightLine('LDL cholesterol, calculated: 180.12 mg/dL | reference <100.00 | High'),
  t.parseHighlightLine('HbA1c: 5.8% | reference 4.00-5.60 | High; laboratory at-risk range'),
  t.parseHighlightLine('Creatinine/eGFR: 1.03 mg/dL / 103 mL/min/1.73 m² | references 0.67-1.17 / >59 | Normal'),
], [
  { name: 'LDL cholesterol, calculated', value: '180.12', unit: 'mg/dL', reference: 'below 100', flag: 'high' },
  { name: 'HbA1c', value: '5.8', unit: '%', reference: '4 – 5.6', flag: 'high' },
  { name: 'Creatinine/eGFR', value: '1.03', unit: 'mg/dL', reference: '0.67 – 1.17', flag: 'normal' },
]);

eq('title: AI title wins over the file name', t.getReportTitle({ ...base, fileName: 'x.pdf', aiStructured: { report_title: 'Full Body Checkup' } }), 'Full Body Checkup');
eq('title: copy and numbers removed from the file name', t.getReportTitle({ ...base, fileName: '1793524869328_1786448201674_Lab_Report_copy.pdf' }), 'Lab Report');
eq('reference: not printed is hidden', t.formatReference('not printed'), '');
eq('headline: stored one', t.getHeadline({ ...base, aiStructured: { headline: 'Your cholesterol is high.' } }), 'Your cholesterol is high.');
eq('headline: older report uses first sentence, decimals intact', t.getHeadline({ ...base, aiSummary: 'HbA1c is 5.8% today. Kidney tests are fine.', aiStructured: {} }), 'HbA1c is 5.8% today.');
eq('points: older report uses the rest', t.getPlainPoints({ ...base, aiSummary: 'HbA1c is 5.8% today. Kidney tests are fine.', aiStructured: {} }), [{ title: '', detail: 'Kidney tests are fine.', tone: 'neutral' }]);
eq('points: stored ones', t.getPlainPoints({ ...base, aiStructured: { plain_points: [{ title: 'Cholesterol', detail: 'High.', tone: 'concern' }] } }), [{ title: 'Cholesterol', detail: 'High.', tone: 'concern' }]);
eq('kind: OPD note with injections stays a note', t.getReportKind({ ...base, reportType: 'clinical_note', aiStructured: { medications: ['Inj Diclo'] } }), 'note');
eq('kind: patient chose prescription upload', t.getReportKind({ ...base, source: 'prescription_upload', reportType: 'clinical_note' }), 'prescription');
eq('highlight: blood pressure keeps both numbers', t.parseHighlightLine('Blood pressure: 110/70 mmHg | reference not printed | not marked abnormal')?.value, '110/70');
eq('meter: middle of range', t.getRangeMeter({ value: '15', reference: '13 – 17' }), { position: 0.5, normalStart: 0.25, normalEnd: 0.75 });
eq('meter: above the upper limit', t.getRangeMeter({ value: '180.12', reference: 'below 100' })?.position, 0.97);
eq('meter: inside "above" range', t.getRangeMeter({ value: '60', reference: 'above 40' }), { position: 0.6, normalStart: 0.4, normalEnd: 1 });
eq('meter: no usable range', t.getRangeMeter({ value: '110/70', reference: '' }), null);
eq('counts', t.getValueCounts({ ...base, aiStructured: { parameter_highlights: ['Hb / 14 / g/dL / reference 13-17 / normal', 'LDL / 180 / mg/dL / reference <100 / high'] } }), { normal: 1, attention: 1 });
eq('unread items skip empty ones', t.getUnreadItems({ ...base, aiStructured: { missing_sections: ['None', 'Date on stamp'] } }), ['Date on stamp']);
const transcript = t.getDocumentTranscript({ ...base, aiStructured: { document_transcript: 'PRINTED DETAILS: City Hospital\nNOTES:\n- BP 120/80 -> Blood pressure 120/80\n- Inj Diclo 1 IM stat → Diclofenac injection, given at once\nCROSSED OUT: T. PCM 500 SOS\nCOULD NOT READ: None' } });
eq('transcript: notes split into written and meaning', transcript.notes[1], { written: 'Inj Diclo 1 IM stat', meaning: 'Diclofenac injection, given at once' });
eq('transcript: crossed out kept apart', transcript.crossedOut, ['T. PCM 500 SOS']);
eq('transcript: missing on older reports', t.getDocumentTranscript({ ...base, aiStructured: {} }), null);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll report helper tests passed');
process.exit(failures ? 1 : 0);
