import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

// Shared post-auth routing used by every sign-in path (email, Google, signup, OTP).
// Keeping it in one place stops login and signup from routing the same user differently.

type ProfileSnapshot = {
  id: string;
  role_id?: string | null;
  age: number | null;
  gender: string | null;
  address: string | null;
  profile_setup_completed: boolean | null;
};

export type AppRole = 'admin' | 'doctor' | 'hospital' | 'marketing' | 'patient';

const ADMIN_EMAILS = (process.env.EXPO_PUBLIC_ADMIN_EMAILS || '')
  .split(',')
  .map((email: string) => email.trim().toLowerCase())
  .filter((email: string) => email.length > 0);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeRole = (value: unknown): AppRole | null => {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  if (slug === 'admin' || slug === 'doctor' || slug === 'hospital' || slug === 'marketing' || slug === 'patient') {
    return slug;
  }
  return null;
};

const hasCompletedPatientSetup = (profile: ProfileSnapshot | null): boolean => {
  if (!profile) return false;
  if (profile.profile_setup_completed === true) return true;

  const hasAge = typeof profile.age === 'number' && profile.age > 0;
  const hasGender =
    typeof profile.gender === 'string' &&
    ['male', 'female', 'other'].includes(profile.gender.trim().toLowerCase());
  const hasAddress = typeof profile.address === 'string' && profile.address.trim().length > 0;
  return hasAge && hasGender && hasAddress;
};

// The profile row is created by a DB trigger right after sign-up, so a fresh account
// can briefly have no row. Retry a few times before giving up.
const fetchProfileWithRole = async (
  userId: string,
  retries = 3
): Promise<{ profile: ProfileSnapshot | null; role: AppRole | null }> => {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role_id, age, gender, address, profile_setup_completed')
      .eq('id', userId)
      .single();

    if (!error && data) {
      let role: AppRole | null = null;
      if (data.role_id) {
        const { data: roleRow } = await supabase.from('roles').select('slug').eq('id', data.role_id).single();
        role = normalizeRole(roleRow?.slug);
      }
      return { profile: data as ProfileSnapshot, role };
    }

    if (attempt < retries - 1) await sleep(250);
  }

  return { profile: null, role: null };
};

export const resolveRoleForUser = async (userId: string) => {
  const { profile, role: profileRole } = await fetchProfileWithRole(userId);
  const { data: sessionData } = await supabase.auth.getSession();
  const authUser = sessionData.session?.user;
  const email = authUser?.email?.trim().toLowerCase() || '';

  // Admin emails and auth metadata are routing hints only; data access is still enforced by RLS.
  let role: AppRole | null = ADMIN_EMAILS.includes(email) ? 'admin' : profileRole;
  if (!role || role === 'patient') {
    const metadataRole = normalizeRole(authUser?.user_metadata?.role);
    if (metadataRole && metadataRole !== 'marketing') role = metadataRole;
  }

  return { role: role ?? (profile ? 'patient' : null), profile };
};

export const routeAfterSuccessfulAuth = async (userId: string): Promise<void> => {
  const { role, profile } = await resolveRoleForUser(userId);

  if (!role) {
    // Profile not readable yet — let the root index decide once AuthContext resolves.
    router.replace('/');
    return;
  }

  if (role === 'admin') return void router.replace('/admin/dashboard');
  if (role === 'doctor') return void router.replace('/doctor/dashboard');
  if (role === 'hospital') return void router.replace('/hospital/dashboard');

  if (!hasCompletedPatientSetup(profile)) {
    router.replace('/profile-setup');
    return;
  }

  router.replace('/(tabs)');
};
