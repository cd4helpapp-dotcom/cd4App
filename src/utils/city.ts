// City matching for doctor lists. Compares whole words, so "Patna, Bihar" matches "Patna" but
// "Visakhapatnam" does not (a substring check put Visakhapatnam doctors under "near Patna").
const cityTokens = (value: string | null | undefined): string[] =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

export const isCityMatch = (doctorCity: string | null | undefined, selectedCity: string | null | undefined): boolean => {
  const doctor = cityTokens(doctorCity);
  const selected = cityTokens(selectedCity);
  if (!doctor.length || !selected.length) return false;
  const [shorter, longer] = doctor.length <= selected.length ? [doctor, selected] : [selected, doctor];
  const pool = new Set(longer);
  return shorter.every((token) => pool.has(token));
};

// "patna" -> "Patna", "new delhi" -> "New Delhi"
export const formatCityName = (value: string | null | undefined): string =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s-])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
