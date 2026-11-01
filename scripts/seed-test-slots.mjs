// Creates bookable slots so booking (app + voice) can be tested end to end. Two modes:
//
//  A) As one doctor, no secret needed (same as adding slots in the app's Slots screen; row-level security applies):
//       node scripts/seed-test-slots.mjs --doctor-email dr@example.com --doctor-password "..." [--days 7] [--per-day 6]
//
//  B) For every verified doctor, using the service-role key (admin only, read from the shell environment):
//       SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-test-slots.mjs [--days 7] [--per-day 6] [--only "Vivek,Prem"] [--dry-run]
// Safe to re-run: existing (doctor, date, start_time) slots are skipped, booked slots are never touched.
// Uses EXPO_PUBLIC_SUPABASE_URL from .env. The service-role key is read from the environment only (never stored).
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()])
);
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const days = Math.max(1, Math.min(30, Number(flag('--days', 7))));
const perDay = Math.max(1, Math.min(12, Number(flag('--per-day', 6))));
const only = String(flag('--only', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const dryRun = args.includes('--dry-run');

const url = env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const doctorEmail = flag('--doctor-email', '');
const doctorPassword = flag('--doctor-password', '');
if (!url || (!serviceKey && !(doctorEmail && doctorPassword))) {
  console.error('Either pass --doctor-email and --doctor-password (a doctor account), or set SUPABASE_SERVICE_ROLE_KEY in your shell (not in .env).');
  process.exit(2);
}

let admin;
let doctors;
if (doctorEmail && doctorPassword) {
  // Mode A: act as the doctor with the public anon key; RLS only lets a doctor write their own slots.
  admin = createClient(url, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: login, error: loginError } = await admin.auth.signInWithPassword({ email: doctorEmail, password: doctorPassword });
  if (loginError) throw new Error('doctor login failed: ' + loginError.message);
  const { data: self, error: selfError } = await admin.from('doctors').select('id').eq('id', login.user.id).maybeSingle();
  if (selfError || !self) throw new Error('this account has no doctor profile (' + (selfError?.message || 'not a doctor') + ')');
  doctors = [{ id: self.id, first_name: doctorEmail, last_name: '', is_verified: true }];
} else {
  admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.from('doctors_public').select('id, first_name, last_name, is_verified').eq('is_verified', true);
  if (error) throw error;
  doctors = data;
}

const targets = doctors.filter((d) => !only.length || only.some((o) => `${d.first_name} ${d.last_name}`.toLowerCase().includes(o)));
// Consultation hours 10:00–16:00, one hour each (IST wall-clock, stored as TIME).
const hours = [10, 11, 12, 14, 15, 16, 17, 18].slice(0, perDay);
const pad = (n) => String(n).padStart(2, '0');

const today = new Date();
const rows = [];
for (const doctor of targets) {
  for (let d = 1; d <= days; d += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    const dateKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    for (const h of hours) rows.push({ doctor_id: doctor.id, date: dateKey, start_time: `${pad(h)}:00:00`, end_time: `${pad(h)}:45:00`, is_booked: false });
  }
}

console.log(`${targets.length} verified doctors × ${days} days × ${hours.length} slots = ${rows.length} candidate slots${dryRun ? ' (dry run)' : ''}`);
if (dryRun) process.exit(0);

const { data: existing } = await admin.from('slots').select('doctor_id, date, start_time').in('doctor_id', targets.map((d) => d.id));
const have = new Set((existing || []).map((s) => `${s.doctor_id}|${s.date}|${String(s.start_time).slice(0, 8)}`));
const fresh = rows.filter((r) => !have.has(`${r.doctor_id}|${r.date}|${r.start_time}`));
for (let i = 0; i < fresh.length; i += 500) {
  const { error: insertError } = await admin.from('slots').insert(fresh.slice(i, i + 500));
  if (insertError) throw insertError;
}
console.log(`inserted ${fresh.length} new slots (${rows.length - fresh.length} already existed)`);
