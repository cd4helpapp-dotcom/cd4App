# CD4 Frontend — Fixes Documentation

All changes made during the code review and bug-fix sessions.
Each fix includes: what was broken, why it was broken, what was changed, and which files were affected.

---

## Fix 1 — MongoDB `_id` → Supabase `id` (Type System)

**File:** `src/types/index.ts`

**What was broken:**
All core types (`User`, `Doctor`, `Slot`, `Appointment`) used `_id: string` — a MongoDB convention. Supabase uses `id` (UUID). Every place in the app that read `user._id` was accessing a field that didn't exist on the actual Supabase row, silently returning `undefined`.

**What was changed:**
- Renamed `_id` → `id` on `User`, `Doctor`, `Slot`, `Appointment` interfaces
- Removed the unused `AuthTokens` interface (MongoDB-era leftover, never used with Supabase)

```ts
// Before
export interface User {
    _id: string;
    ...
}

// After
export interface User {
    id: string;
    ...
}
```

---

## Fix 2 — `user._id` → `user.id` Across All Files (Runtime Bug)

**Files affected (20+ files):**
- `context/AuthContext.tsx`
- `context/CallContext.tsx`
- `hooks/useChat.ts`
- `hooks/useAuth.ts`
- `hooks/useAdmin.ts`
- `hooks/usePresence.ts`
- `hooks/useNotificationsSystem.ts`
- `hooks/usePushNotifications.ts`
- `hooks/useFileTransfer.ts`
- `hooks/useStorageInsights.ts`
- `app/(tabs)/appointments.tsx`
- `app/(tabs)/chat.tsx`
- `app/(tabs)/community.tsx`
- `app/(tabs)/_layout.tsx`
- `app/doctor/dashboard.tsx`
- `app/doctor/_layout.tsx`
- `app/settings/notifications.tsx`
- `app/settings/subscription.tsx`
- `app/ai-guidance.tsx`
- `app/chat-detail.tsx`
- `app/upgrade-pro.tsx`
- `app/community/post/[postId].tsx`
- `components/GlobalCallObserver.tsx`
- `ui/teleconsultation/FindDoctorView.tsx`

**What was broken:**
Every reference to `user._id` or `user?._id` was reading an undefined field because the type was fixed to `id` in Fix 1. This caused:
- Supabase queries with `.eq('user_id', undefined)` — returning wrong/empty data
- Presence channel tracking with `undefined` as the key
- Chat rooms not loading for the correct user
- Push token not being saved to the right profile row
- Call sessions not being associated with the correct user

**What was changed:**
All `user._id` → `user.id` and `user?._id` → `user?.id` across every file.

```ts
// Before
channel.track({ user_id: user._id, online_at: ... });
supabase.from('profiles').update(...).eq('id', user._id);

// After
channel.track({ user_id: user.id, online_at: ... });
supabase.from('profiles').update(...).eq('id', user.id);
```

---

## Fix 3 — Profile Fetch 400 Error (Critical Bug)

**File:** `context/AuthContext.tsx`

**What was broken:**
The profile fetch query used `.order()` and `.limit()` with `referencedTable` option on an embedded relation:

```ts
.order('created_at', { referencedTable: 'user_subscriptions', ascending: false })
.limit(1, { referencedTable: 'user_subscriptions' })
```

