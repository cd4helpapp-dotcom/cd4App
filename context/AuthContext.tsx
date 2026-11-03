import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { User } from '../src/types';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const fallbackName =
    (typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '') ||
    (typeof metadata.name === 'string' ? metadata.name.trim() : '');
  const [fallbackFirstName = '', ...fallbackLastNameParts] = fallbackName.split(/\s+/).filter(Boolean);
  const firstName =
    (typeof metadata.first_name === 'string' ? metadata.first_name.trim() : '') ||
    (typeof metadata.firstName === 'string' ? metadata.firstName.trim() : '') ||
    fallbackFirstName ||
    'User';
  const lastName =
    (typeof metadata.last_name === 'string' ? metadata.last_name.trim() : '') ||
    (typeof metadata.lastName === 'string' ? metadata.lastName.trim() : '') ||
    fallbackLastNameParts.join(' ');
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
        : typeof metadata.avatar_url === 'string'
          ? metadata.avatar_url
          : typeof metadata.picture === 'string'
            ? metadata.picture
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

// initializeAuth() and the INITIAL_SESSION auth event both load the profile at app start; share one request
// instead of running the whole chain twice. Role slugs never change at runtime, so they are cached.
const inflightProfiles = new Map<string, Promise<User | null>>();
const roleSlugCache = new Map<string, string | null | undefined>();

const fetchUserProfile = (userId: string, retries = 3): Promise<User | null> => {
  const existing = inflightProfiles.get(userId);
  if (existing) return existing;
  const request = fetchUserProfileUncached(userId, retries).finally(() => inflightProfiles.delete(userId));
  inflightProfiles.set(userId, request);
  return request;
};

// Fetch profile first, then optional relations separately (safer across schema variants).
const fetchUserProfileUncached = async (userId: string, retries = 3): Promise<User | null> => {
  // Subscription only needs the user id, so it runs alongside the profile request instead of after it.
  const subscriptionRequest = (async () => {
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
  })();

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
            if (roleSlugCache.has(profile.role_id)) return normalizeRoleSlug(roleSlugCache.get(profile.role_id));
            const { data: roleRow } = await supabase
              .from('roles')
              .select('slug')
              .eq('id', profile.role_id)
              .single();
            if (roleRow?.slug) roleSlugCache.set(profile.role_id, roleRow.slug);
            return normalizeRoleSlug(roleRow?.slug);
          } catch {
            return 'Patient';
          }
        })(),
        subscriptionRequest,
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

// Just enough to open the right screens at once on the next launch. Health details such as weight and blood pressure
// stay out of it and arrive with the fresh profile a moment later.
const PROFILE_CACHE_KEY = 'cd4.profile-snapshot.v1';

const readProfileSnapshot = async (userId: string): Promise<Partial<User> | null> => {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(PROFILE_CACHE_KEY)) || 'null');
    return saved?.id === userId ? saved : null;
  } catch {
    return null;
  }
};

const saveProfileSnapshot = (profile: User) => {
  const { id, _id, firstName, lastName, email, role, isVerified, settings, subscription, profileSetupCompleted } = profile as any;
  void AsyncStorage.setItem(
    PROFILE_CACHE_KEY,
    JSON.stringify({ id, _id, firstName, lastName, email, role, isVerified, settings, subscription, profileSetupCompleted })
  ).catch(() => {});
};

const clearProfileSnapshot = () => {
  void AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {});
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileResolved, setIsProfileResolved] = useState(false);
  const [isProfileLoadedFromDb, setIsProfileLoadedFromDb] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let loadedUserId: string | null = null;

    const handleDeepLink = async (url: string | null) => {
      if (!url) return;
      const queryStr = url.split('#')[1] || url.split('?')[1];
      if (!queryStr) return;
      const params = new URLSearchParams(queryStr);
      const code = params.get('code');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error && __DEV__) console.error('[Auth] Error exchanging auth code from URL:', error.message);
        return;
      }
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

        loadedUserId = initialSession.user.id;
        // Without a saved role, navigation stays blocked until the database answers. Otherwise doctor/admin users can
        // briefly see the patient tab shell. With one, the app opens at once and refreshes behind the scenes.
        const fallbackUser = buildFallbackUserFromSession(initialSession.user);
        const snapshot = await readProfileSnapshot(initialSession.user.id);
        if (!isMounted) return;
        setUser(snapshot ? ({ ...fallbackUser, ...snapshot } as User) : fallbackUser);
        if (snapshot?.role) {
          setIsProfileResolved(true);
          setIsLoading(false);
        }

        const profile = await fetchUserProfile(initialSession.user.id);
        if (!isMounted) return;
        if (profile) {
          setUser(profile);
          setIsProfileLoadedFromDb(true);
          saveProfileSnapshot(profile);
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

        // initializeAuth() already handles the starting session; handling this event too re-showed the loader and repeated every request.
        if (_event === 'INITIAL_SESSION') return;

        if (_event === 'PASSWORD_RECOVERY') {
          router.push('/auth/reset-password');
        }

        // Supabase also sends SIGNED_IN when a browser tab regains focus. For the same person that is not a new login, and must not show the loader again.
        const isRepeatSignIn = _event === 'SIGNED_IN' && Boolean(nextSession?.user?.id) && nextSession?.user?.id === loadedUserId;
        const isMajorChange = (_event === 'SIGNED_IN' && !isRepeatSignIn) || _event === 'SIGNED_OUT';
        const shouldSyncProfile = (_event === 'SIGNED_IN' && !isRepeatSignIn) || _event === 'USER_UPDATED';

        if (isMajorChange) setIsLoading(true);

        try {
          setSession(nextSession);
          loadedUserId = nextSession?.user?.id || null;

          if (!nextSession?.user) {
            clearProfileSnapshot();
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
            saveProfileSnapshot(profile);
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
      if (/auth session missing|invalid_grant|refresh_token_not_found|refresh token.*(expired|invalid)|jwt expired/i.test(message)) {
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
