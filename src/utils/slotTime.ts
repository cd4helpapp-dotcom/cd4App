// Slot times arrive from the database as "07:00:00" but the doctor's picker stores "07:00 AM"; accept both.
export function toMinutes(value: string): number {
  const text = String(value || '').trim();
  const pm = /pm/i.test(text);
  const am = /am/i.test(text);
  const [h = '0', m = '0'] = text.replace(/(am|pm)/i, '').trim().split(':');
  let hours = parseInt(h, 10) || 0;
  if (pm && hours !== 12) hours += 12;
  if (am && hours === 12) hours = 0;
  return hours * 60 + (parseInt(m, 10) || 0);
}

export function formatClock(value: string): string {
  const total = toMinutes(value);
  const h24 = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function slotMoment(date: string, time: string): number {
  const [y, m, d] = String(date || '').slice(0, 10).split('-').map(Number);
  if (!y) return 0;
  const total = toMinutes(time);
  return new Date(y, m - 1, d, Math.floor(total / 60), total % 60).getTime();
}
