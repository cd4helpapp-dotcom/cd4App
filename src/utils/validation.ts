// Shared form validation rules so every screen accepts and rejects the same input.

// Pragmatic email check: one @, no spaces, a dot in the domain, 2+ letter TLD (allows .health, .info, .co.in).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

export const digitsOnly = (value: string): string => value.replace(/\D/g, '');

// Indian mobile numbers: 10 digits starting 6–9. Accepts input with +91 / 0 / spaces.
export const normalizeIndianMobile = (value: string): string => {
  let digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
};

export const isValidIndianMobile = (value: string): boolean => /^[6-9]\d{9}$/.test(normalizeIndianMobile(value));

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong' };

export const getPasswordStrength = (password: string): PasswordStrength => {
  if (password.length < PASSWORD_MIN_LENGTH) return { score: 0, label: 'Too short' };
  let score = 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 12) score += 1;
  const clamped = Math.min(score, 4) as PasswordStrength['score'];
  const labels: PasswordStrength['label'][] = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score: clamped, label: labels[clamped] };
};

// Returns an error message, or null when the password is acceptable.
export const validateNewPassword = (password: string): string | null => {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use a mix of letters and numbers.';
  return null;
};

export const validatePersonName = (value: string, field: string): string | null => {
  const clean = value.trim();
  if (!clean) return `${field} is required.`;
  if (clean.length < 2) return `${field} must be at least 2 characters.`;
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(clean)) return `${field} can only contain letters.`;
  return null;
};
