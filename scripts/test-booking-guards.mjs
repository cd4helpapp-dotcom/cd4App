// Live check of the server-side guards in manage-appointment-payment `create_order`.
//   node scripts/test-booking-guards.mjs <patient-email> <password>
// Only sends INVALID requests (past slot, another doctor's slot, already booked slot, 30-day cooldown) that must be
// rejected with { success:false, message }. It stops immediately if the server accepts one (guards not deployed),
// so at most one unpaid "created" order can be left behind. It never sends a valid order.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()])
);
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const [email, password] = process.argv.slice(2);
if (!URL_ || !KEY || !email || !password) { console.error('usage: node scripts/test-booking-guards.mjs <email> <password>'); process.exit(2); }

const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
const token = auth.access_token;
const userId = auth.user?.id;
if (!token) { console.error('login failed'); process.exit(1); }

const rest = (path) => fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } }).then((r) => r.json());
const createOrder = (doctorId, slotId) => fetch(`${URL_}/functions/v1/manage-appointment-payment`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'create_order', doctorId, slotId, appointmentType: 'consultation' }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const startMs = (s) => new Date(`${s.date}T${String(s.start_time).slice(0, 8)}+05:30`).getTime();

let failures = 0;
let accepted = false;
const expectRejected = async (label, doctorId, slotId, pattern) => {
  if (accepted) { console.log(`SKIP  ${label} (guards not deployed, stopped)`); return; }
  const res = await createOrder(doctorId, slotId);
  const ok = res.body?.success === false && pattern.test(String(res.body?.message || ''));
  if (res.body?.success === true) { accepted = true; }
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  — ${res.body?.success === true ? 'ACCEPTED (order created!) -> deploy manage-appointment-payment' : `${res.status} ${res.body?.message || JSON.stringify(res.body).slice(0, 120)}`}`);
};

const openSlots = await rest(`slots?select=id,doctor_id,date,start_time,end_time,is_booked&is_booked=eq.false&date=gte.${today}&order=date.asc,start_time.asc&limit=50`);
const bookedSlots = await rest(`slots?select=id,doctor_id,date,start_time,is_booked&is_booked=eq.true&limit=1`);
const pastToday = openSlots.find((s) => startMs(s) < Date.now());
const future = openSlots.find((s) => startMs(s) >= Date.now());
console.log(`open slots: ${openSlots.length} (past-time today: ${pastToday ? 1 : 0}, future: ${future ? 1 : 0}); booked slot readable: ${bookedSlots[0] ? 'yes' : 'no'}\n`);

if (pastToday) await expectRejected('slot whose time has already passed is rejected', pastToday.doctor_id, pastToday.id, /passed|later slot/i);
else console.log('SKIP  no open slot with a past time today to test');

if (future) {
  const [otherDoctor] = await rest(`doctors_public?select=id&id=neq.${future.doctor_id}&limit=1`);
  if (otherDoctor) await expectRejected("another doctor's slot is rejected", otherDoctor.id, future.id, /does not belong/i);
}
if (bookedSlots[0]) await expectRejected('already booked slot is rejected', bookedSlots[0].doctor_id, bookedSlots[0].id, /booked|just booked|belong/i);
else console.log('SKIP  no booked slot readable by this account');

// 30-day cooldown: a doctor this patient booked within the last 30 days, with any open future slot
const since = new Date(Date.now() - 29 * 86400000).toISOString();
const recent = await rest(`appointments?select=doctor_id,created_at,status&patient_id=eq.${userId}&status=in.(pending,confirmed,completed)&created_at=gte.${since}&limit=5`);
const cooldownDoctor = recent.find((a) => openSlots.some((s) => s.doctor_id === a.doctor_id && startMs(s) >= Date.now()));
if (cooldownDoctor) {
  const slot = openSlots.find((s) => s.doctor_id === cooldownDoctor.doctor_id && startMs(s) >= Date.now());
  await expectRejected('30-day cooldown for the same doctor is rejected', cooldownDoctor.doctor_id, slot.id, /30 days/i);
} else {
  console.log(`SKIP  cooldown: patient has ${recent.length} booking(s) in the last 29 days, none with an open future slot`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll executed guard checks passed');
process.exit(failures ? 1 : 0);
