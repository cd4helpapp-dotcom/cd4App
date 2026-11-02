# CD4 — Production Readiness & Redesign Log

Living log of the production-readiness pass: what was changed, why, and what is still pending.
Newest work is appended at the bottom of each section. Read this first before continuing the pass.

## Context (read before working)

Existing docs reviewed at the start of this pass:

| Doc | Status |
|---|---|
| `implementation.md` | Voice + report-analysis history. Partly stale: `supabase/functions/voice-chat` and `VOICE_ASSISTANT_UI_TEMPLATE.html` no longer exist; voice now runs on OpenAI Realtime (`voice-realtime-session`, `voice-realtime-tools`, `src/services/realtimeVoice.ts`). |
| `docs/project-memory.md` | Short map + known booking bugs (wrong doctor/slot reuse in `chat-ai`). Still relevant. |
| `PAYMENT_REVENUE_IMPLEMENTATION.md` | Payment-first booking, 70/30 split, Razorpay webhook. Current. |
| `SETTINGS_DYNAMIC_UPDATE_DOC.md` | i18n + dynamic settings. Current. |
| `FIXES_DOCUMENTATION.md` | MongoDB → Supabase migration fixes. Historical. |
| `README_AUTH.md` | **Stale** — describes an axios/`services/api.ts` auth layer that no longer exists. Auth is Supabase (`context/AuthContext.tsx`, `ui/auth/*`). |
| `docs/security-ops.md` | Edge-function security runbook. Current. |
| `PLAY_STORE_*.md`, `PRIVACY_POLICY.md` | Release prep. Current. |

## How to run for development / testing

- Web (fastest loop): `npx expo start --web` → http://localhost:8081
- Typecheck: `npx tsc --noEmit` (must stay green; it is the CI gate in `.github/workflows/ci-cd.yml`).
- Native-only features (Google native sign-in, push notifications, Agora calls, Razorpay native sheet, WebRTC voice) cannot be fully exercised on web; they must be smoke-tested on an Android dev/preview build before release.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-01 | Primary brand color moves from green (`#2ECC71`) to the logo's medical blue; green is kept only for success states. | The logo is navy/cyan; a green UI next to a blue logo read as two brands. Blue is the trust color used by most Indian healthcare apps. Confirmed by the owner. |
| 2026-11-01 | System font everywhere (SF / Roboto / Segoe UI); the unloaded `Outfit-*` font references are removed. | `Outfit-*` was referenced in ~50 styles but never loaded, so web rendered those labels in a serif fallback and native silently used the system font — inconsistent typography. |

## Testing method

