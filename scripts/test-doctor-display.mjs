// Unit tests for src/utils/doctors.ts, using the speciality spellings found in the live database.
//   node scripts/test-doctor-display.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const source = fs.readFileSync(new URL('../src/utils/doctors.ts', import.meta.url), 'utf8');
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

eq('Dermatologist = Dermatology', t.canonicalSpecialty('Dermatologist'), t.canonicalSpecialty('Dermatology'));
eq('Cardiologist = Cardiology', t.canonicalSpecialty('Cardiologist'), 'Cardiology');
eq('trailing space', t.canonicalSpecialty('General Physician '), 'General Physician');
eq('Ayurveda group', ['BAMS', 'Ayurvedic Practitioner', 'Kayachikitsa'].map(t.canonicalSpecialty), ['Ayurveda', 'Ayurveda', 'Ayurveda']);
eq('Orthopedic', t.canonicalSpecialty('Orthopedic'), 'Orthopedics');
eq('ENT stays ENT', t.canonicalSpecialty('ENT'), 'ENT');
eq('"Dentist" is not swallowed by ENT', t.canonicalSpecialty('dentist'), 'Dentist');
eq('empty', t.canonicalSpecialty('  '), '');
eq(
  'categories: merged, most doctors first, no duplicates',
  t.getSpecialtyCategories([{ specialization: 'ENT' }, { specialization: 'Dermatologist' }, { specialization: 'Dermatology ' }, { specialization: '' }]),
  ['Dermatology', 'ENT']
);
eq('junk name hidden', t.isPresentableDoctor({ firstName: 'Dr. aaaaaa', lastName: 'sssdsfsaf', specialization: 'General Physician' }), false);
eq('no speciality hidden', t.isPresentableDoctor({ firstName: 'Meera', lastName: 'Rao', specialization: ' ' }), false);
eq('real doctor shown', t.isPresentableDoctor({ firstName: 'Vivek', lastName: 'Tiwari', specialization: 'Nephrology' }), true);
eq('fee with symbol', t.formatFee('₹950'), '₹950');
eq('fee without symbol', t.formatFee(500), '₹500');
eq('no fee', t.formatFee(''), '');
eq('experience formats', ['3', '9 Years', '1', 12, '', null].map(t.formatExperienceYears), ['3 years', '9 years', '1 year', '12 years', '', '']);
eq('ENT Specialist and Kidney map to the doctors\' speciality', [t.canonicalSpecialty('ENT Specialist'), t.canonicalSpecialty('Kidney'), t.canonicalSpecialty('Gastro & Liver')], ['ENT', 'Nephrology', 'Gastroenterology']);
eq('initials skip Dr.', t.getNameInitials('Dr. Vivek Tiwari'), 'VT');

console.log(failures ? `\n${failures} test(s) failed` : '\nAll doctor display tests passed');
process.exit(failures ? 1 : 0);
