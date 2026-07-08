# Project Memory

This note is a lightweight, local memory for the CD4 codebase.
When we return to this project later, start here for the current map.

## What this project is
- CD4 is a healthcare app with AI chat, voice chat, doctor discovery, booking, notifications, and Supabase-backed edge functions.
- The main AI UX lives in `app/ai-guidance.tsx`.
- Voice intake and chat orchestration live in `supabase/functions/voice-chat` and `supabase/functions/chat-ai`.

## Important areas
- Doctor search and booking logic:
  - `supabase/functions/chat-ai/tools.ts`
  - `supabase/functions/chat-ai/shared.ts`
  - `hooks/useAppointment.ts`
- Voice/chat UI:
  - `app/ai-guidance.tsx`
  - `app/chat-detail.tsx`
- Notifications:
  - `hooks/useNotificationsSystem.ts`
  - `hooks/usePushNotifications.ts`

## Current bug themes we were debugging
- Wrong doctor or wrong slot being reused from history.
- AI snapshot questions not matching the intended triage slot.
- Over-permissive fallback logic in booking flows.
- Regex-based snapshot extraction missing natural-language variants.

## Working rule of thumb
- Prefer exact, user-intended doctor and slot matching.
- Avoid silent fallbacks when intent is ambiguous.
- Keep triage questions and snapshot extraction aligned with the same concern-specific templates.

## Last known investigation point
- `supabase/functions/chat-ai/tools.ts` was the main source of the wrong-doctor / wrong-slot behavior.
- `supabase/functions/save-ai-report/index.ts` and `supabase/functions/send-appointment-notification/index.ts` were the main snapshot extraction paths.