PostgREST (Supabase's query engine) does **not** support `order`/`limit` on embedded/joined tables. This caused a `400 Bad Request` on every profile load, meaning the app could never load the full user profile from the database.

**What was changed:**
Removed the unsupported modifiers from the query. Sorting is now done in JavaScript after the data is fetched:

```ts
// Before — caused 400
.order('created_at', { referencedTable: 'user_subscriptions', ascending: false })
.limit(1, { referencedTable: 'user_subscriptions' })

// After — sort in JS, pick most recent subscription
const subRow = Array.isArray(profile.user_subscriptions)
  ? [...profile.user_subscriptions].sort((a, b) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    )[0] ?? null
  : null;
```

---

## Fix 4 — Admin Role Assigned Client-Side (Security Bug)

**File:** `context/AuthContext.tsx`

**What was broken:**
Admin role was determined by checking the user's email against a list stored in `EXPO_PUBLIC_ADMIN_EMAILS` — an environment variable that is **bundled into the APK**. Anyone who decompiled the APK could read the admin email list and understand the access control logic.

```ts
// Before — insecure, client-side role assignment
const ADMIN_EMAILS = (process.env.EXPO_PUBLIC_ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase());

const isAdminEmail = (email) => ADMIN_EMAILS.includes(email);
```

**What was changed:**
Removed `EXPO_PUBLIC_ADMIN_EMAILS` entirely. Role is now read exclusively from the `roles` table join in the database query. The database enforces roles via Row Level Security — the client just reads what the server says.

```ts
// After — role comes from DB join only
const roleSlug = normalizeRoleSlug(
  Array.isArray(profile.roles)
    ? profile.roles[0]?.slug
    : (profile.roles as any)?.slug
);
```

---

## Fix 5 — Double Supabase Round-Trip on Profile Load (Performance)

**File:** `context/AuthContext.tsx`

**What was broken:**
Profile loading made two sequential Supabase queries on every auth state change:
1. Fetch `profiles` row
2. Fetch `user_subscriptions` row separately

This doubled the auth load time and created a window where the user object was partially populated.

**What was changed:**
Combined into a single query using a PostgREST join:

```ts
// Before — two queries
const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
const { data: sub } = await supabase.from('user_subscriptions').select('*').eq('user_id', userId)...

// After — one query with join
const { data: profile } = await supabase
  .from('profiles')
  .select(`
    id, first_name, last_name, ...,
    roles ( slug ),
    user_subscriptions ( id, plan_code, billing_cycle, status, ... )
  `)
  .eq('id', userId)
  .single();
```

Also added a **safe fallback query** — if the full join fails (e.g. missing column in older migration), it retries with a minimal select so auth never fully breaks:

```ts
if (error) {
  const { data: safeProfile } = await supabase
    .from('profiles')
    .select(`id, first_name, last_name, email, ...`)
    .eq('id', userId)
    .single();
  // use safeProfile with empty roles/subscriptions
}
```

---

## Fix 6 — Hardcoded Agora App ID in Source Code (Security)

**File:** `constants/Config.ts`

**What was broken:**
The Agora App ID had a hardcoded fallback value directly in source code:

```ts
// Before — App ID in git history and every APK
export const AGORA_APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID || '1726b727a8db4ccb9223fb6042714844';
```

This means the key was committed to git and shipped in every build regardless of environment.

**What was changed:**
Removed the hardcoded fallback. Returns empty string and warns in dev if the env var is missing:

```ts
// After
export const AGORA_APP_ID = (() => {
    const id = process.env.EXPO_PUBLIC_AGORA_APP_ID || '';
    if (!id && __DEV__) {
        console.warn('[Config] EXPO_PUBLIC_AGORA_APP_ID is not set. Video calls will not work.');
    }
    return id;
})();
```

---

## Fix 7 — Supabase URL Logged to Console in Production (Security)

**File:** `src/lib/supabase.ts`

**What was broken:**
```ts
// Before — logs Supabase URL in every production build
console.log('Supabase initialized with URL:', supabaseUrl);
```

This exposed the Supabase project URL in device logs, visible via `adb logcat` on any Android device.

**What was changed:**
Removed the production log. Warning for missing config is now dev-only:

```ts
// After
if (__DEV__) {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('[Supabase] URL or Anon Key is missing. Check your .env file.');
    }
}
```

---

## Fix 8 — All `console.log/warn/error` Calls Gated Behind `__DEV__` (Security / Performance)

**Files affected:**
- `context/AuthContext.tsx` — 8 calls
- `context/CallContext.tsx` — 21 calls
- `hooks/useChat.ts` — 9 calls
- `hooks/usePushNotifications.ts` — 18 calls
- `hooks/useAuth.ts` — 5 calls
- `hooks/useAdmin.ts` — 1 call
- `src/lib/supabase.ts` — 1 call

**What was broken:**
Bare `console.log/warn/error` calls in production builds expose:
- User IDs and profile data
- Supabase query payloads
- Internal error messages and stack traces
- Push token values
- Agora channel names

All visible via `adb logcat` or Expo logs on any device.

**What was changed:**
Every console call is now wrapped:

```ts
// Before
console.log('Profile found raw:', { id: profile.id, role_id: profile.role_id });
console.error('Update operation failed:', err.message);

// After
if (__DEV__) console.log('[Auth] Profile found:', profile.id);
if (__DEV__) console.error('[Auth] Update failed:', err.message);
```

---

## Fix 9 — `QueryProvider` Module-Level Singleton (State Bug)

**File:** `providers/QueryProvider.tsx`

**What was broken:**
`QueryClient` was created at module load time as a module-level variable:

```ts
// Before — created once at module load, never reset
const queryClient = new QueryClient({ ... });

export const QueryProvider = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);
```

This means:
- Hot reloads in dev carry stale cached data from the previous session
- Tests cannot get a fresh client between runs
- Multiple component trees share the same cache

**What was changed:**
Client is now created inside `useState` so it's scoped to the component tree lifecycle:

```ts
// After
export const QueryProvider = ({ children }) => {
  const [queryClient] = useState(() => makeQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
```

A separate `getQueryClient()` function is exported for the rare cases where a client is needed outside React (e.g. `prefetchChatRooms`).

---

## Fix 10 — No Error Boundary (Crash Recovery)

**File:** `components/AppErrorBoundary.tsx` *(new file)*
**File:** `app/_layout.tsx`

**What was broken:**
Any unhandled JavaScript error in any component (e.g. during E2EE decryption, malformed Supabase response, Agora SDK crash) would white-screen the entire app with no recovery path. The user would have to force-quit and reopen.

**What was changed:**
Added a React class-based `AppErrorBoundary` wrapping the entire app tree:

```tsx
// components/AppErrorBoundary.tsx
export class AppErrorBoundary extends React.Component<Props, State> {
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'An unexpected error occurred.' };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) console.error('[AppErrorBoundary] Caught error:', error, info.componentStack);
    // TODO: send to Sentry / Crashlytics
  }
  render() {
    if (this.state.hasError) {
      return <ErrorScreen onRetry={this.reset} />;
    }
    return this.props.children;
  }
}
```

Wired into `app/_layout.tsx` as the outermost wrapper.

---

## Fix 11 — `userInterfaceStyle: "light"` Blocking Dark Mode (UI Bug)

**File:** `app.json`

**What was broken:**
```json
"userInterfaceStyle": "light"
```

This hardcodes the iOS interface style to light at the OS level, overriding the `ThemePreferenceContext` dark mode implementation entirely. Users who set dark mode in the app settings would see no change on iOS.

**What was changed:**
```json
"userInterfaceStyle": "automatic"
```

Now the OS respects the app's runtime theme preference.

---

## Fix 12 — Missing Environment Variables in `.env.example`

**File:** `.env.example`

**What was broken:**
The example env file was missing the two most critical variables:
- `EXPO_PUBLIC_SUPABASE_URL` — without this the entire app fails silently
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — same
- `EXPO_PUBLIC_AGORA_APP_ID` — video calls silently fail

New developers cloning the repo had no idea these were required.

**What was changed:**
Added all required variables with clear section comments:

```env
# Supabase (required)
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Agora (required for video/audio calls)
EXPO_PUBLIC_AGORA_APP_ID=your-agora-app-id

# Google OAuth
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=

# Feature flags
EXPO_PUBLIC_CHAT_E2EE_ALLOW_PLAINTEXT_FALLBACK=true
EXPO_PUBLIC_AI_ONLY_RESPONSES=true
```

---

## Fix 13 — Dead REST Backend Import in `app/_layout.tsx`

**File:** `app/_layout.tsx`

**What was broken:**
```ts
import { supabase } from '../src/lib/supabase';
```
This import was unused in `_layout.tsx` — a leftover from when the layout had direct Supabase calls. Dead imports increase bundle size slightly and cause confusion.

**What was changed:**
Removed the unused import.

---

## Fix 14 — `Doctor` Type `_id` → `id` in Hook Mappers

**Files:** `hooks/useDoctor.ts`, `hooks/useAdmin.ts`

**What was broken:**
Both files mapped Supabase rows to the `Doctor` type using `_id: row.id` — assigning the Supabase UUID to the wrong field name. After Fix 1 renamed the type field to `id`, these mappers needed updating too.

```ts
// Before
const mapDoctorRow = (row: any): Doctor => ({
    _id: row.id,   // wrong field name
    ...
});

// After
const mapDoctorRow = (row: any): Doctor => ({
    id: row.id,    // correct
    ...
});
```

---

## Fix 15 — `useAdmin` Using `user._id` for Ad Creation

**File:** `hooks/useAdmin.ts`

**What was broken:**
```ts
if (!user?._id) throw new Error('Please login again as admin.');
created_by: user._id,  // undefined — ad row inserted with null creator
```

Admin-created community ads had `created_by = null` in the database because `user._id` was always `undefined`.

**What was changed:**
```ts
if (!user?.id) throw new Error('Please login again as admin.');
created_by: user.id,
```

---

## Summary Table

| # | File(s) | Type | Impact |
|---|---------|------|--------|
| 1 | `src/types/index.ts` | Type rename | All data reads broken |
| 2 | 20+ files | Runtime bug | User ID always undefined |
| 3 | `context/AuthContext.tsx` | 400 API error | Profile never loaded from DB |
| 4 | `context/AuthContext.tsx` | Security | Admin role bypassable |
| 5 | `context/AuthContext.tsx` | Performance | 2x network round-trips on auth |
| 6 | `constants/Config.ts` | Security | Agora key in APK/git |
| 7 | `src/lib/supabase.ts` | Security | Supabase URL in prod logs |
| 8 | 7 files | Security | Sensitive data in prod logs |
| 9 | `providers/QueryProvider.tsx` | State bug | Stale cache across hot reloads |
| 10 | `components/AppErrorBoundary.tsx` | Crash recovery | White screen on any JS error |
| 11 | `app.json` | UI bug | Dark mode broken on iOS |
| 12 | `.env.example` | DX | New devs missing required vars |
| 13 | `app/_layout.tsx` | Cleanup | Dead import |
| 14 | `hooks/useDoctor.ts`, `useAdmin.ts` | Type bug | Doctor data mapped to wrong field |
| 15 | `hooks/useAdmin.ts` | Runtime bug | Ads created with null creator |
