# Voice Assistant + Autonomous Tool Gating Implementation

## Goal
- Remove voice popup dialog on patient home screen.
- Enable continuous voice assistant loop (listen -> AI -> voice reply -> listen again).
- Keep AI medical-focused and run doctor-search tools only when user explicitly asks.
- Improve UI quality of the mic/voice section.

## What Was Implemented

### 1) Home voice UI switched from modal to inline continuous panel
- Updated [ui/teleconsultation/FindDoctorView.tsx](ui/teleconsultation/FindDoctorView.tsx)
- Removed voice prompt modal flow.
- Added inline "Continuous Voice Assistant" card with:
  - live status text (listening, processing, AI speaking, stopped)
  - animated mic orb
  - live transcript block
  - start/stop control
- Agent conversation UI is now inline on home screen (no voice popup dialog).
- Voice panel visuals now follow app theme tokens (`theme.cardBackground`, `theme.borderColor`, `theme.text`, etc.) for both light and dark mode.

### 2) Continuous voice session loop
- Updated [ui/teleconsultation/FindDoctorView.tsx](ui/teleconsultation/FindDoctorView.tsx)
- Added session logic:
  - tap mic to start session
  - speech recognition captures final transcript
  - sends transcript to `voice-chat`
  - plays AI audio reply
  - auto-restarts listening for next turn
- Added duplicate transcript guard for rapid repeated final events.
- Added cleanup for speech + audio resources on unmount.
- Voice panel is now voice-only (no text typing input in the home voice panel).

### 3) Voice response kept minimal for voice-only flow
- Updated [supabase/functions/voice-chat/index.ts](supabase/functions/voice-chat/index.ts)
- `voice-chat` response is now kept lean for voice usage:
  - `text`
  - `audio`
  - `chatModel`, `ttsModel`, `sttModel`
- Added voice-scope guard:
  - AI classifier now decides whether transcript is medical/non-medical
  - keyword matching is kept only as fallback when classifier fails
  - if transcript is non-medical, assistant does not call `chat-ai`
  - returns a polite medical-only redirect in user language style (English/Hindi hint)

### 4) Strict doctor-search tool gating (user-intent only)
- Updated [supabase/functions/chat-ai/index.ts](supabase/functions/chat-ai/index.ts)
- Added explicit `DOCTOR_SEARCH_INTENT_TERMS`.
- Introduced `hasDoctorSearchIntent(...)`.
- Changed doctor search tool execution to run only when explicit search intent exists:
  - autonomous loop search step
  - pre-AI prefetch path
  - post-AI late fetch path
- Added system directive to avoid fetching doctor lists unless explicitly requested.

## UI Template Delivered
- Added [VOICE_ASSISTANT_UI_TEMPLATE.html](VOICE_ASSISTANT_UI_TEMPLATE.html)
- Standalone HTML/CSS reference template for the upgraded voice assistant look.
- Updated to match app light/dark theme tokens and voice-only panel behavior.

## Notes
- Current voice stack uses existing STT/TTS function architecture (`voice-chat`).
- For future "full duplex low-latency" voice, Realtime API migration can be Phase-2.

## 5) Medical report upload/analyze reliability fixes
- Updated [supabase/functions/analyze-medical-report/index.ts](supabase/functions/analyze-medical-report/index.ts)
- Fixed false "not medical report" rejection for valid PDF/image uploads:
  - earlier gate depended on readable extracted text only
  - now image/PDF/doc inline-analysis candidates are allowed even when text extraction is unavailable
  - added post-analysis medical validation to reject truly non-medical files safely
- Improved PathLabs/large PDF handling:
  - large PDFs are no longer rejected immediately just due to inline size limits
  - system now attempts best-effort PDF text extraction and runs text-mode analysis when possible
  - PDF text scan now samples head/middle/tail bytes to improve extraction success on varied lab PDF structures
  - when normal extraction is unreadable, AI OCR fallback now runs (Gemini OCR on uploaded file) and feeds extracted text into analysis
  - Gemini PDF inline payload format corrected for binary document parts (`inlineData`), improving direct PDF understanding reliability
  - if AI cannot read document content, user now gets explicit "could not read report clearly" instead of misleading "not a medical report"
  - document/image/PDF parse failures now return explicit readability/parsing error instead of false "not medical report" for uploaded reports
  - if initial AI output is too generic/shallow, analyzer auto-runs a stricter second-pass to produce detailed value-focused findings
  - compact/short lab text (value-heavy snippets) is now treated as readable medical text using medical-signal heuristics
  - extracted text ceiling increased (default now up to 30k chars, env-overridable) for better multi-page coverage
  - long reports with under-covered findings now trigger an automatic deep retry pass
  - PDF text extraction now runs by default before model analysis (better coverage for multi-page reports)
  - report max size is constrained to `4 MB` (server + client-side early validation)
  - final analysis default model is now `gpt-5.4` (env-overridable)
  - OCR now uses best-first Gemini OCR candidates (default order: `gemini-2.5-pro` -> `gemini-2.5-flash`)
- Added extra trace fields for medical-gate decisions (`looksMedical`, `canTrustFileAsMedicalCandidateWithoutText`).

- Updated [hooks/useMedicalReports.ts](hooks/useMedicalReports.ts)
- Improved report upload UX consistency:
  - `> 4 MB` report is rejected instantly on client with clear message (before edge analysis attempt)
  - newly uploaded report opens assistant flow immediately while analysis runs in background
  - newly uploaded report is inserted into React Query cache immediately
  - avoids stale/old report confusion right after upload
  - background analyzer failure updates row to `failed` and refreshes report caches

## 6) Fully dynamic report insights + prescription/lab UX
- Updated [ui/teleconsultation/HealthExplainedView.tsx](ui/teleconsultation/HealthExplainedView.tsx)
- Replaced hardcoded AI Insights with dynamic, report-driven experience:
  - reads analyzed reports from `medical_reports` data
  - dynamic sections: `What AI Found`, `Prescription Snapshot`, `Next 24 Hours Plan`, `What To Avoid`, `Recovery Timeline`
  - uses uploaded report metadata/analysis fields only (no hardcoded content)
  - adds freshness signal with "last updated" + 24-hour refresh window hint
  - includes quick actions to open latest prescription/lab report Q&A
  - adds medical safety note to prevent medication misuse

- Updated [ui/teleconsultation/HealthVaultView.tsx](ui/teleconsultation/HealthVaultView.tsx)
- Improved report categorization and insights wiring:
  - stronger `lab` and `prescription` tab matching (Path/LFT/KFT/thyroid/lipid/medicine keywords)
  - passes live report data into `HealthExplainedView` for dynamic rendering
  - tab-aware AI summary card: `Prescription` tab now shows prescription-only summary, `Lab` tab shows lab-only summary

- Updated [supabase/functions/analyze-medical-report/index.ts](supabase/functions/analyze-medical-report/index.ts)
- Extended structured AI output for dynamic insights:
  - `medications`
  - `what_to_avoid`
  - `next_24h_actions`
  - `recovery_timeline`
  - `insights_generated_at`
- Strengthened prompt guidance to extract prescription/lab actionable items only when clearly visible.

## 7) Settings Dynamic + i18n update
- Added complete settings update documentation in:
  - [SETTINGS_DYNAMIC_UPDATE_DOC.md](SETTINGS_DYNAMIC_UPDATE_DOC.md)
- Covers:
  - App language architecture (`AppLanguageProvider`, translation map, fallback rules)
  - Realtime/dynamic settings metrics (storage + unread notifications)
  - Optimistic update + sync/revert logic for settings toggles
  - File-wise change map for all updated settings screens
