// End-to-end check of the voice assistant's doctor search + booking tools against the live Supabase project.
//   node scripts/test-voice-tools.mjs <email> <password>
// Reads EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY from .env. Creates no appointment: booking stops at the
// "payment_required" step (the app then opens the secure payment screen).
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()])
);
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const [email, password] = process.argv.slice(2);
if (!URL_ || !KEY || !email || !password) {
  console.error('usage: node scripts/test-voice-tools.mjs <email> <password>');
  process.exit(2);
}

const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
}).then((r) => r.json());
const token = auth.access_token;
if (!token) { console.error('login failed'); process.exit(1); }

const call = async (name, args) => {
  const res = await fetch(`${URL_}/functions/v1/voice-realtime-tools`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: JSON.stringify(args) }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, result: body.result ?? body };
};

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

// 1. Generic search by concern + city
const generic = await call('search_verified_doctors', { concern: 'fever', doctorName: null, city: 'Patna' });
const gDocs = generic.result.doctorRecommendations || [];
check('generic search returns doctors', generic.status === 200 && gDocs.length > 0, `${gDocs.length} doctors`);
check('generic search shows doctors first (no slots yet)', (generic.result.bookingSlotOptions || []).length === 0);
check('generic search suggests General Physician for fever', /general/i.test(generic.result.departmentSuggestion?.label || ''), generic.result.departmentSuggestion?.label || 'none');

// 2. City not in DB -> must still return doctors (no empty result)
const far = await call('search_verified_doctors', { concern: 'fever', doctorName: null, city: 'Atlantis' });
check('unknown city still returns doctors', (far.result.doctorRecommendations || []).length > 0, `${(far.result.doctorRecommendations || []).length} doctors`);

// 3. Named doctor -> only that doctor, with live slots. Pick a doctor that really has open slots.
const rest = (path) => fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } }).then((r) => r.json());
const todayKey = new Date().toISOString().slice(0, 10);
const openSlots = await rest(`slots?select=id,doctor_id,date&is_booked=eq.false&date=gte.${todayKey}&order=date.asc&limit=1`);
let targetDoctor = null;
if (openSlots[0]) {
  const [row] = await rest(`doctors_public?select=id,first_name,last_name&id=eq.${openSlots[0].doctor_id}`);
  targetDoctor = row ? { id: row.id, firstName: row.first_name, lastName: row.last_name } : null;
}
check('database has at least one open future slot (otherwise nobody can book)', Boolean(targetDoctor), targetDoctor ? `${targetDoctor.firstName} ${targetDoctor.lastName}` : 'NONE — run scripts/seed-test-slots.mjs or add slots from a doctor account');
const named = await call('search_verified_doctors', { concern: 'General health', doctorName: targetDoctor ? `Dr ${targetDoctor.firstName} ${targetDoctor.lastName}` : 'Dr Vivek', city: null });
const nDocs = named.result.doctorRecommendations || [];
check('named doctor search returns exactly one doctor', nDocs.length === 1, nDocs[0] ? `${nDocs[0].firstName} ${nDocs[0].lastName}` : 'none');
if (targetDoctor) check('named search found the doctor that has slots', nDocs[0]?.id === targetDoctor.id);
const slots = named.result.bookingSlotOptions || [];
if (targetDoctor) check('named search returns open slots for that doctor', slots.length > 0, `${slots.length} slots`);
check('slots belong only to that doctor', slots.every((s) => s.doctorId === nDocs[0]?.id));
const notStarted = (slot) => new Date(`${slot.date}T${String(slot.startTime || '00:00:00').slice(0, 8)}+05:30`).getTime() > Date.now();
check('every offered slot has not started yet (time, not just date)', slots.every(notStarted), slots.filter((slot) => !notStarted(slot)).map((slot) => `${slot.date} ${slot.startTime}`).join(', ') || undefined);

// 4. Misspelled / nonexistent doctor must not fan out to random doctors
const ghost = await call('search_verified_doctors', { concern: 'General health', doctorName: 'Dr Zzxqwv', city: null });
check('nonexistent doctor does not return random doctors with slots', (ghost.result.bookingSlotOptions || []).length === 0, `${(ghost.result.doctorRecommendations || []).length} doctors`);

// 5. Booking guards
const unconfirmed = await call('book_appointment', { doctorId: nDocs[0]?.id || 'x', slotId: slots[0]?.id || 'x', concern: 'fever', confirmed: false });
check('booking without confirmation is refused', unconfirmed.result.status === 'needs_confirmation');

if (slots[0]) {
  const confirmed = await call('book_appointment', { doctorId: nDocs[0].id, slotId: slots[0].id, concern: 'fever', confirmed: true });
  check('confirmed booking goes to payment step', confirmed.result.status === 'payment_required', confirmed.result.status);
  check('payment payload carries doctor, slot and fee', Boolean(confirmed.result.doctorName && confirmed.result.slotDate && confirmed.result.doctorFee), `${confirmed.result.doctorName} ${confirmed.result.slotDate} ₹${confirmed.result.doctorFee}`);

  // 6. Slot that belongs to another doctor must be rejected
  const otherDoc = gDocs.find((d) => d.id !== nDocs[0].id);
  if (otherDoc) {
    const mismatch = await call('book_appointment', { doctorId: otherDoc.id, slotId: slots[0].id, concern: 'fever', confirmed: true });
    check('slot of a different doctor is rejected', mismatch.status === 400, `status ${mismatch.status}`);
  }
} else {
  console.log('SKIP  no open slot for the named doctor; booking checks skipped');
}

const fake = await call('book_appointment', { doctorId: '00000000-0000-0000-0000-000000000000', slotId: '00000000-0000-0000-0000-000000000000', concern: 'x', confirmed: true });
check('unknown doctor/slot is rejected', fake.status === 400, `status ${fake.status}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll voice tool checks passed');
process.exit(failures ? 1 : 0);