UI is verified on the running web build in **mobile mode**: Playwright Chromium at 390×844, `isMobile` + `hasTouch`, Android Chrome user agent, light and dark color schemes. Flows are exercised against the real Supabase project (e.g. wrong-password login returns Supabase's `invalid login credentials`, rendered as a friendly banner).

## Work log

### Phase 1 — Design system foundation (2026-11-01)

| File | Change |
|---|---|
| `constants/Colors.ts` | New palette: medical blue primary, cyan accent, semantic status colors (`success`, `warning`, `danger`, `info` + `*Soft`/`*Border`), surface tokens (`surfaceMuted`, `inputBackground`, `divider`, `overlay`), text tiers (`textTertiary`, `textInverse`). All legacy keys (`tint`, `buttonPrimary`, `badgeText`, …) kept and remapped, so the 88 screens already reading the theme switch palette without edits. Dark `buttonText` is now white (was black-on-green). |
| `constants/Design.ts` (new) | `Spacing`, `Radius`, `Typography` scale, `Layout` (max widths, control heights, gutter) and `elevation()` helper (soft iOS shadow / Android elevation). |
| `hooks/useAppTheme.ts` (new) | `{ theme, isDark }` from the user's theme preference. Replaces the `Colors[...]` + `useThemePreference()` boilerplate. |
| `ui/common/AppButton.tsx` (new) | Variants `primary / secondary / outline / ghost / danger`, sizes `sm / md / lg`, loading + disabled + a11y state, pressed feedback. |
| `ui/common/FormField.tsx` (new) | Labelled input: left icon, `+91`-style prefix, built-in password show/hide, focus ring (blue border), inline error / hint text, web outline removed. |
| ~40 style rules in `app/`, `ui/` | Removed unloaded `Outfit-*` fontFamily, replaced with equivalent `fontWeight`. |

### Phase 2 — Auth flow redesign (2026-11-01)

| File | Change |
|---|---|
| `ui/auth/AuthLayout.tsx` (new) | Shared auth frame. Mobile: centered logo + title + subtitle, single column, keyboard-safe scroll. ≥960px (tablet/web): blue brand panel with value props + form column. Secondary screens get a back button and an icon badge. |
| `ui/auth/AuthParts.tsx` (new) | `AuthDivider`, `GoogleButton`, `LegalNotice` (Terms/Privacy links), `FormErrorBanner`, `PasswordStrengthMeter`. |
| `ui/auth/useGoogleSignIn.ts` (new) | Single Google native sign-in hook (was ~150 duplicated lines in Login + Signup). Button hidden where unsupported (web, Expo Go, missing client ID) instead of showing an error toast. OAuth-config details shown only in `__DEV__`. |
| `src/utils/authRouting.ts` (new) | One `routeAfterSuccessfulAuth()` for every sign-in path. **Bug fixed:** signup/Google-from-signup skipped the patient profile-setup check and could land a new patient on the tabs with an empty profile. |
| `src/utils/validation.ts` (new) | Shared email / Indian-mobile / password / name rules. **Bug fixed:** old email regex `\.\w{2,3}$` rejected valid domains like `.info`, `.health`. Password minimum raised 6 → 8 with letters + numbers. Mobile accepts `+91` / leading `0` / spaces. |
| `ui/auth/LoginScreen.tsx` | Rewritten (1357 → ~190 lines). Inline field errors, friendly Supabase error mapping (wrong password, unverified email, rate limit, offline), keyboard "next/go" chaining, autofill hints, doctor-panel card, Terms/Privacy links kept. Removed: fake Apple button ("coming soon" toast), commented-out saved-account chooser, dead phone-login branch. |
| `ui/auth/SignupScreen.tsx` | Rewritten. First/last name row, `+91` mobile field, strength meter. Already-registered email shown inline on the email field. After sign-up: if Supabase returns a session → routed straight in; otherwise a **"Check your inbox"** state with resend-verification (was: toast + bounce to login). |
| `ui/auth/ForgotPasswordScreen.tsx` | Rewritten. "Check your email" state with 60s resend cooldown; no auto-navigate-away. **Bug fixed:** used the OS color scheme instead of the in-app theme preference. |
| `ui/auth/ResetPasswordScreen.tsx` | Rewritten. Explicit "link expired" state (was: toast + silent redirect), confirm field, strength meter, "Continue to CD4" uses shared routing. Same theme bug fixed. |
| `app/auth/verify-otp.tsx` | Rewritten. 6-box code input (one hidden input → paste + OTP autofill work), auto-submit on 6th digit, resend with cooldown, typed OTP `type` param. Same theme bug fixed. |
| `app/auth/LoginScreen.tsx`, `SignupScreen.tsx`, `AuthGuard.tsx` | **Deleted.** Expo Router turned them into stray public routes (`/auth/LoginScreen`, …) duplicating the real ones. |

### Phase 3 — Web/dev noise (2026-11-01)

| File | Change |
|---|---|
| `hooks/usePushNotifications.ts` | Native-only `setNotificationCategoryAsync` / `getLastNotificationResponseAsync` skipped on web (they threw on every web load). |
| `ui/AnimatedSplash.tsx` | Splash logs gated behind `__DEV__`. (Headless Chromium can't decode the H.264 splash MP4; the existing fallback already continues into the app.) |

### Phase 4 — Brand color revision + keyboard handling (2026-11-01)

| File | Change |
|---|---|
| `constants/Colors.ts` | Primary changed to **clinical teal** (`#0E7C7B` light / `#2EC4B6` dark) at the owner's request for a "health" feel; the logo blue becomes `accent`. Dark-mode `buttonPrimary` is a darker teal (`#0E8075`) so white button text keeps ≥4.5:1 contrast. |
| `ui/common/KeyboardAwareScrollView.tsx` (new) | **Bug fixed (Android inputs hidden under keyboard).** The Android app runs edge-to-edge (`edgeToEdgeEnabled=true`, Expo SDK 54 default), so `adjustResize` no longer shrinks the window; screens with `KeyboardAvoidingView behavior={undefined}` on Android were covered by the keyboard. This wrapper pads for the keyboard on both platforms and scrolls the focused input into view (also when focus moves between fields). `FormField` calls it on focus. Used by `AuthLayout`; other form screens should adopt it. |
| ~190 `theme.success*` usages, 40 files | Brand uses (buttons, selected chips, AI cards, icons) moved to `theme.primary*`. Semantic success kept green: verified, paid, available slot, completed, accept call, booking confirmed, analyzed. |

### Phase 5 — Home screen (2026-11-01)

| File | Change |
|---|---|
| `ui/home/PatientHomeShowcase.tsx` | Rewritten on the design system. Teal hero with layered gradient/orbs and a glossy mic/send button (subtle 3D depth), AI disclaimer line, tinted quick-action tiles, "See all" headers, cleaner concern / department / doctor cards. Hero button now **sends typed text** (it always opened voice before). **Bugs fixed:** dark-mode detection compared against the old `#121212` color and never matched; doctors without a photo showed a random stock face from pravatar.cc; verified badge was shown on every doctor (now only `isVerified`); two dead `display:none` sections removed; concern/doctor carousels no longer auto-scroll under the user. |
| Emergency card | **Safety fix:** said "Call a doctor in under 60 seconds" but only opened the doctor list. Now a primary **Call 112** (`tel:112`) button plus "Consult online". |
| `ui/layout/GlobalHeader.tsx` | Renders the same `PatientHomeHeader` as Home, so every tab has one identical header (Chat keeps its own title bar by design). |
| `app/(tabs)/settings.tsx`, `ui/common/SettingsGroup.tsx` (new) | Grouped inset settings (Account / Preferences / Support & legal / Delete account), values on the right, profile card with plan pill, Privacy + Terms rows, real app version. Wrong `$` icon on "Delete account" fixed. Logout now asks for confirmation. |
| `src/utils/confirm.ts` (new) | Cross-platform confirm. `Alert.alert` is a no-op on React Native Web, so confirm dialogs silently never fired on web. |
| `src/utils/avatar.ts`, `assets/images/avatar_placeholder.png` (new) | Neutral silhouette for people without a photo; replaces all 10 pravatar.cc stock faces. |
| `FindDoctorView.tsx` | Missing doctor rating now shows **"New"** (was a fabricated "4.5"); missing experience shows "Experience not listed" (was a fabricated "3+ Years"). |

### Phase 6 — AI voice assistant (2026-11-01)

Root causes of "works on some devices, not others" and "doesn't feel natural":

1. **Speaker routing.** `expo-av`'s audio mode does not control the WebRTC voice stream; Android puts WebRTC in communication mode and many phones (Samsung, Xiaomi, Oppo…) played the AI on the quiet earpiece. → Added `react-native-incall-manager@4.3.0` (pinned) and force the loudspeaker for the session. Loaded lazily, so an old build without the native module falls back instead of crashing. **Requires a new EAS build.**
2. **Push-to-talk.** After every reply the mic was muted and the UI said "Tap mic to speak" — a walkie-talkie, not a conversation. → Hands-free turn taking: the mic re-opens automatically when the assistant's audio has **actually finished playing** (`output_audio_buffer.stopped`, with a length-based fallback), plus a 300 ms guard. Re-opening on `response.done` instead would let the phone's speaker tail (device-dependent buffer) trigger self-interruption. After 30 s of silence the mic pauses; one tap resumes. While the assistant speaks, the mic button interrupts (cancels generation and clears queued audio).
3. **Turn detection.** `server_vad` with threshold 0.76 ignored quiet/low-gain Android mics. → `semantic_vad` (eagerness auto: doesn't cut the patient off mid-thought) + `far_field` input noise reduction for speakerphone use.
4. **Robotic delivery.** Speed 0.88 → 1.0; prompt now asks for spoken, conversational delivery (short sentences, varied acknowledgements, no read-out bullet lists, numbers spoken naturally).
5. **Answering an old question on open.** Opening the panel sent the last stored conversation as history and auto-started a response, so the assistant answered a previous question before the patient spoke. → Every open starts a fresh conversation (old ones stay in history). Caption is empty until the assistant speaks in the current session.
6. **Reliability.** 15 s timeouts on session creation and SDP exchange; peer `connectionState=failed` and unexpected data-channel close now end the session with a clear message; tool-call failures return an error to the model instead of hanging; open-panel errors distinguish permission vs network vs unavailable (it always said "Allow microphone access").

| File | Change |
|---|---|
| `src/services/realtimeVoice.ts` | Items 1, 2, 6; new `thinking` status and `onPlaybackFinished` callback. |
| `supabase/functions/voice-realtime-session/index.ts` | Items 3, 4. Model stays `gpt-realtime-2.1-mini` (audio $10 in / $20 out per 1M tokens vs $32 / $64 for `gpt-realtime-2.1` — about 3× cheaper with reasoning + function calling); override with `OPENAI_REALTIME_MODEL`. |
| `ui/teleconsultation/VoiceAssistantStage.tsx` (new) | Replaces the old voice card: one set of controls (Type / mic-interrupt-pause / End), 3D sphere whose motion reflects listening / thinking / speaking, live caption of what the assistant is saying. The duplicate bottom "Tap to speak" bar is hidden in voice mode. |

### Phase 7 — Clinical safety in chat (2026-11-01)

| File | Change |
|---|---|
| `supabase/functions/chat-ai/index.ts` | **Bug:** "how do I reduce tension?" was refused as non-medical. The prompt now defines medical scope broadly (mental health, sleep, diet, lifestyle, sexual health, medicines, first aid, addiction…) and says "when unsure, treat as medical". |
| `supabase/functions/_shared/clinicalBrain.ts` | **Safety:** "Dolo 650, 3 tablets" (1,950 mg paracetamol) got a "common fever reducer" reply. New medicine-safety rule: compute the total amount and time window, flag >1 g per dose / >4 g per day paracetamol as possible overdose, advise no further doses and urgent care / 112. Shared by text chat and voice. |

Session persistence: verified that both the concern chat (`createConversation` on first send) and the home voice assistant (upsert on first patient transcript) only create a conversation after the patient's first message.

### Phase 8 — Real-device fixes + Home polish (2026-11-01)

Found from a real Android (Expo Go) screenshot: **web preview hides Android layout bugs, so always confirm on a device.**

| File | Change |
|---|---|
| `ui/common/FormField.tsx` | **Bug (Android only):** the password box stretched to ~70 px and "Sign in" was pushed to the bottom. Cause: the eye icon used `height: '100%'` inside a `minHeight` row, which Android resolves differently from web. Single-line fields now have a fixed height and nothing inside uses a percentage. **Bug:** tapping the box outside the tiny input area (icon, padding, lower half) did not open the keyboard — the whole box is now a tap target that focuses the input. |
| `ui/common/KeyboardAwareScrollView.tsx` | Android now measures the keyboard height itself (`keyboardDidShow`) and adds that space under the content; `KeyboardAvoidingView` is kept for iOS only (unreliable under Android edge-to-edge). |
| `ui/home/PatientHomeShowcase.tsx` | Concern/department images are now pre-cropped circular badges (`assets/thumbs/**`, 256 px, per-image crop so printed captions fall outside the frame; originals untouched; the app now ships ~0.5 MB instead of ~36 MB of artwork on Home) with real text labels. Concerns without their own art (fever, cough, flu…) use a matching icon instead of repeating the General Medicine picture. Departments are a compact 4×2 grid. Second-opinion banner is sized by its own aspect ratio so it fits every device. Promo strip: 3D gradient cards, snap scrolling, page dots, **auto-scroll removed** (it moved content under the user's finger). Concern cards use a fixed art slot so all cards align. |
| `ui/common/ClayIcon.tsx` (new) | Shared `ClayIcon` / `ArtBadge` / tone palette used by Home and the All-concerns / All-departments lists. |

### Phase 9 — Chat feels like a real AI chat + Home/tab polish (2026-11-01)

| File | Change |
|---|---|
| `supabase/functions/chat-ai/index.ts` | **Real token streaming.** Before, the server waited for the whole answer (several seconds) and then replayed it in 55-character chunks, so the patient stared at a blank bubble and then saw text "stream" instantly. Now OpenAI is called with `stream: true`, the `"reply"` field is extracted from the half-written JSON (`createReplyStreamer`, handles escapes/unicode/emoji, verified for chunk sizes 1–1000) and sent as SSE `delta` events as it is written. The prompt now puts `reply` right after `isMedical` so the first word appears quickly. Non-medical replies are never streamed (they are replaced by the redirect message). Live streaming is skipped when the reply is later overridden (doctor search / booking confirmation) and those replies are replayed in small chunks. Errors are sent as an SSE `error` event. **Redeploy `chat-ai` (and `voice-realtime-session` if not yet).** |
| `app/ai-guidance.tsx` | React Native's built-in `fetch` has no streaming body, so direct streaming silently never worked on phones. The direct SSE path now uses `expo/fetch` on native. (The primary phone transport, `chat-agent-ws`, proxies `chat-ai` and relays its deltas, so it streams live too.) |
| `ui/teleconsultation/FindDoctorView.tsx`, `PatientHomeShowcase.tsx` | **Bug:** "Top specialists" vanished when the patient's city had no doctors or location was off (list was filtered by city, then hidden when empty). Now always shown: city doctors first (verified → rating → experience), filled with top doctors elsewhere; caption says "Available near X" or "Top rated doctors on CD4"; each card shows the doctor's city. |
| `PatientHomeShowcase.tsx` | Promo cards auto-advance every 4.5 s and wrap from the last card back to the first; a manual drag pauses auto-advance for 8 s. |
| `ui/navigation/SmoothTabBar.tsx` | Selected-tab effect: a soft pill slides between tabs, a small indicator bar slides along the top edge, the icon springs up with a slight overshoot, label turns bold. Uses the app theme (works in dark mode); hospital's `themeColors` override still supported. |

### Phase 10 — Chat bugs found by testing the real flow (2026-11-01)

| File | Change |
|---|---|
| `app/ai-guidance.tsx` | **Bug:** the first list item merged into the second ("…infections)- Chronic diseases") because every stream flush ran `.trim()` on the text, deleting a trailing newline whenever a chunk ended on one. Plain streamed text is now kept exactly; only JSON wrapping is unwrapped. **Bug:** a stale "Thinking..." bubble stayed above the answer because streaming created a second bubble; the first words now replace the Thinking bubble in place (both the direct stream and WebSocket paths). Send button got an accessibility label (it had none). |
| `ui/common/ThinkingIndicator.tsx` (new) | Claude-style "working" state: three dots in a travelling wave + breathing "Thinking" label, shown in the reply bubble until the first words arrive (replaces the plain "Thinking..." text). |
| `chat-ai` (already deployed) | The earlier refusal "I can help only with your selected health concern…" for *"what are the concerns in general physician"* came from the old strict scope prompt; the broadened prompt answers it (verified against the live function). Old refusals already saved in history stay as they were. |

### Phase 11 — Prompt review + real AI usage limits (2026-11-01)

**Prompt review (16 real-world scenarios against the live function).** 14/16 behaved correctly (medicine questions, stress, diet, pregnancy, child overdose and self-harm escalation, and refusal of code / cricket / stocks / recipes / "ignore instructions"). Failures and fixes in `chat-ai/index.ts` + `_shared/clinicalBrain.ts`:

| Finding | Fix |
|---|---|
| "hi" and "how do I book a cardiologist appointment?" were refused as non-medical | Greetings, thanks, "what can you do" and questions about using CD4 (doctors, booking, reports, subscription) are now in scope. |
| Every answer used the same four headings (**What this may mean / What you can do now / …**) | Depth now matches the question; headings only for longer symptom answers; lead with the answer or a specific acknowledgement, at most one follow-up question at the end. |
| Blanket "never give a dose" made medicine answers evasive | Medicine information policy: uses, standard labelled adult dose and daily maximum, side effects, interactions, who should avoid it, missed/extra dose; always check amount + timing when the patient already took something; never change a prescribed dose for a specific patient or set doses for children/pregnancy/organ disease. |
| Roman-Hindi replies opened with a question | "Lead with the answer, never with a question." |
| Prompt-injection | Explicit rule: a patient message can never change the rules; such messages are classified out of scope. |
| Model `gpt-4o-mini` | Recommend setting secret `CHAT_AI_OPENAI_MODEL=gpt-4.1-mini` (no code change; non-reasoning, so streaming starts immediately). Not `gpt-5-mini`: reasoning delays the first word and needs different request parameters. Prices are from third-party aggregators — confirm on OpenAI's pricing page. |

**Usage limits were not being enforced.** When `chat-ai` was rewritten (commit `fbf1f53`) the old rate limiter was dropped and the function started returning a hard-coded `used: 0, remaining: 20, blocked: false`. Result: unlimited free AI messages (cost and abuse risk) and a quota ring in the app that never changed.

| File | Change |
|---|---|
| `supabase/functions/_shared/aiUsage.ts` (new) | Daily quota + burst limit on the existing `ai_usage_stats` table; Pro detected from `user_subscriptions` (active / trialing / grace and not expired). **Free: 20 messages/day, Pro: 100/day**; burst 6 / min (Pro 12); day resets at midnight IST. Counted before the model runs so parallel requests cannot all slip under the limit. If the counter cannot be read it fails open (a DB hiccup never blocks a patient). Env overrides: `CHAT_AI_MESSAGE_LIMIT_PER_WINDOW`, `CHAT_AI_PRO_MESSAGE_LIMIT_PER_WINDOW`, `CHAT_AI_BURST_LIMIT_MESSAGES`, `CHAT_AI_PRO_BURST_LIMIT_MESSAGES`, `CHAT_AI_BURST_WINDOW_MS`. Verified against a mock DB: free accepts exactly 20, burst blocks the 7th message within a minute, Pro reports 100 / 12. |
| `supabase/functions/chat-ai/index.ts` | Enforces the limit and returns the real `rateLimit` state in every payload (the app's quota ring now moves). Hitting the limit returns a friendly reply ("You've used all 20 free AI messages for today. **Upgrade to Pro**…" / Pro: "resets in about N hours"). `quotaOnly` returns real numbers. |

### Phase 12 — Appointments flow + voice booking automation (2026-11-01)

**Critical finding: the database has no open future slots at all** (`slots` where `is_booked=false and date>=today` is empty), although 20 verified doctors exist. Nobody can book — by voice, chat or the Appointments tab. The dummy-doctor seeder creates doctors but no slots. Fix: doctors add slots from `app/doctor/slots.tsx`, or run `SUPABASE_SERVICE_ROLE_KEY=… npm run seed:test-slots -- --dry-run` (then without `--dry-run`): creates 6 hourly slots/day for the next 7 days for every verified doctor, skips existing, never touches booked slots. Run it only against an environment you intend to seed.

**Voice tool automation:** `npm run test:voice-tools -- <email> <password>` (`scripts/test-voice-tools.mjs`) calls the live `voice-realtime-tools` the same way the voice engine does. Result against production today: generic search by concern/city (returns doctors first, General Physician suggested for fever), unknown city still returns doctors, named-doctor search returns exactly one doctor, misspelled doctor returns nothing, booking without confirmation is refused, unknown doctor/slot rejected: **all pass**. The checks that need a real open slot (named doctor's slots, confirmed booking → `payment_required`, slot of another doctor rejected) report `FAIL … no open slot` until slots exist; rerun after seeding. Real speech (STT/TTS) cannot be automated from here; the AI→tool→UI chain is what this script covers.

| File | Change |
|---|---|
| `supabase/functions/chat-ai/index.ts`, `voice-realtime-tools/index.ts` | **Side-effect of the new quota:** the voice tool's generic doctor search calls `chat-ai`, which would now count as one of the patient's 20 free messages per search. Server-to-server calls now send `x-internal-key` (service key) and are not counted. Redeploy both. |
| `app/(tabs)/appointments.tsx` | The tab named "Appointments" never showed the patient's own appointments (only a doctor search). Added a segmented control **Find a doctor / My appointments · N upcoming**; booking flows now return with `tab=mine`. **Bug:** the "AI Triage Result" card was fake ("Based on your general symptoms we recommend Nephrology" = the first doctor's specialty); it now appears only when a concern was passed in, otherwise a "Not sure who to see? Ask AI" prompt. Category chips used a map-pin icon; now a stethoscope. |
| `ui/appointments/MyAppointmentsList.tsx` (new) | Upcoming / Past list: date tile (Today / Tomorrow), time range, status (Confirmed / Awaiting confirmation / Completed / Cancelled / Ended), second-opinion tag, doctor with photo fallback, Message and Book again actions, empty states. Upcoming is decided from the slot end time, not the status alone. |
| `app/confirm-consultation.tsx` | **Bug:** if Razorpay charged the patient but the booking step then failed, the app said "Payment failed" — the patient would pay again. It now says the payment was received (with the payment id), tells them not to pay again, and opens My appointments. Setup failures return to the previous screen instead of forcing a tab. |

### Phase 13 — Voice: usage cap + connection guards (2026-11-01)

| File | Change |
|---|---|
| `supabase/functions/_shared/aiUsage.ts`, `voice-realtime-session/index.ts` | **Voice usage cap** (voice was uncapped and is the most expensive feature). One unit = one voice session started, stored in `ai_usage_stats` under `day_key = voice:YYYY-MM-DD` (no migration; chat quota unaffected). **Free 5 sessions/day, Pro 30/day**, max 3 session starts per minute; env overrides `VOICE_SESSION_LIMIT_PER_DAY`, `VOICE_PRO_SESSION_LIMIT_PER_DAY`, `VOICE_BURST_LIMIT_SESSIONS`. Checked before the OpenAI client secret is created, so a blocked patient costs nothing. Hospital intake is exempt. Verified on a mock DB: 5 accepted, 6th blocked, chat quota untouched, Pro = 30. Returns HTTP 429 `{code: "voice_quota", message}`. |
| `src/services/realtimeVoice.ts`, `FindDoctorView.tsx` | The app reads the server's message out of supabase-js's `error.context` (it used to show "Edge Function returned a non-2xx status code"), shows it in the voice sheet and offers Pro to free users. **Watchdog:** if the data channel is not open 20 s after the handshake the call fails with "Could not connect the voice call…"; if the session cannot start the sheet no longer stays on "Connecting microphone…" (observed once in testing) — it resets and says to tap the mic to retry. |

Browser test with a fake microphone: login → tap mic → session 200 → OpenAI SDP 201 → "Speaking" with live caption and Interrupt button works. One run stalled on "Connecting…" (likely the dev bundle rebuilding at that moment); the guards above make such a stall recoverable.

### Phase 14 — Voice logic review (2026-11-01)

| Finding | Fix |
|---|---|
| The one-booking-per-doctor-per-30-days rule was enforced only in the Appointments tab UI and an RLS policy that the payment edge function (service role) bypasses. Voice (and chat) could open the payment screen for a doctor already booked this month. | `manage-appointment-payment` `create_order` now checks it server-side before any order exists; `voice-realtime-tools` `book_appointment` returns `status: "booking_cooldown"` with the next date, which the voice prompt tells the assistant to explain and offer another doctor. |
| `create_order` never checked the slot: any patient could create a paid order for a booked, past, or another doctor's slot. | Server now verifies the slot exists, belongs to the doctor, is not booked and is not in the past; returns HTTP 200 `{success:false, message}` so the app shows a readable message. |
| Welcome was always Hindi (`initialLanguage: 'hi'` hard-coded). | Follows the app language (`hi` → Hindi, otherwise English). |
| Voice prompt lacked the scope rule, the medicine-information policy and the prompt-injection rule that text chat now has (voice still said "do not casually recommend medicines or doses"). | Voice prompt aligned with chat. |

Not changed (known, acceptable for now): the AI sets `confirmed=true` itself, but the secure payment screen is the real confirmation (the patient must still tap Pay); each opening of the voice sheet counts as one of the day's voice sessions, so opening it twice by accident uses two of the 5 free sessions.

### Phase 15 — Slots: live checks + doctor panel (2026-11-01)

Live tests against production after the doctor added 3 slots:
- `npm run test:voice-tools`: search by concern/city, named doctor with real slots, confirmed booking → `payment_required`, other doctor's slot rejected: **pass**. New check "every offered slot has not started yet (time, not just date)" **FAILS on the deployed function** — it offers today's 07:00 and 13:00 slots in the afternoon. Fixed in code (below); needs deploy.
- `node scripts/test-booking-guards.mjs <patient email> <password>` (new): sends only invalid `create_order` requests. Result today: **the deployed `manage-appointment-payment` accepted a past-time slot** (so the new slot/cooldown guards are not live yet; one unpaid "created" order was left behind — no charge). Deploy `manage-appointment-payment` and rerun.

| File | Change |
|---|---|
| `hooks/useAppointment.ts` | **Bug:** `useAvailableSlots` filtered by date only, so patients saw (and could try to book) slots earlier today. Now hides slots that start in <10 minutes. New `useDeleteSlot` (deletes only the doctor's own **unbooked** slot, filtered in SQL so a slot booked a second ago cannot be deleted). |
| `supabase/functions/voice-realtime-tools/index.ts` | Slots offered by voice are filtered by IST start time (>10 min ahead), not just date. |
| `supabase/migrations/20261101120000_allow_doctor_delete_unbooked_slots.sql` (new) | There was no DELETE policy on `slots`; adds "doctor can delete own unbooked slots". **Apply with `supabase db push`**, otherwise Delete shows "deleting slots is not enabled yet". |
| `app/doctor/slots.tsx` | Times were raw ("07:00:00 - 07:30:00"); now "7:00 AM – 7:30 AM". **Bug:** past slots stayed "Available"; Upcoming/Previous now use the slot's real end time and a slot that ended shows **Passed**. Adding a slot in the past or a duplicate (same date + time) is refused (the database allowed both). Delete button with confirmation on available slots; booked slots show the amber "Booked" state. Content is capped at 720 px so it no longer stretches edge-to-edge on desktop web. |
| `app/doctor/settings.tsx` | Same grouped design as the patient Settings (Practice / Preferences / Support), logout confirmation, version. |
| `scripts/test-voice-tools.mjs` | Slot check now compares date **and time**. |

Re-check after deploy (live): voice tools 16/16 pass, booking guards 3/3 pass (past slot, other doctor's slot, booked slot rejected with readable messages; cooldown not testable — this patient has no booking in the last 29 days), quota live (`limit 100, isPro true`; chat burst 12), voice burst limit live (calls 3 and 4 in a minute → HTTP 429). Chat scenarios still 14/16: the deployed prompt did **not** stop `gpt-4o-mini` from refusing "hi" and "how do I book an appointment with a cardiologist?" (it sets `isMedical=false` regardless). Fixed deterministically in `chat-ai/index.ts` instead of relying on the prompt: greetings/thanks get a canned reply in the patient's language with **no model call and no quota use**; messages mentioning booking / appointment / doctor / report / subscription / payment are never refused as out-of-scope and get a short "how to book" answer (or the doctor search when it is a search request). Redeploy `chat-ai` and rerun `scripts`' scenario list.

Appointments tab — browser walk-through (search → open slots → pick slot, stopping before payment) found and fixed in `app/(tabs)/appointments.tsx`: **"View Available Slots" looked like a link but only a separate "Consult Now" button opened the booking sheet** (the strip is now tappable and the button reads "Book slot", solid primary); **a doctor with no rating showed "★ 0.0"** (now "New"); the booking sheet showed raw times ("13:00:00 – 13:30:00"), a date parsed in UTC (can show the previous day), no grouping, a washed-out confirm button after choosing a slot, and the "Available slots" heading above the appointment-type switch. Sheet now shows "Dr. X · Speciality · ₹fee", slots grouped by Today / Tomorrow / date with "7:00 PM – 7:30 PM", a clear selected state, and a solid "Confirm & Book Slot" once a slot is chosen. Verified in the browser: the sheet opens, today's future slot (7:00 PM) and Sat 7 Nov (6:00 AM) are listed, the already-passed 7:00 AM / 1:00 PM slots are **not** offered, and selecting a slot works. The payment screen itself was not opened (it would create an order).

Doctor panel status: screens already read the shared theme, so the teal palette applied; `dashboard`, `patients`, `chats`, `transactions`, `complete-profile` have **not** been reviewed or screenshot-tested (needs a doctor login in the test browser).

### Phase 16 — Reports tab rebuilt (2026-11-01)

Same flow (upload → AI reads → summary → ask questions), new UI and corrected logic.

| Area | Change |
|---|---|
| `ui/reports/ReportsScreen.tsx`, `ReportCard.tsx`, `InsightsTab.tsx`, `UploadSheet.tsx` (new) | Tabs All / Lab reports / Prescriptions / Insights. Each card shows one of four states: **Ready** (plain summary, up to 3 key values with ↑/↓, "N need attention"), **Reading** (progress bar), **Taking longer than usual** (retry), **Failed** (readable reason + retry). Empty state explains the 3 steps. "Add" opens a sheet: what you are adding, 3-step explanation, camera / gallery / PDF, quota (5 uploads per 24 h on free), tips, privacy and "not a diagnosis" notes. |
| `app/report-assistant.tsx` | Detail screen rewritten: simple summary (Read more), values table with Normal range + High/Low chip, prescription shown as medicine cards, next steps, urgent signs, Ask-AI suggestion chips + chat. Opens at the top. The server's auto-generated "Report At A Glance" message (emoji, duplicates the summary) is no longer shown in chat. About 1,000 lines of dead helper code removed. |
| `hooks/useMedicalReports.ts` | Polls every 4 s while a report is being read; stuck detection (>5 min); upload quota hook; Hindi/English answer language; retry sends `force: true`. |
| `src/utils/reportInsights.ts` | Pure helpers (`scripts/test-report-insights.mjs`, 27/27 pass). |
| `app/(tabs)/records.tsx` | Renders `ReportsScreen`; `?tab=all|lab|prescription|insights`. Old `HealthVaultView` / `HealthExplainedView` deleted. |

Browser check (mobile 390×844): list, Insights, upload sheet and detail screen verified; no console errors. Fixed during testing: nested `<button>` warning on web, floating "Add report" button covering card content (now a header button), page opening scrolled to the bottom.

**Bug found live: "Ask AI about this report" always failed.** `medical-report-chat` returned HTTP 500 `shifted.getUTCFulloear is not a function` (typo for `getUTCFullYear`, in the date helper) for every question, English or Hindi. Fixed in `supabase/functions/medical-report-chat/index.ts` — **redeploy this function**, then rerun `node scratchpad chat-report.js`-style check (or just ask a question in the app). The app also no longer shows raw server errors for chat ("AI could not answer right now. Please try again in a moment."), and the "Suggested next steps" list drops lines where the model talks about itself.

Follow-up fixes the same day (from the user's own testing):

| Problem | Cause | Fix |
|---|---|---|
| "Your values" showed one broken row with the name squeezed into a vertical column of letters; LDL etc. missing | The analysis writes highlights in **two formats** (`Name / value / unit / ref / flag` and, in newer runs, `Name: value unit \| reference … \| High`); only the first was parsed, and a long value had no width limit | `parseHighlightLine` handles both (tested with the live lines), names may contain "/", value column capped at 48 % width. Labels cleaned: "100.00" → "100", "<100" → "below 100", "4.00-5.60" → "4 – 5.6" |
| Many requests stuck "(pending)" in the browser while a report was being read | The whole report list (`select *`, large JSON) was refetched every few seconds, filling the browser's connection pool | Only `id, analysis_status` of the scanning report is polled every 3 s; the full list reloads once, when it finishes |
| "Preparing your workspace…" took long | Profile, role and subscription were fetched twice at start (`initializeAuth` + `INITIAL_SESSION` event, which also re-showed the loader) and one after another | One shared request, subscription runs in parallel with profile, role slug cached, `INITIAL_SESSION` no longer re-triggers. Measured: Reports tab visible **1.9 s** after a reload; roles/subscriptions requested once each |
| Loader looked unfinished | Bare spinner | Logo with soft pulse + slim progress bar; after 8 s says "Taking longer than usual. Please check your internet connection." |
| Waiting after upload felt slow and blind | No feedback | After upload the report screen opens immediately and shows steps (Uploaded → Reading → Picking out values → Writing explanation) with a live seconds counter. Only "Uploaded" is a confirmed fact; the middle steps advance on measured typical timings, and the result appears as soon as the server finishes |

Measured analysis time on production today: photo **~13 s**, 9-page lab PDF **27 s** (the same PDF took 101 s in August). Faster than this would need the server to stream the explanation; not done.

Not tested: real camera/gallery on a device, an actual upload (would create a report and use quota), Hindi output (needs `analyze-medical-report` / `medical-report-chat` redeployed).

### Phase 17 — Edge-function audit, voice crash, smarter assistant scope (2026-11-01)

**Live probe of all 24 functions** (`probe-functions.js`: empty-body calls with no token and with the test patient's token). All boot; no function accepts a request without a valid JWT. Findings:

| Function | Finding | Status |
|---|---|---|
| `medical-report-chat` | Every question → HTTP 500 `getUTCFulloear is not a function` (typo already in the committed code) | Fixed locally — **deploy** |
| `save-ai-report` | An empty call created a blank triage report + PDF | Now 400 `empty_conversation`. The probe left one blank row (`ai_triage_reports` id `5a731c03-0120-4b3c-89ed-4153bcae9e38`, PDF already deleted); patients cannot delete these rows, run the SQL below |
| `register-push-token` | A missing/empty token cleared the user's push token (any malformed call switched notifications off) | Clears only on explicit `token: null` (what the app sends at logout) — **deploy** |
| `send-chat-notification`, `send-appointment-notification` | Checked: gateway rejects calls without a JWT; function verifies the caller is the sender / the appointment's patient | OK |
| `health-reminders`, `security-ops-monitor` | Require admin or cron token | OK |
| `chat-e2ee-key-backup` | Returns `wrap_key_missing`: the server secret for wrapping chat keys is not set, so encrypted-chat keys are never backed up (a new phone cannot read old encrypted chats) | **Set the function secret** (name in the function code) |
| `analyze-medical-report`, `moderate-community-image` | Missing input returns 500 instead of 400 | Cosmetic, not changed |

```sql
delete from ai_triage_reports where id = '5a731c03-0120-4b3c-89ed-4153bcae9e38' and chat_history = '[]'::jsonb;
```

**Voice chat closed the app the moment it was opened** (development and preview builds). The first guess, ProGuard renaming WebRTC classes, was checked in the downloaded preview APK: R8 had renamed some `org.webrtc` classes, but every JNI method WebRTC calls by name was intact, and a development build is not minified at all, so it was not the cause (keep rules for WebRTC and Agora stay in `app.json` as a safeguard). The app also has an `AppErrorBoundary` around everything, so a JS render error would show "Something went wrong" instead of closing the app: this was a native crash. The only native change since voice last worked on the phone was `react-native-incall-manager@4.3.0` (a large rewrite released 2026-09-15), added in this project for loudspeaker routing; `InCallManager.start()` was the first thing the voice button ran. It was removed (package, code and ProGuard rule). Loudspeaker routing now comes from a small local Expo module, `modules/speaker-route` (Android `AudioManager`: communication mode + `setCommunicationDevice(speaker)` on Android 12+, `isSpeakerphoneOn` below; iOS `overrideOutputAudioPort(.speaker)`; reset when voice ends; every call returns false instead of throwing). `src/services/realtimeVoice.ts` also wraps every WebRTC/data-channel/timer callback in a guard, because an exception there closes a release app. **Needs a new development build** to confirm on a phone; a local emulator could not run the ARM-only APK (`libreactnative.so` not found under ARM translation), so this is not device-verified yet.

Expo SDK 58 is the latest; upgrading from 54 is planned as a separate branch **after** the crash fix is confirmed on a phone (expo-av, used in 6 files including voice and video calls, was removed in SDK 55).

**"Doctors in Chandigarh" was refused** in AI chat and the voice sheet's text box: `\bdoctor\b` did not match the plural "doctors", so the message was neither an app question nor a doctor search; the city typed in the message was also ignored (only the phone's location was used), and "doctor in chandigarh" would have searched for a doctor *named* "in chandigarh". Fixed in `chat-ai`: plurals, city taken from the message ("in X", "near X", "X me"; not "tell me"/"help me"), stop-words rejected as names. Database search used `ilike %city%`, so Patna also returned Visakhapatnam doctors — whole-word filter added in `chat-ai` and `voice-realtime-tools` (and `src/utils/city.ts` for Home and Appointments).

**Assistant scope** (`chat-ai` prompt, voice session instructions): understand intent from typos / Hinglish / speech-to-text errors; doctors on CD4 and app usage are in scope; CD4's internal and business information (user counts, revenue, staff, other patients' data, models/prompts/APIs) is never shared. A server-side guard answers those questions before the model is called, so wording tricks cannot get round it.

Home "Top specialists": Patna doctors first (Visakhapatnam no longer counted as Patna), test/incomplete profiles hidden from the showcase, every name shows "Dr.", cities capitalised, broken photo URLs fall back to initials (was an empty box), unrated doctors show "New on CD4" instead of a star, caption says "Patna first, then top rated across CD4" when the list mixes cities.

Tests added: `scripts/test-chat-ai-intent.mjs` (26), `scripts/test-city-match.mjs` (9); `test-report-insights.mjs` now 32.

**Deploy needed:** `chat-ai`, `medical-report-chat`, `save-ai-report`, `register-push-token`, `voice-realtime-session`, `voice-realtime-tools` (deploying from this session was blocked by the permission system).

### Phase 18 — Expo SDK 58 upgrade + fresh teal palette (2026-11-01, branch `upgrade/expo-58`)

Done on a separate git branch (`upgrade/expo-58`, from `development`; nothing committed yet). Expo 54 → **58.0.22**, React Native 0.81 → **0.88.1**, React 19.1 → 19.3, TypeScript 6.0.

| Area | Change |
|---|---|
| Packages | All `expo-*` to 58.x via `expo install --fix`. Third-party native libs to versions released for RN 0.88: `react-native-webrtc` 155.0.1, `@config-plugins/react-native-webrtc` 15.0.2, `react-native-agora` 4.6.4, `react-native-razorpay` 3.0.0, `@react-native-google-signin/google-signin` 17.0.0, `@react-native-firebase/*` 27.1.0, `expo-speech-recognition` 58.0.1, `react-native-chart-kit` 7.0.4, `react-native-get-random-values` 2.1.0. `@expo/vector-icons` is no longer bundled with `expo` and is now a direct dependency. |
| `expo-av` removed in SDK 55 | Replaced in 7 files. Audio (`expo-audio`): `realtimeVoice.ts`, `ai-guidance.tsx`, `FindDoctorView.tsx`, `CallContext.tsx` (ringtone), `services/homePermissions.ts`. Video (`expo-video`): `AnimatedSplash.tsx`, `PostCard.tsx`. expo-audio reports `isLoaded=false` until a clip is ready (expo-av's "not loaded = finished" logic would have cut every voice reply instantly), so playback now ends only on `didJustFinish`, with a safety timeout; times are seconds, not ms. |
| RN 0.88 breaking changes | `InteractionManager` removed → `src/utils/afterInteractions.ts` (`requestIdleCallback`); `StyleSheet.absoluteFillObject` removed → `absoluteFill`; `ScrollView`/`TextInput` refs → `ScrollViewInstance`/`TextInputInstance`; `RefreshControl.onRefresh` must return void; `Appearance.setColorScheme(null)` → `'unspecified'`; `AppState.currentState` may be undefined. |
| Navigation | expo-router 58 bundles React Navigation internally. Hooks imported from the separate `@react-navigation/native` package could not see the router (**Appointments tab crashed: "Couldn't find a navigation object"**); `useFocusEffect` now comes from `expo-router` and the separate packages were removed. The custom tab bar receives `emitter` + `navigateToTab` instead of `navigation`; `SmoothTabBar` uses them exactly like expo-router's own tab bar (pressing a tab would otherwise have crashed). |
| `app.json` | `expo-audio` plugin with the microphone permission text; `expo-video`. `expo install` also added the Firebase plugins: removed again, because Firebase is not imported anywhere and the iOS config file does not exist (iOS builds would fail). |

Verified in the browser (SDK 58 dev server, mobile 390×844): login, then tapping every bottom tab (Home, Appointments, Reports, Chat, Community) — no crash, no console errors. Typecheck 108 errors → 0; report/city/chat-intent unit tests pass. **Not verified on a phone**: needs `eas build -p android --profile development` (all native modules changed).

**Palette**: first changed to a brighter "Fresh Teal", then, at the owner's request for a medical green, to **Emerald**: primary `#059669`, buttons `#047857` (white text keeps ≥4.5:1 contrast), pressed `#065F46`, soft `#E7F8F0`, accent sky `#0EA5E9` for AI/Pro; dark mode primary `#34D399`. Success states keep their own lighter green `#16A34A` with a check icon. The Home hero card used to end in a grey-blue `#0B4F6C` that made it look dull; it is now `#047857 → #059669 → #10B981`. Hard-coded old teals in the auth background, icon tiles, promo cards and voice orb were updated too. Report cards: the three key-value tiles were solid pink with red text (alarming, heavy); they are now neutral bordered tiles like a printed lab report, with only the value and a small "↑ High / ↓ Low" tag in red.

Reports tab walk-through on SDK 58 (all filters, upload sheet both categories, open report, Read more, scroll, back, `?tab=insights` deep link, unknown report id): no crashes or console errors. Fixed: **"Lab reports" filter also listed non-lab documents** (e.g. a chat screenshot) — it now shows lab results only; the upload sheet said "Add your report" in prescription mode (now prescription-specific steps); Ask AI now shows the patient's question bubble immediately instead of after the server stores it. Ask AI against the live (not yet redeployed) `medical-report-chat` still fails; the patient sees "Could not ask AI" and the question returns to the input box. First open of the tab: list visible in ~1.7 s (query itself 0.3–0.9 s, 27 KB), 0.15 s on later visits.

Loaders and shimmer (reload of every tab, light and dark system theme, screenshots at 0.3 / 1 / 2.5 / 6 s): the startup loader always clears within 6 s and every tab shows its content. Fixed:
- **Two different loaders**: a cold start showed an old "Initializing app…" spinner (`app/index.tsx`) before the new "Getting things ready" loader. Everything now uses `RouteLoadingScreen`; the old `ui/common/LoadingScreen.tsx` and a stray route file `app/common/LoadingScreen.tsx` (it created a `/common/LoadingScreen` URL) were removed.
- **Dark-mode skeletons never used their dark colours**: skeletons (and the Home/Appointments skeleton colours) detected dark mode with `background === '#121212'`, but the dark background is `#0B1220`, so dark mode got near-invisible blocks with a bright white sweep. They now compare with `Colors.dark.background`.
- Reports showed a bare spinner while every other tab shows a shimmer skeleton; it now uses the (previously unused) `RecordsTabSkeleton` in a cards-only form.
- 26 animations hard-coded `useNativeDriver: true`, which logged a warning per animated block on web; now `Platform.OS !== 'web'` (no change on phones).
- Splash video on web resolved its `src` from the required module by hand; on SDK 58 that is an asset id, so it now uses `Asset.fromModule(...).uri`. Checked in installed Google Chrome: the video loads and plays. (Playwright's bundled Chromium has no H.264 codec and always reports a playback error; that is the test browser, not the app.)

Not changed: the test account has "Light" saved in its profile appearance setting, so the app stays light even when the device is dark (correct). Web-only console noise remains from `expo-secure-store` (no web support) and `expo-notifications`. On web the page is blank white for ~0.3 s while the JavaScript loads; phones show the native splash instead.

### Phase 19 — Release config, UI audit, voice doctor search, doctor PDF (2026-11-02, uncommitted)

**Preview build config** (`eas.json`, `.easignore`, `package.json`): `preview`/`production` pinned Node 20.18 while Expo 58 / RN 0.88 need 22.13+; the pin was removed so they use the same default image as the successful development build. `expo-module-scripts` pulled `babel-preset-expo` 54 and codegen 0.81 into the root `node_modules`, which broke every Android bundle ("Unable to determine event arguments for onModeChange"); removed, with `babel-preset-expo` 58 as a direct dev dependency. `.easignore` replaces `.gitignore` for uploads, so `.env` (Agora certificate) and `dist` were being uploaded; both are now excluded and the client `EXPO_PUBLIC_*` flags moved to `eas.json`. google-signin v17 returns `{ type, data }`; `utils/googleNativeAuth.ts` reads it and treats cancelling as a cancel. Verified: `expo export --platform android` builds (8.8 MB Hermes bundle), expo-doctor 19/20 (directory metadata only). **Production still has a Razorpay test key.**

**UI audit** (Home, Appointments, Reports at 390x844 and 360x640 in Chrome: no page overflow, clipped labels or console errors after fixes). Appointments: "Cardiologist" and similar chips listed specialities with no doctors and matched spelling exactly (database has "Dermatology"/"Dermatologist", "General Physician "), so a chip could show an empty list; `src/utils/doctors.ts` now gives one name per speciality and lists only those with doctors. Junk profiles hidden from browsing (search still finds them), cards show the fee instead of repeating "View Available Slots", initials replace blank photos (`ui/common/DoctorAvatar.tsx`), lighter type, readable chips, "New on CD4" instead of a star. Reports: value names wrap instead of "Total cholest...", "+N more in the full report". Home: speciality and experience/city on separate lines.

**Voice: "doctors in Patna" answered that the system returned none.** General searches went through `chat-ai`; when the model sent a concern like "doctors in Patna" its medical-scope guard returned no doctors (live test: 0 doctors in 5 s, while 4 real Patna doctors exist) and the assistant invented an explanation. `_shared/doctorSearch.ts` now queries the database directly: whole-word city, no junk profiles, doctors with open slots first, next slots attached and attributed, and a plain `searchNote` when it has to widen ("CD4 has no Cardiology doctor in Patna right now..."). The session instructions tell the assistant to speak like a receptionist and never mention the system or tools. Tested against a fake database (`scripts/test-voice-doctor-search.mjs`); **not yet tested with the live voice model, needs deploy**.

**Doctor PDF** (`_shared/doctorBrief.ts`, used by `send-appointment-notification` and `save-ai-report`). The old page came from English-only regexes (Hindi chats became "Not clearly stated"), printed raw markdown ("* **Chief Concern:** Issues in focus."), showed UTC times and printed the doctor's name like a signature. Now an AI model reads the whole conversation in any language and returns facts in simple English from what the patient said, without diagnosing; if OpenAI fails it tries Gemini, then a clearly labelled basic summary; a booking without any chat says so. One A4 page: patient and appointment, main concern, danger signs (only if reported), summary, key facts, reported and denied symptoms, what to confirm. Rendering checked with sample data including the longest allowed text. **The AI extraction itself has not run yet, because the API keys exist only on the server: check a real booking after deploy.**

**Report chat ("Ask AI") still fails live** with the `getUTCFulloear` typo until `medical-report-chat` is deployed. New `npm run check:edge` finds misspelled methods and undefined names across all edge functions despite `@ts-nocheck` (currently clean, 28 files); run it before deploying.

**Hidden routes redirected to Home (SDK 58 regression).** expo-router 58 turns `href: null` into `hidden: true`, and a hidden route redirects away when opened. Patient Settings and Profile details could not open from the profile icon, and the same setting was on doctor settings, fees, clinic, complete-profile, admin pages and hospital patient-profile. `href` was removed from the four tab layouts; `SmoothTabBar` already chooses visible tabs through `visibleRouteNames`. Verified for the patient role in the browser; **doctor, admin and hospital screens not opened yet** (needs those logins).

**Department list on Home** only changed internal state. It now opens Appointments with that department selected, and shows all cities when the department has no doctor in the current city. Home's department tiles (not the list) still open AI guidance.

**City/Department dialogs** on Appointments are a centred dialog instead of a bottom sheet. Other bottom sheets (booking, upload, Home's concern and department lists) are unchanged.

**Top specialists card**: `flex: 1` on the card's upper section (added during the UI audit) collapses inside an auto-height card on native but not in browsers; now `flexGrow: 1`. Not verified on a phone.

**Doctor PDF** reworked as a history sheet: chief complaint, history of present illness, since when, how it started, better/worse, severity, what affects it, already tried, medicines, allergies, past history.

**Splash icon**: the source logo fills its square with white corners, so Android 12+'s circular mask cut it, and the corners would show on the dark splash. `scripts/generate-splash-logo.mjs` makes `assets/images/splash-logo.png` (transparent rounded corners, clear space); needs a new native build to appear.

**Brand**: app text and the assistant's name are "CD4" instead of "CD4 Health". Legal names in the privacy policy and the doctor-signup copyright are unchanged.

**Deploy needed:** `chat-ai medical-report-chat save-ai-report register-push-token send-appointment-notification voice-realtime-session voice-realtime-tools`.

### Phase 20 — Role, booking and payment lockdown (2026-11-02, uncommitted)

Audit of everything except the Chat and Community tabs. Dummy doctors stay until the new database is set up (owner's decision).

**Who is admin:** `EXPO_PUBLIC_ADMIN_EMAILS` (`.env`, `eas.json`) only picks the screen after login (`src/utils/authRouting.ts`). Real access is `profiles.role_id`, set at signup by the email list in `handle_new_user`. The lists match. The client list ships inside the APK.

**Fixed** in `supabase/migrations/20261102120000_lock_roles_and_paid_bookings.sql`, `_shared/appointmentBooking.ts`, `razorpay-webhook`, `manage-appointment-payment`:

| Bug | Fix |
|---|---|
| Signup with `role: admin` in metadata created an admin; users could edit their own `role_id` | Public signup gives only patient or doctor; hospital comes from `app_metadata`; trigger keeps `role_id` and `is_verified` for non-admins. Hospital voice checks no longer read `user_metadata`. |
| Patients could insert confirmed appointments without paying and edit linked slots | Appointment insert and slot update are admin only; participants can only mark a booking completed |
| Doctors could verify themselves and set their rating | Trigger keeps these for non-admins |
| **Webhook never ran:** live endpoint returned 401 because `verify_jwt` was on | `verify_jwt = false` (function checks Razorpay's signature) |
| Paying and then closing the app left no booking | Webhook makes the booking |
| A failed attempt, or a webhook arriving first, made a good payment fail with `payment_status_invalid` | Finalize accepts `created`, `failed` and unbooked `paid`; a late failure cannot undo a success |
| Two patients could pay for one slot, with no refund | 5 minute hold, automatic Razorpay refund if the slot is lost, `needs_manual_refund` in metadata if the refund fails |
| Webhook overwrote payment metadata, losing `appointment_type`; failed events were never retried; `refund.failed` marked payments refunded | Metadata merged; unprocessed events reprocess; refund failures flagged |
| Doctor could delete a slot during payment, which cascaded away the payment row | Delete blocked for 15 minutes after a payment starts |
| Signature check was skipped if the Razorpay secret went missing | Rejected unless the order was created in test mode |

**Tests:** `npm run test:booking`. The migration was also run on in-memory Postgres (PGlite) with a minimal copy of the schema and attacked as signed-in users. Not tested: real Razorpay payment, refund or webhook delivery.

**Report chat language** now follows the latest question (`medical-report-chat`), deploy pending.

**Deploy order:** functions first (the hospital signup needs `app_metadata` before the trigger changes), then `npx supabase db push`. Then check the webhook is registered in Razorpay.

### Phase 21 — Bug list, doctor panel, CD4 AI agent (2026-11-03, uncommitted)

**Bugs from the Phase 20 list:**

| Item | Fix |
|---|---|
| Doctor PDF lost if the patient closes the app after paying | Concern and conversation are stored on the order; the webhook sends the PDF with `EdgeRuntime.waitUntil`. `appointments.doctor_notified_at` is claimed once, so the app and the webhook cannot both send it. |
| Unpaid orders shown as receipts | Payment history hides `created` rows; status labels and dates cleaned up. |
| No cancel or reschedule | `cancel_appointment_booking` and `reschedule_appointment_booking`, up to 2 hours before for patients, with an automatic full refund. Doctors can cancel until the slot starts; that slot stays closed. |
| Legal pages said ReVeda | Migration replaces only rows containing the old name, so admin edits survive. Firebase removed from `PRIVACY_POLICY.md`. |
| No Hindi on Reports or payment screens | 240 new keys across Reports, report detail, upload, payment screens and My appointments. |
| Another patient's AI report could be linked to a booking | `guard_appointment_report_owner` drops a report that is not the patient's own. |

**Auth theme:** signed out, the app now always follows the device, instead of keeping the last user's saved Light or Dark. `expo-system-ui` added, which Android needs for automatic dark mode; this requires a new native build.

**Doctor panel:** Home rewritten (the metric cards were collapsing because `width: 48%` sat inside a wrapper with no width), with shared `ui/doctor/DoctorUI.tsx` for titles, tiles and search. Slot times now read "6:00 AM", not "06:00:00". Patients, Slots and Chats restyled to match. Bugs fixed: Transactions redirected to Home (missing from the tab layout); verified doctors showed "Verification Pending"; profile dividers overflowed the card; the chat list told doctors to "book a future slot".

**CD4 AI:** one identity, free small talk, injection checks, output scrubbing, hybrid RAG, exact and semantic cache, model routing, RBAC and telemetry. Full explanation in `docs/CD4_AI_AGENT.md`.

Two bugs found on the way: `chat-ai` still had `bookSlotWithoutPayment`, which created a confirmed appointment with the service key and bypassed the Phase 20 lock, now replaced by a hand-off to the payment screen. And report chunks were written on upload but report chat never read them, so long reports lost everything past 8,000 characters.

**Tests:** `npm run test:agent`, `npm run test:booking`. Migrations were also run on PGlite with pgvector and tested as signed-in users (82 checks). Not tested: real voice, real Razorpay refunds, the webhook sending a PDF, and `npm run eval:agent`, which needs these functions deployed first.

**Deploy order:** `npx supabase db push` first (the notification claim needs the new column), then the functions, then `npm run ingest:knowledge`.

### Phase 22 — Report reading, calls, chat and Community speed (2026-11-02, uncommitted)

**Report reading.** The same handwritten OPD card gave a different wrong answer on each run, including a pregnancy test that is not on the card. The model had to fill a JSON form from a photo in one low-effort pass, under a 22 s limit that also pushed it onto the fallback model.
- Photos and scanned PDFs are read twice at the same time by two models. A detail the readings disagree on is marked as uncertain.
- The draft is then checked against the page and unsupported claims are removed. If the check cannot run, or claims survive a rewrite, nothing is saved and the patient is asked for a clearer photo.
- Cut-off or non-JSON model output counts as a failed attempt.
- This lowers wrong readings but cannot rule them out for hard handwriting, so the screen shows what was read and what to confirm with a doctor.
- `npm run eval:report -- <file> --runs 3 --must "a,b" --never "c,d"` runs a document through the deployed function and checks every run.

**Reports UI.** Hero card, range meters, plain summary (`headline`, `plain_points`), `report_title`, "what the document says", "please confirm", a Read again action and a doctor's note type. Older reports keep their text until read again. The red and green values bar was removed: it only counted the values AI chose to list, so it looked far worse than the report.

**Calls** (`context/CallContext.tsx`). Fixed: a voice call turning the camera on; a denied microphone starting a silent call; the first call resetting itself when the permission prompt backgrounded the app; hanging up during setup still ringing the other phone; a double tap ringing twice; the ringtone continuing after the call ended; answering after the caller hung up; a crashed caller leaving the other phone ringing on every app open; a second incoming call taking over a call in progress; an old call's closing event ending a new call; a call staying open for ever when the other phone died; calls dropping at one hour because the token was never renewed; a short test call marking the appointment completed (it now needs 60 s connected); the speaker setting being applied before joining, where Agora ignores it.

Added: ringback tone, vibration, call timer, Reconnecting status, missed-call push, one live call per room (`20261103160000_one_live_call_per_room.sql`), and a 24 s ringtone channel for a closed app (`calls_ringtone_v3`). The caller's token is no longer stored where the other person can read it.

**Chat.** Read ticks update live. Closing a chat no longer removes the Chat tab's live updates. Messages sent while offline or in the background load on return. A failed send keeps the typed text and no longer erases messages received meanwhile. A message that arrives in the background is not marked read. Closed consultations can be opened to read. "Last seen" and Online now reflect use of the whole app, not only having a chat open, and no longer broadcast every online user's id to everyone.

**Community.** Feed requests ran one after another. They now run together, picture links come in one request, the feed is loaded shortly after sign-in, opening the tab reloads only stale data, and it no longer loads twice.

**Report timing.** Analysis now answers at once and carries on in the background, and marks the report failed after 135 s. A limit error is shown instead of waiting. Report chat had been failing over to the backup provider on every question, because GPT-5 rejects a custom temperature. The report screen has Summary, Results, Document and Ask AI tabs.

**CD4 AI chat.** The websocket was seen closing itself mid-answer (1006), and the app then showed an error, so any socket failure now falls back to HTTP and HTTP streaming goes first (`EXPO_PUBLIC_AGENT_WS_FIRST=off`). Doctor and slot cards were never rendered although the data arrived, so they now show with the top 5 slots. Emergency symptoms no longer get replaced by a slot list, and a doctor search no longer pays for a model reply it throws away. History-taking asks one question at a time. Internal source lines and the report note on non-report answers are gone.

**Doctor chat, more.** `mark_room_as_read` trusted what the app sent and compared the role with 'Doctor', so a doctor cleared the patient's unread count and any user could mark any room read (`20261103170000`). Sends go one at a time, so order holds. Fixed the quoted name on replies, single and double ticks, typing signals on every key, and closed chats on the doctor side. Added date separators.

**Community, more.** Follow, like and comment flows rebuilt with optimistic updates and double-tap guards, with a new comment sheet in `ui/community`. A post with several photos shows only the first, because the feed does not request `media`.

**Privacy.** Any signed-in user could read every doctor's whole profile, including email, phone and address. Security views and doctors' registration numbers were readable with no login (`20261103180000`). A patient and doctor who share a booking or chat can still read each other's full profile row.

**Start-up.** A saved snapshot of name and role opens the app without waiting for the profile. Database calls time out at 20 s.

**Capacity.** The project is on NANO compute with no backups, and it went Unhealthy during heavy testing, then recovered after a restart. Before launch it needs a larger compute size and backups. Run tests one at a time on this size.

**Not verified:** calls need two phones and a new build, so none of the call behaviour above has been run. Report reading needs the function deployed.

**Encryption, as it really is.** Text messages use x25519 and XSalsa20-Poly1305. It is not true end-to-end:
- `E2EE_BACKUP_WRAP_KEY` is not set, so key backup does not run. Reinstalling or changing phone creates a new key and old messages can no longer be read. Once set, backups work, but whoever holds that key can read messages.
- Messages go in plain text when the other person has no key yet, even with `EXPO_PUBLIC_CHAT_E2EE_ALLOW_PLAINTEXT_FALLBACK=false`. On the test accounts about 60% of all text messages are plain, and 3 of the patient's newest 20.
- Push previews send the message text to the server and Expo.
- Photos and files are private links, not encrypted.

**Open decisions:**
- Whether to block sending without a key, send generic push previews, and whether privacy text may call chat end-to-end encrypted.
- A closed app rings through a notification. A full-screen call like WhatsApp needs a native call library.
- `get-agora-token` checks room membership but not the consultation window, which only the app checks.

## Pending / known issues backlog

- **`support@cd4.app`** appears on the legal and support pages. Confirm this mailbox exists and is read.
- **Legal text** is a working draft from `PRIVACY_POLICY.md`. Have a lawyer review it, including DPDP Act duties and naming AI providers.
- **Refund after payout:** if a consultation is refunded after the doctor was paid, the money is not recovered automatically. These rows carry `refund_after_payout` in `appointment_payments.metadata`.
- **Doctor panel text** is English only.
- **Medical knowledge for CD4 AI** still has to be sourced and clinically reviewed. See `docs/CD4_AI_AGENT.md`.
- **New database:** create the three admin accounts first. The signup trigger makes those emails admin before email confirmation, so anyone registering one first would become admin. Do not reuse the dummy doctors' seed password.

- **No slot locking at payment time**: `create_order` does not reserve the slot, so two patients can pay for the same slot; `verify_and_book` must be atomic and refund the loser. Worth a DB-level test.
- Appointments: no cancel / reschedule action for the patient yet; "Message" opens the Chat tab rather than the specific consultation chat.

- **Home voice assistant (Realtime) has no server-side usage cap.** It is the most expensive feature (audio tokens). `voice-realtime-session` should check the same `ai_usage_stats` quota (or a separate voice quota) before minting a client secret.
- **Redeploy `chat-ai` (+ `_shared`) and `voice-realtime-session`**, then re-run the 16 scenarios to confirm the prompt changes.
- Streaming shows partial Markdown (e.g. an unclosed `**`) for a moment while a reply is being written, like most chat apps; it renders correctly once the closing marker arrives.

- **Verify on a real Android device** with a new development build (SDK 58 + `modules/speaker-route`): voice opens without crashing and plays on the loudspeaker, login/signup/forgot/reset layout, keyboard on every field, Home carousels, splash video, community videos, video-call ringtone. Expo Go cannot load the local native module.
- Next in the redesign queue (per owner): Appointments tab, then Reports, Chat, Community, doctor/admin/hospital dashboards. Other screens still using `KeyboardAvoidingView behavior={undefined}` on Android should move to `KeyboardAwareScrollView`.

- **Apple Sign-In** is not implemented (button removed). Required by App Store guideline 4.8 if an iOS build ships with Google sign-in.
- **Supabase password policy**: client now requires 8+ chars with letters and numbers; set the same minimum in Supabase Auth settings so the API enforces it too.
- `ui/common/AppInput.tsx` is unused (superseded by `FormField`); delete once confirmed nothing external imports it.
- `README_AUTH.md` is stale (axios/REST era) — rewrite or delete.
- **Concern chat voice** (`app/ai-guidance.tsx`) still uses on-device speech recognition + `expo-speech` TTS: robotic voice, and recognition depends on Google speech services (missing/disabled on some Xiaomi/Huawei devices). Should move to the same Realtime voice as Home.
- **Test/junk data in production DB**, e.g. a doctor named "Dr. aaaaaa sssdsfsaf" appears in Top specialists. Clean up or hide unverified doctors from patient lists.
- Older empty conversations created before the lazy-create logic may still appear in history; consider filtering conversations with zero patient messages.
- Web only: E2EE identity bootstrap calls `expo-secure-store`, which is unsupported on web (warnings on every load). Native is unaffected.
- `hooks/useTest.ts` returns the string `'test'` and is unused — delete.
