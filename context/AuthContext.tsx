import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { User } from '../src/types';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { ensureE2EEIdentity } from '../src/lib/e2ee';
import { resolveStorageSignedUrl } from '../src/utils/storageSignedUrl';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isProfileResolved: boolean;
  isProfileLoadedFromDb: boolean;
  refreshAuth: () => Promise<void>;
  refetchUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeRoleSlug = (value: unknown): User['role'] => {
  if (typeof value !== 'string') return 'Patient';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'admin') return 'Admin';
  if (normalized === 'doctor') return 'Doctor';
  if (normalized === 'marketing') return 'Marketing';
  if (normalized === 'hospital') return 'Hospital';
  return 'Patient';
};

const buildFallbackUserFromSession = (
  sessionUser: Session['user'],
  fallbackRole?: User['role']
): User => {
  const metadata = (sessionUser.user_metadata || {}) as Record<string, unknown>;
  const email = sessionUser.email || '';
  const role = fallbackRole ?? normalizeRoleSlug(metadata.role);
  const firstName =
    (typeof metadata.first_name === 'string' ? metadata.first_name.trim() : '') ||
    (typeof metadata.firstName === 'string' ? metadata.firstName.trim() : '') ||
    'User';
  const lastName =
    (typeof metadata.last_name === 'string' ? metadata.last_name.trim() : '') ||
    (typeof metadata.lastName === 'string' ? metadata.lastName.trim() : '');
  const phoneNumber =
    (typeof metadata.phone_number === 'string' ? metadata.phone_number.trim() : '') ||
    (typeof metadata.phoneNumber === 'string' ? metadata.phoneNumber.trim() : '') ||
    (typeof metadata.phone === 'string' ? metadata.phone.trim() : '') ||
    '';
  const profilePicture =
    typeof metadata.profile_picture === 'string'
      ? metadata.profile_picture
      : typeof metadata.profilePicture === 'string'
        ? metadata.profilePicture
        : undefined;
  const nowIso = new Date().toISOString();

  return {
    id: sessionUser.id,
    _id: sessionUser.id,
    firstName,
    lastName,
    email,
    phoneNumber,
    role,
    isVerified: Boolean(sessionUser.email_confirmed_at || sessionUser.phone_confirmed_at),
    profilePicture,
    createdAt: sessionUser.created_at || nowIso,
    updatedAt: nowIso,
  };
};

