// Runs one document through the deployed analyzer several times and checks every result, since a wrong reading may only show up sometimes.
//   CD4_EMAIL=... CD4_PASSWORD=... npm run eval:report -- <file> --runs 3 --must "generalized,diclo" --never "pregnancy,ultrasound"
// The file and the result are removed afterwards. Keep real patient documents outside this repo.
import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()])
);
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const words = (text) => text.split(',').map((word) => word.trim().toLowerCase()).filter(Boolean);
const file = args[0];
const runs = Number(option('runs', '3'));
const must = words(option('must'));
const never = words(option('never'));
if (!file || !fs.existsSync(file) || !process.env.CD4_EMAIL || !process.env.CD4_PASSWORD) {
  console.error('Usage: CD4_EMAIL=... CD4_PASSWORD=... npm run eval:report -- <file> --runs 3 --must "a,b" --never "c,d"');
  process.exit(2);
}

const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: key, 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.CD4_EMAIL, password: process.env.CD4_PASSWORD }),
}).then((response) => response.json());
const headers = { apikey: key, authorization: `Bearer ${login.access_token}` };
const mimeType = path.extname(file).toLowerCase() === '.pdf' ? 'application/pdf' : 'image/jpeg';
const bytes = fs.readFileSync(file);

let failures = 0;
for (let run = 1; run <= runs; run += 1) {
  const filePath = `${login.user.id}/${Date.now()}_eval${path.extname(file)}`;
  let reportId = null;
  try {
    // A large photo on a weak connection can drop mid-upload, and that says nothing about the analyzer.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const uploaded = await fetch(`${url}/storage/v1/object/medical-reports/${filePath}`, { method: 'POST', headers: { ...headers, 'content-type': mimeType, 'x-upsert': 'true' }, body: bytes });
        if (uploaded.ok) break;
        throw new Error(`upload status ${uploaded.status}`);
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }
    const [row] = await fetch(`${url}/rest/v1/medical_reports?select=id`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ patient_id: login.user.id, file_name: 'eval', file_path: filePath, mime_type: mimeType, file_size_bytes: bytes.length, source: 'upload', analysis_status: 'pending' }),
    }).then((response) => response.json());
    reportId = row.id;
    const startedAt = Date.now();
    // The function answers at once and carries on in the background, so the saved row is the result.
    await fetch(`${url}/functions/v1/analyze-medical-report`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ reportId, responseLanguage: 'en' }) }).catch(() => {});
    for (let wait = 0; wait < 60; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const [state] = await fetch(`${url}/rest/v1/medical_reports?select=analysis_status&id=eq.${reportId}`, { headers }).then((response) => response.json()).catch(() => [{}]);
      if (state?.analysis_status === 'completed' || state?.analysis_status === 'failed') break;
    }
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const [report] = await fetch(`${url}/rest/v1/medical_reports?select=*&id=eq.${reportId}`, { headers }).then((response) => response.json());
    const text = JSON.stringify({ summary: report.ai_summary, keyPoints: report.ai_key_points, structured: { ...report.ai_structured, raw_model_text: undefined, document_transcript: undefined } }).toLowerCase();
    const missing = must.filter((word) => !text.includes(word));
    const invented = never.filter((word) => text.includes(word));
    const declined = report.analysis_status === 'failed';
    const ok = declined || (!missing.length && !invented.length);
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  run ${run}: ${seconds}s, ${report.ai_structured?.model || 'no model'}, ${declined ? 'declined to answer' : report.report_type}${missing.length ? `, missing: ${missing.join(', ')}` : ''}${invented.length ? `, INVENTED: ${invented.join(', ')}` : ''}`);
    console.log(`      ${report.ai_structured?.headline || report.analysis_error || ''}`);
    const timings = report.ai_structured?.analysis_timings;
    if (timings) console.log(`      read ${timings.readingMs} ms, explain ${timings.aiMs} ms, check ${timings.checkMs} ms, claims removed ${timings.claimsFound}, total ${timings.totalMs} ms`);
  } finally {
    const remove = async (target) => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          await fetch(target, { method: 'DELETE', headers });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
      console.error(`COULD NOT REMOVE ${target}`);
    };
    await remove(`${url}/storage/v1/object/medical-reports/${filePath}`);
    if (reportId) {
      await remove(`${url}/rest/v1/medical_report_chunks?report_id=eq.${reportId}`);
      await remove(`${url}/rest/v1/medical_reports?id=eq.${reportId}`);
    }
  }
}
console.log(failures ? `\n${failures} of ${runs} runs wrong` : `\nAll ${runs} runs correct`);
process.exit(failures ? 1 : 0);
