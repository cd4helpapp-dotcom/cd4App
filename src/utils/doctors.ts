// Display rules for doctor lists, shared by Home and Appointments.

const SPECIALTY_RULES: Array<[RegExp, string]> = [
  [/cardio|heart/, 'Cardiology'],
  [/dermat|skin/, 'Dermatology'],
  [/general physician|general medicine|internal medicine|^physician$|^gp$/, 'General Physician'],
  [/ayurved|bams|kayachikitsa/, 'Ayurveda'],
  [/gyn(a)?ec|obstet/, 'Gynecology'],
  [/orthop/, 'Orthopedics'],
  [/pa?ediatr/, 'Pediatrics'],
  [/psychiat/, 'Psychiatry'],
  [/pulmon|chest physician/, 'Pulmonology'],
  [/gastro|liver/, 'Gastroenterology'],
  [/nephro|kidney/, 'Nephrology'],
  [/endocrin|diabet/, 'Endocrinology'],
  [/^ent\b|otolaryng/, 'ENT'],
  [/urolog/, 'Urology'],
  [/neurolog/, 'Neurology'],
  [/ophthal|^eye/, 'Ophthalmology'],
];

// Doctors type their speciality freely ("Dermatologist", "Dermatology", "General Physician "). One name per
// speciality keeps categories from repeating and makes filtering match every doctor in it.
export const canonicalSpecialty = (value: string | null | undefined): string => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const lower = text.toLowerCase();
  const rule = SPECIALTY_RULES.find(([pattern]) => pattern.test(lower));
  return rule ? rule[1] : text.replace(/(^|\s)(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
};

// Categories that actually have doctors, most doctors first.
export const getSpecialtyCategories = (doctors: Array<{ specialization?: string | null }>): string[] => {
  const counts = new Map<string, number>();
  doctors.forEach((doctor) => {
    const name = canonicalSpecialty(doctor.specialization);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
};

// Browse lists skip test or incomplete profiles ("aaaaaa sssdsfsaf", no speciality). Searching by name still finds them.
export const isPresentableDoctor = (doctor: { firstName?: string | null; lastName?: string | null; specialization?: string | null }): boolean => {
  const name = `${doctor.firstName || ''} ${doctor.lastName || ''}`.replace(/^\s*dr\.?\s*/i, '').trim();
  return Boolean(String(doctor.specialization || '').trim()) && /\p{L}{2,}/u.test(name) && !/(\p{L})\1{3,}/u.test(name);
};

export const formatFee = (fee: string | number | null | undefined): string => {
  const text = String(fee ?? '').trim();
  if (!text) return '';
  return text.includes('₹') ? text : `₹${text}`;
};

// Stored as "9", "9 Years" or "9+ yrs". Always reads "9 years".
export const formatExperienceYears = (value: string | number | null | undefined): string => {
  const match = String(value ?? '').match(/\d+/);
  if (!match) return String(value ?? '').trim();
  const years = Number(match[0]);
  return `${years} ${years === 1 ? 'year' : 'years'}`;
};

export const getNameInitials = (name: string): string =>
  name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'DR';
