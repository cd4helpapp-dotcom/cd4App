// Tests the paid-booking path (supabase/functions/_shared/appointmentBooking.ts) with a fake database and Razorpay.
//   node scripts/test-booking-finalize.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = fs.readFileSync(new URL('../supabase/functions/_shared/appointmentBooking.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: 'CommonJS', target: 'ES2022' } }).outputText;
const secrets = { RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'secret' };
globalThis.Deno = { env: { get: (key) => secrets[key] } };
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { finalizePaidBooking } = mod.exports;

let failures = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const fakeDb = (rpcResult, row) => ({
  row,
  rpc: async () => rpcResult,
  from() {
    const db = this;
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row }) }) }),
      update: (fields) => ({ eq: async () => { db.row = { ...db.row, ...fields }; return {}; } }),
    };
  },
});
// paymentStatus is what Razorpay reports when the payment is fetched.
const fakeRazorpay = (ok, status = 200, paymentStatus = 'captured') => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(`${init?.method || 'GET'} ${url}`);
    if (init?.method === 'GET') return { ok: true, status: 200, json: async () => ({ status: paymentStatus, amount: 45000, currency: 'INR' }) };
    if (url.endsWith('/capture')) return { ok: true, status: 200, json: async () => ({ status: 'captured' }) };
    return { ok, status, json: async () => (ok ? { id: 'rfnd_1', status: 'processed' } : { error: { code: 'BAD_REQUEST_ERROR', description: 'The payment has been fully refunded already' } }) };
  };
  return calls;
};
const money = (calls) => calls.filter((call) => call.startsWith('POST'));
const paymentRow = { id: 'row1', patient_id: 'p1' };
const run = (db) => finalizePaidBooking({ serviceClient: db, paymentRow, razorpayPaymentId: 'pay_1', signature: 'sig' });

let calls = fakeRazorpay(true);
let db = fakeDb({ data: [{ success: true, appointment_id: 'a1', message: 'booked' }] }, { status: 'created', metadata: {} });
eq('open slot books', await run(db), { success: true, appointmentId: 'a1', alreadyBooked: false });
eq('booking never refunds', calls.some((call) => call.endsWith('/refund')), false);

db = fakeDb({ data: [{ success: true, appointment_id: 'a1', message: 'already_booked' }] }, { status: 'paid', metadata: {} });
eq('second caller sees the same booking', await run(db), { success: true, appointmentId: 'a1', alreadyBooked: true });

calls = fakeRazorpay(true);
db = fakeDb({ data: [{ success: false, appointment_id: null, message: 'slot_already_booked' }] }, { status: 'created', metadata: { appointment_type: 'second_opinion' } });
eq('lost slot is refunded', (await run(db)).code, 'slot_taken_refunded');
eq('refund uses this payment', money(calls)[0], 'POST https://api.razorpay.com/v1/payments/pay_1/refund');
eq('payment marked refunded', db.row.status, 'refunded');
eq('metadata is kept', db.row.metadata.appointment_type, 'second_opinion');

calls = fakeRazorpay(true);
db = fakeDb({ data: [{ success: false, appointment_id: null, message: 'slot_already_booked' }] }, { status: 'refunded', metadata: { refund_id: 'rfnd_0' } });
eq('already refunded is not refunded twice', [(await run(db)).code, money(calls).length], ['slot_taken_refunded', 0]);

fakeRazorpay(false, 400);
db = fakeDb({ data: [{ success: false, appointment_id: null, message: 'slot_already_booked' }] }, { status: 'created', metadata: {} });
eq('refund failure is reported', (await run(db)).code, 'slot_taken_refund_pending');
eq('failed refund flagged for support', [db.row.status, db.row.metadata.needs_manual_refund], ['paid', true]);
eq('failure records why', db.row.metadata.refund_error.includes('BAD_REQUEST_ERROR') && db.row.metadata.refund_error.includes('payment status: captured'), true);

// An authorized payment is only held. It is captured before a refund, and when a booking is made.
calls = fakeRazorpay(true, 200, 'authorized');
db = fakeDb({ data: [{ success: false, appointment_id: null, message: 'slot_already_booked' }] }, { status: 'created', metadata: {} });
await run(db);
eq('held payment is captured, then refunded', money(calls).map((call) => call.split('/').pop()), ['capture', 'refund']);
calls = fakeRazorpay(true, 200, 'authorized');
db = fakeDb({ data: [{ success: true, appointment_id: 'a2', message: 'booked' }] }, { status: 'created', metadata: {} });
await run(db);
eq('booking captures a held payment', money(calls).map((call) => call.split('/').pop()), ['capture']);
calls = fakeRazorpay(true, 200, 'captured');
db = fakeDb({ data: [{ success: true, appointment_id: 'a3', message: 'booked' }] }, { status: 'created', metadata: {} });
await run(db);
eq('captured payment is not captured twice', money(calls).length, 0);

calls = fakeRazorpay(true);
db = fakeDb({ data: [{ success: false, appointment_id: null, message: 'slot_already_booked' }] }, { status: 'created', metadata: { mode: 'test' } });
eq('test order calls no refund API', [(await run(db)).code, money(calls).length, db.row.status], ['slot_taken_refunded', 0, 'failed']);

calls = fakeRazorpay(true);
db = fakeDb({ data: [{ success: false, appointment_id: null, message: 'payment_status_invalid' }] }, { status: 'refunded', metadata: {} });
eq('other failures do not refund', [(await run(db)).code, money(calls).length], ['payment_status_invalid', 0]);

db = fakeDb({ error: { message: 'db down' } }, { status: 'created', metadata: {} });
eq('database errors are retryable', (await run(db)).code, 'finalize_error');

console.log(failures ? `\n${failures} test(s) failed` : '\nAll booking tests passed');
process.exit(failures ? 1 : 0);
