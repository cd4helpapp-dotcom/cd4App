# Settings Dynamic + i18n Update Documentation

## Overview
This update makes Settings more dynamic, real-time, and translation-ready.

Main goals achieved:
- Settings labels are no longer static-only; important items now show live values.
- Language is now centralized through a context-based i18n layer.
- Notifications and storage sections are data-driven and refresh in near real time.
- User settings state stays synced with profile updates instead of stale local-only toggles.

---

## Architecture Changes

### 1) App language layer (new)
New files:
- `src/i18n/settingsI18n.ts`
- `context/AppLanguageContext.tsx`

What it does:
- Defines language options and translation keys for settings flows.
- Normalizes profile language values into app language codes (`en`, `hi`, `bn`, `mr`, `ta`).
- Exposes `t(key, params)` translator helper to screens.
- Persists chosen language in AsyncStorage (`cd4_app_language_v1`).
- Reacts to profile settings change (`user.settings.language`) and updates UI instantly.

Note:
- Hindi has dedicated translations.
- Bengali/Marathi/Tamil currently fallback to English map (safe fallback behavior).

### 2) Provider integration
Updated file:
- `app/_layout.tsx`

What changed:
- App now wraps screens with `AppLanguageProvider` so settings screens can call `useAppLanguage()` anywhere in app tree.

---

## Dynamic Data Layer

### 3) Storage insights hook (new)
New file:
- `hooks/useStorageInsights.ts`

Data sources:
- AsyncStorage keys and values (local bytes estimate).
- Medical report list (`useMedicalReports`) for report count and report file bytes.
- Notification count (`useNotificationsSystem`) for unread notifications.

Exposed metrics:
- `localStorageBytes`, `localStorageKeys`
- `reportsBytes`, `reportsCount`
- `unreadNotifications`
- `totalBytes`
- formatted values (`formatBytes`)

Real-time behavior:
- Poll refresh every ~25 seconds.
- Manual refetch support.

Clear cache behavior:
- Removes only local clearable keys using allowlist patterns.
- Clears React Query cache (`queryClient.clear()`).
- Refetches all insights.

---

## Settings Screens Updated

### 4) Main Patient Settings
Updated file:
- `app/(tabs)/settings.tsx`

Changes:
- Uses `useAppLanguage()` for labels and toast messages.
- Uses `useStorageInsights()` for live badges/details.
- Dynamic labels:
  - `Notifications (count)`
  - `Storage and Data (size)`
  - `App Language (current language)`
  - `Appearance (mode)`
- Greeting, logout text, version text are translated.

### 5) Main Doctor Settings
Updated file:
- `app/doctor/settings.tsx`

Changes:
- Same dynamic pattern as patient settings.
- Doctor-specific items also translated.
- Live count and size labels added.

### 6) Appearance Settings
Updated file:
- `app/settings/appearance.tsx`

Changes:
- All visible text now via translation keys.
- Mode labels now come from i18n keys.
- Success/failure toast messages translated.
- Dynamic subtitle reflects resolved device mode in translated format.

### 7) Language Settings
Updated file:
- `app/settings/language.tsx`

Changes:
- Uses central language options from context.
- Calls `setLanguagePreference(...)` for immediate UI language switch.
- Persists profile setting through `useUpdateSettings`.
- Handles async mutation state and revert logic on failure.

### 8) Notifications Settings
Updated file:
- `app/settings/notifications.tsx`

Changes:
- Translated labels and error messages.
- Optimistic update logic now uses consistent previous/next state snapshots.
- Reverts cleanly on failure.
- UI auto-syncs from latest `user.settings.notifications` via `useEffect` (real-time profile sync).

### 9) Storage Settings
Updated file:
- `app/settings/storage.tsx`

Changes:
- Removed fake static cache size.
- Now shows live data:
  - total app cached data
  - local storage
  - report files
  - reports count
  - unread notifications
  - cache key count
- Clear cache now executes real cleanup flow (with success/failure toasts).
- Fully translated screen labels and descriptions.

### 10) Privacy Settings
Updated file:
- `app/settings/privacy.tsx`

Changes:
- Translated labels.
- Syncs selected value from profile settings updates.

### 11) Chats Settings
Updated file:
- `app/settings/chats.tsx`

Changes:
- No longer local-only toggles.
- Saves to profile settings under `settings.chats`.
- Added type support in shared types.
- Reverts values on mutation failure.
- Translated labels/subtext.

### 12) Help + Avatar screens
Updated files:
- `app/settings/help.tsx`
- `app/settings/avatar.tsx`

Changes:
- Headings/buttons/messages moved to translation keys.

---

## Type Model Updates
Updated file:
- `src/types/index.ts`

Changes:
- Added optional `settings.chats` fields:
  - `readReceipts?: boolean`
  - `mediaAutoDownload?: boolean`
- Added same shape to `UpdateSettingsData`.

---

## Real-time + Dynamic Behavior Summary

1. Language changes:
- User picks language.
- UI updates instantly via context.
- Profile settings mutation runs.
- Future sessions hydrate from AsyncStorage and profile.

2. Notification toggles:
- Optimistic switch update.
- Mutation persists profile settings.
- Auto-revert on failure.
- Values re-sync if profile changes elsewhere.

3. Storage panel:
- Reads live stats from local + DB-driven hooks.
- Poll refresh keeps values current.
- Clear cache runs real cleanup + query cache clear + refetch.

---

## Known Current Scope

- This i18n layer currently targets Settings domain screens.
- Hindi has custom map.
- `bn/mr/ta` currently fallback to English keys until dedicated translations are added.

---

## How to Extend

1) Add new settings translation key:
- Add key in `EN_TRANSLATIONS` and `HI_TRANSLATIONS` in `src/i18n/settingsI18n.ts`.

2) Use in UI:
- `const { t } = useAppLanguage()`
- `t('your.key')` or `t('your.key', { param: value })`

3) Add new dynamic metric:
- Extend `hooks/useStorageInsights.ts`.
- Surface metric in settings screen labels or rows.

---

## Verification

Validation done:
- `npx tsc --noEmit` passes.

