const normalizeOption = (value: string): string => value.trim().toLowerCase();

const dedupeAndSortOptions = (options: string[]): string[] => {
  const unique = new Map<string, string>();

  options.forEach((option) => {
    const trimmed = option.trim();
    if (!trimmed) {
      return;
    }

    const key = normalizeOption(trimmed);
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  });

  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
};

export const DOCTOR_CITY_OPTIONS: string[] = [
  'Ahmedabad',
  'Bengaluru',
  'Bhopal',
  'Chandigarh',
  'Chennai',
  'Delhi',
  'Gurugram',
  'Hyderabad',
  'Indore',
  'Jaipur',
  'Kanpur',
  'Kolkata',
  'Lucknow',
  'Mumbai',
  'Nagpur',
  'Noida',
  'Patna',
  'Pune',
  'Ranchi',
  'Surat',
];

export const DOCTOR_SPECIALIZATION_OPTIONS: string[] = [
  'General Physician',
  'Diabetologist',
  'Cardiologist',
  'Dermatologist',
  'Endocrinologist',
  'Gastroenterologist',
  'Neurologist',
  'Pediatrician',
  'Psychiatrist',
  'Orthopedic Surgeon',
  'Gynecologist',
  'Pulmonologist',
  'ENT Specialist',
  'Urologist',
  'Nephrologist',
  'Oncologist',
  'Ayurvedic Practitioner',
  'Homeopath',
  'BAMS',
  'Surgeon',
];

export const getMergedSpecializationOptions = (dynamicOptions: string[] = []): string[] =>
  dedupeAndSortOptions([...DOCTOR_SPECIALIZATION_OPTIONS, ...dynamicOptions]);