const bootstrapE2EE = async (userId?: string | null) => {
  if (!userId) return;
  try {
    await ensureE2EEIdentity(userId);
  } catch (error) {
    if (__DEV__) console.warn('[Auth] E2EE identity bootstrap failed:', error);
  }
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

// Fetch profile first, then optional relations separately (safer across schema variants).
const fetchUserProfile = async (userId: string, retries = 3): Promise<User | null> => {
  const PROFILE_SELECT = `
    id, first_name, last_name, email, phone_number,
    age, gender, address, weight, blood_pressure, pulse,
    profile_setup_completed, settings, is_verified, role_id,
    profile_picture, created_at, updated_at
  `;

  for (let i = 0; i < retries; i++) {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select(PROFILE_SELECT)
        .eq('id', userId)
        .single();

      if (error) {
        if (__DEV__) console.warn(`[Auth] Profile fetch attempt ${i + 1} failed:`, error.message);
        if (i < retries - 1) await new Promise((res) => setTimeout(res, 500));
        continue;
      }

      if (!profile) {
        if (i < retries - 1) await new Promise((res) => setTimeout(res, 500));
        continue;
      }

      const [roleSlug, subRow] = await Promise.all([
        (async (): Promise<User['role']> => {
          try {
            if (!profile.role_id) return 'Patient';
            const { data: roleRow } = await supabase
              .from('roles')
              .select('slug')
              .eq('id', profile.role_id)
              .single();
            return normalizeRoleSlug(roleRow?.slug);
          } catch {
            return 'Patient';
          }
        })(),
        (async () => {
          try {
            const { data: subRows } = await supabase
              .from('user_subscriptions')
              .select('id, plan_code, billing_cycle, status, expires_at, next_billing_at, payment_id, amount_paid, currency, created_at')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(1);
            return Array.isArray(subRows) ? subRows[0] ?? null : null;
          } catch {
            return null;
          }
        })(),
      ]);

      let mappedSubscription: User['subscription'] | undefined;
      if (subRow) {
        mappedSubscription = {
          id: subRow.id,
          planCode: subRow.plan_code || 'pro',
          billingCycle: subRow.billing_cycle === 'monthly' ? 'monthly' : 'yearly',
          status: subRow.status || 'pending',
          expiresAt: subRow.expires_at || null,
          nextBillingAt: subRow.next_billing_at || null,
          paymentId: subRow.payment_id || null,
          amountPaid:
            typeof subRow.amount_paid === 'number'
              ? subRow.amount_paid
              : Number.isFinite(Number(subRow.amount_paid))
                ? Number(subRow.amount_paid)
                : null,
          currency: subRow.currency || 'INR',
        };
      }

      const mappedUser: User = {
        id: profile.id,
        _id: profile.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        email: profile.email,
        phoneNumber: profile.phone_number,
        age: profile.age,
        gender: profile.gender,
        address: profile.address,
        weight: profile.weight,
        bloodPressure: profile.blood_pressure,
        pulse: profile.pulse,
        profileSetupCompleted: profile.profile_setup_completed,
        settings: profile.settings,
        role: roleSlug,
        isVerified: profile.is_verified,
        subscription: mappedSubscription,
        profilePicture: profile.profile_picture,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      };

      mappedUser.profilePicture = await withTimeout(
        resolveStorageSignedUrl({
          bucket: SUPABASE_PROFILE_MEDIA_BUCKET,
          value: mappedUser.profilePicture,
          ttlSeconds: 60 * 60 * 24 * 7,
        }),
        450,
        mappedUser.profilePicture
      );

      return mappedUser;
    } catch (e) {
      if (__DEV__) console.error('[Auth] fetchUserProfile error:', e);
    }
  }
  return null;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileResolved, setIsProfileResolved] = useState(false);
  const [isProfileLoadedFromDb, setIsProfileLoadedFromDb] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const handleDeepLink = async (url: string | null) => {
      if (!url) return;
      const queryStr = url.split('#')[1] || url.split('?')[1];
      if (!queryStr) return;
      const params = new URLSearchParams(queryStr);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error && __DEV__) console.error('[Auth] Error setting session from URL:', error.message);
      }
    };

    Linking.getInitialURL().then(handleDeepLink);
    const linkingSubscription = Linking.addEventListener('url', (event) => handleDeepLink(event.url));

    const initializeAuth = async () => {
      setIsLoading(true);
      setIsProfileResolved(false);
      setIsProfileLoadedFromDb(false);
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(initialSession);
        if (!initialSession?.user) {
          setUser(null);
          setIsProfileResolved(true);
          setIsProfileLoadedFromDb(false);
          return;
        }

        // Keep navigation blocked until the database role is resolved.
        // Otherwise doctor/admin users can briefly see the patient tab shell.
        const fallbackUser = buildFallbackUserFromSession(initialSession.user);
        setUser(fallbackUser);

        const profile = await fetchUserProfile(initialSession.user.id);
        if (!isMounted) return;
        if (profile) {
          setUser(profile);
          setIsProfileLoadedFromDb(true);
        }
        setIsProfileResolved(true);
        void bootstrapE2EE(initialSession.user.id);
      } catch (error) {
        if (__DEV__) console.error('[Auth] Initialize failed:', error);
        if (isMounted) {
          setIsProfileResolved(true);
          setIsProfileLoadedFromDb(false);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void (async () => {
        if (!isMounted) return;

        if (_event === 'PASSWORD_RECOVERY') {
          router.push('/auth/reset-password');
        }

        const isMajorChange = _event === 'INITIAL_SESSION' || _event === 'SIGNED_IN' || _event === 'SIGNED_OUT';
        const shouldSyncProfile = _event === 'INITIAL_SESSION' || _event === 'SIGNED_IN' || _event === 'USER_UPDATED';

        if (isMajorChange) setIsLoading(true);

        try {
          setSession(nextSession);

          if (!nextSession?.user) {
            setUser(null);
            setIsProfileResolved(true);
            setIsProfileLoadedFromDb(false);
            return;
          }

          const fallbackUser = buildFallbackUserFromSession(nextSession.user);
          if (isMajorChange || shouldSyncProfile) {
            setUser(fallbackUser);
            setIsProfileLoadedFromDb(false);
          } else {
            setUser((current) => current ?? fallbackUser);
          }

          if (!shouldSyncProfile) return;

          setIsProfileResolved(false);
          const profile = await fetchUserProfile(nextSession.user.id);
          if (!isMounted) return;
          if (profile) {
            setUser(profile);
            setIsProfileLoadedFromDb(true);
          }
          setIsProfileResolved(true);
          void bootstrapE2EE(nextSession.user.id);
        } catch (error) {
          if (__DEV__) console.error('[Auth] State sync failed:', error);
          if (isMounted) {
            setIsProfileResolved(true);
            setIsProfileLoadedFromDb(false);
          }
        } finally {
          if (isMounted && isMajorChange) setIsLoading(false);
        }
      })();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      linkingSubscription.remove();
    };
  }, []);

  const refreshAuth = async () => {
    const { data: sessionState, error: sessionStateError } = await supabase.auth.getSession();
    if (sessionStateError) {
      if (__DEV__) console.error('[Auth] Refresh session read error:', sessionStateError.message);
      return;
    }

    const activeSession = sessionState.session;
    if (!activeSession?.refresh_token) {
      setSession(null);
      setUser(null);
      return;
    }

    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      const message = error.message || '';
      if (/auth session missing/i.test(message)) {
        setSession(null);
        setUser(null);
        return;
      }
      if (__DEV__) console.error('[Auth] Refresh session error:', message);
      return;
    }

    const refreshedSession = data.session ?? activeSession;
    setSession(refreshedSession);

    if (refreshedSession?.user) {
      const profile = await fetchUserProfile(refreshedSession.user.id);
      setUser(profile);
      void bootstrapE2EE(refreshedSession.user.id);
    } else {
      setUser(null);
    }
  };

  const refetchUser = async (): Promise<User | null> => {
    if (!session?.user) {
      if (__DEV__) console.warn('[Auth] refetchUser called without active session');
      return null;
    }
    const profile = await fetchUserProfile(session.user.id);
    setUser(profile);
    return profile;
  };

  const value: AuthContextType = {
    user,
    session,
    isAuthenticated: !!session,
    isLoading,
    isProfileResolved,
    isProfileLoadedFromDb,
    refreshAuth,
    refetchUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};
