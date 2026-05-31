# Security Ops Runbook

## Scope
- Private storage + signed URLs only for sensitive buckets.
- Edge-function abuse protection (auth, authorization, rate-limit, audit logging).
- Ongoing operations: key rotation, anomaly review, periodic penetration testing.

## Server Secrets (Edge env only)
Never expose these as `EXPO_PUBLIC_*`:
- `SUPABASE_SERVICE_ROLE_KEY`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `SECURITY_OPS_CRON_SECRET`

## Scheduled Security Monitor
Function: `security-ops-monitor`
- Auth mode:
  - Cron: `x-security-ops-secret: <SECURITY_OPS_CRON_SECRET>`
  - Manual admin invoke: bearer token + admin role check + rate-limit
- Actions:
  - Materialize anomaly alerts from `security_anomaly_signals`
  - Flag overdue key rotation
  - Flag pen-test items due soon
  - Notify admins via `in_app_notifications` (`type=security_ops_alert`)

## Edge JWT Policy (`--no-verify-jwt` guard)
Default rule:
- Edge functions must run with JWT verification enabled.

Allowed exceptions only:
- `chat-agent-ws`: WebSocket browser handshake cannot reliably carry bearer header; token is validated in-function.
- `health-reminders`: cron/manual-secret invocations supported.
- `security-ops-monitor`: cron/manual-secret invocations supported.

Automated policy check:
- Run `npm run security:check-edge-jwt`
- Script fails if any non-allowlisted function has `verify_jwt=false` in `supabase/config.toml`.

## Key Rotation SOP
1. Rotate provider keys/secrets in secure vault.
2. Update Supabase edge-function secrets.
3. Redeploy affected edge functions.
4. Validate production health checks.
5. Record event in `security_key_rotations` with:
   - `key_name`
   - `previous_fingerprint` (masked/hash)
   - `new_fingerprint` (masked/hash)
   - `rotation_reason`
   - `status`

## Pen-test SOP
1. Track cadence in `security_pentest_schedule` (default quarterly = 90 days).
2. Execute test for:
   - Auth/session handling
   - RLS bypass attempts
   - Storage access controls
   - Edge-function abuse/flood scenarios
3. Store findings and remediation notes in `notes`.
4. Update `last_completed_at`, `next_due_at`, `status`.

## Alert Review
- Table: `security_audit_logs`
- Critical events to review daily:
  - `security_anomaly_alert`
  - `*_rate_limited`
  - `*_forbidden`
  - `*_exception`
  - `security_key_rotation_overdue`
  - `security_pentest_due`
