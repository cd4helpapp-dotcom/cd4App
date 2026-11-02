// Tests the voice assistant's doctor search (supabase/functions/_shared/doctorSearch.ts) against a fake database.
//   node scripts/test-voice-doctor-search.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = fs.readFileSync(new URL('../supabase/functions/_shared/doctorSearch.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: 'CommonJS', target: 'ES2022' } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const t = mod.exports;

let failures = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const doctor = (id, first, last, city, specialization, rating = 0) => ({ id, first_name: first, last_name: last, city, specialization, rating, experience: '5', fee: '₹500', profile_picture: '' });
const DOCTORS = [
  doctor('p1', 'Prem', 'Kumar', 'Patna', 'Ayurvedic Practitioner'),
  doctor('p2', 'Nitesh', 'Rajput', 'Patna', 'General Physician '),
  doctor('p3', 'DR aaaaaa', 'sssdsfsaf', 'patna', 'General Physician'),
  doctor('p4', 'Vivek', 'Tiwari', 'Patna', 'Nephrology', 4.6),
  doctor('v1', 'Prakash', 'Reddy', 'Visakhapatnam', 'Kayachikitsa', 4.5),
  doctor('m1', 'Meera', 'Rao', 'Mumbai', 'Cardiology', 4.8),
  doctor('g1', 'Ravi', 'Sen', 'Delhi', 'Gastroenterology', 4.1),
];
const now = Date.parse('2026-11-02T10:00:00Z'); // 15:30 IST
const SLOTS = [
  { id: 's0', doctor_id: 'p2', date: '2026-11-02', start_time: '09:00:00', end_time: '09:30:00' }, // already passed today
  { id: 's1', doctor_id: 'p2', date: '2026-11-02', start_time: '19:00:00', end_time: '19:30:00' },
  { id: 's2', doctor_id: 'p2', date: '2026-11-03', start_time: '09:30:00', end_time: '10:00:00' },
  { id: 's3', doctor_id: 'p2', date: '2026-11-05', start_time: '18:00:00', end_time: '18:30:00' },
];
const admin = {
  from: (table) => {
    const q = { select: () => q, limit: () => q, in: () => q, eq: () => q, gte: () => q, order: () => q, then: (resolve) => resolve({ data: table === 'slots' ? SLOTS : DOCTORS, error: null }) };
    return q;
  },
};
const search = (concern, city) => t.searchVerifiedDoctors(admin, { concern, city, nowMs: now });
const names = (r) => r.doctorRecommendations.map((d) => d.id);

// The exact requests that used to return no doctors because of the chat model's scope guard.
for (const concern of ['doctors in Patna', 'all doctors', 'General health', 'tell me all the doctors']) {
  const r = await search(concern, 'Patna');
  eq(`"${concern}" + Patna: only Patna doctors, real ones, bookable first`, names(r), ['p2', 'p4', 'p1']);
  eq(`"${concern}": no apology note`, r.searchNote, null);
}

const patna = await search('all doctors', 'Patna');
eq('Visakhapatnam is not Patna', names(patna).includes('v1'), false);
eq('junk profile hidden', names(patna).includes('p3'), false);
eq('city label is capitalised', patna.searchCity, 'Patna');
eq('slots are attached, past slot dropped, max 2 per doctor', patna.bookingSlotOptions.map((s) => s.id), ['s1', 's2']);
eq('slot is attributed to its doctor', patna.bookingSlotOptions[0].label, 'Dr. Nitesh Rajput • today, 7:00 PM');
eq('doctor carries next slot', patna.doctorRecommendations[0].nextSlot, 'today, 7:00 PM');
eq('doctor without slot says so', patna.doctorRecommendations[1].nextSlot, 'no open slot right now');
eq('assistant is told not to mention the system', /Never mention the system/.test(patna.instructionsForAssistant), true);

const fever = await search('fever', 'Patna');
eq('fever in Patna: General Physician', names(fever), ['p2']);

const heart = await search('heart problem', 'Patna');
eq('no cardiologist in Patna: shows Cardiology elsewhere', names(heart), ['m1']);
eq('...and says so plainly', heart.searchNote, 'CD4 has no Cardiology doctor in Patna right now. These Cardiology doctors are in other cities and consult online.');

const unknown = await search('all doctors', 'Atlantis');
eq('unknown city: still offers doctors, with a note', [unknown.doctorRecommendations.length > 0, /no doctors in Atlantis/.test(unknown.searchNote)], [true, true]);

const noCity = await search('General health', null);
eq('no city: searches everywhere without a note', [noCity.doctorRecommendations.length > 0, noCity.searchNote], [true, null]);

eq('ENT does not match Gastroenterology', names(await search('ear pain', 'Delhi')).includes('g1') && (await search('ear pain', 'Delhi')).searchNote !== null, true);
eq('slot time words', [t.formatSlotWhen('2026-11-02', '19:00:00', now), t.formatSlotWhen('2026-11-03', '09:30:00', now), t.formatSlotWhen('2026-11-05', '00:15:00', now)], ['today, 7:00 PM', 'tomorrow, 9:30 AM', '5 Nov, 12:15 AM']);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll voice doctor search tests passed');
process.exit(failures ? 1 : 0);
