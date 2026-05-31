import { Doctor, User } from '../src/types/index';

const normalizeRole = (role: unknown): string => {
  if (typeof role === 'string') return role.trim().toLowerCase();
  return '';
};

const hasRequiredPatientFields = (user: User): boolean => {
  const hasAge = typeof user.age === 'number' && user.age > 0;
  const hasGender = typeof user.gender === 'string' && ['male', 'female', 'other'].includes(user.gender.toLowerCase());
  const hasAddress = typeof user.address === 'string' && user.address.trim().length > 0;
  return hasAge && hasGender && hasAddress;
};

const hasNonEmptyText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const hasValidPhone = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10;
};

const hasPositiveFee = (fee: unknown): boolean => {
  if (typeof fee !== 'string') return false;
  const numeric = Number(fee.replace(/[^\d.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0;
};

const hasValidYear = (year: unknown): boolean => {
  const numeric = Number(year);
  const currentYear = new Date().getFullYear() + 1;
  return Number.isInteger(numeric) && numeric >= 1950 && numeric <= currentYear;
};

const hasStringArrayValues = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  const clean = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  return clean.length > 0;
};

export const isDoctorUser = (user: User | null | undefined): user is User => {
  if (!user) return false;
  return normalizeRole(user.role) === 'doctor';
};

export const hasCompletedDoctorProfile = (
  user: User | null | undefined,
  doctorProfile: Doctor | null | undefined
): boolean => {
  if (!user || !doctorProfile) return false;
  if (doctorProfile.profileCompletionDone === true) return true;

  return (
    hasNonEmptyText(user.firstName) &&
    hasNonEmptyText(user.lastName) &&
    hasNonEmptyText(user.email) &&
    hasValidPhone(user.phoneNumber) &&
    hasNonEmptyText(user.profilePicture) &&
    hasNonEmptyText(doctorProfile.city) &&
    hasNonEmptyText(doctorProfile.degree) &&
    hasNonEmptyText(doctorProfile.specialization) &&
    hasNonEmptyText(doctorProfile.university) &&
    hasValidYear(doctorProfile.yearOfCompletion) &&
    hasNonEmptyText(doctorProfile.registrationNumber) &&
    hasNonEmptyText(doctorProfile.registrationCouncil) &&
    hasNonEmptyText(doctorProfile.experience) &&
    hasNonEmptyText(doctorProfile.currentHospitalClinic) &&
    hasNonEmptyText(doctorProfile.previousWorkDetails) &&
    hasStringArrayValues(doctorProfile.areasOfExpertise) &&
    hasStringArrayValues(doctorProfile.languagesSpoken) &&
    hasPositiveFee(doctorProfile.fee) &&
    hasNonEmptyText(doctorProfile.treatmentApproach)
  );
};

export const needsDoctorProfileSetup = (
  user: User | null | undefined,
  doctorProfile: Doctor | null | undefined
): boolean => {
  return isDoctorUser(user) && !hasCompletedDoctorProfile(user, doctorProfile);
};

export const isPatientUser = (user: User | null | undefined): user is User => {
  if (!user) return false;
  return normalizeRole(user.role) === 'patient';
};

export const hasCompletedPatientProfile = (user: User | null | undefined): boolean => {
  if (!user) return false;
  if (user.profileSetupCompleted === true) return true;
  return hasRequiredPatientFields(user);
};

export const needsPatientProfileSetup = (user: User | null | undefined): boolean => {
  return isPatientUser(user) && !hasCompletedPatientProfile(user);
};
