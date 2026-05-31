import { supabase } from '../lib/supabase';

export type EmailRegistrationStatus = {
  exists: boolean;
  role?: string | null;
};

export const normalizeAuthEmail = (value: string): string => value.trim().toLowerCase();

export const getEmailAlreadyRegisteredMessage = (role?: string | null): string => {
  const normalizedRole = (role || '').trim().toLowerCase();
  if (normalizedRole === 'doctor') {
    return 'This email is already registered as a doctor. Please login instead.';
  }
  if (normalizedRole === 'admin') {
    return 'This email is already registered. Please login instead.';
  }
  return 'This email is already registered. Please login instead.';
};

export const checkEmailRegistrationStatus = async (email: string): Promise<EmailRegistrationStatus | null> => {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail) return null;

  try {
    const { data, error } = await supabase.functions.invoke('check-auth-identity', {
      body: { email: normalizedEmail },
    });

    if (error || !data || data.success === false) {
      return null;
    }

    return {
      exists: Boolean(data.exists),
      role: typeof data.role === 'string' ? data.role : null,
    };
  } catch {
    return null;
  }
};

export const isExistingEmailSignupResult = (data: unknown): boolean => {
  const user = (data as any)?.user;
  if (!user) return false;
  const identities = (user as any)?.identities;
  return Array.isArray(identities) && identities.length === 0;
};
