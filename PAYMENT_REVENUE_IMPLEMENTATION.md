# Payment + Revenue Implementation (Appointment + Subscription)

## Scope Implemented
- Appointment booking now follows payment-first flow.
- Subscription upgrade now follows order -> verify flow.
- Revenue ledger added for appointment payments with 70/30 split.
- Admin dashboard now shows revenue summary cards.

## Appointment Flow
1. Patient selects doctor slot.
2. App calls `manage-appointment-payment` with `action=create_order`.
3. Backend creates `appointment_payments` row with:
- `gross_amount = 500`
- `doctor_share = 350` (70%)
- `platform_commission = 150` (30%)
4. App calls `manage-appointment-payment` with `action=verify_and_book`.
5. Backend:
- marks payment as `paid`
- creates appointment
- marks slot as booked
6. Only after this step appointment is confirmed.

## Subscription Flow
1. App calls `manage-pro-subscription` with `action=create_order`.
2. App calls `manage-pro-subscription` with `action=verify_payment`.
3. Backend activates subscription and writes `subscription_payments` record.

## New Database Objects
- Migration: `supabase/migrations/20260510100000_create_appointment_payments_and_revenue.sql`
- Table: `appointment_payments`
- RLS:
  - patient can read own payments
  - doctor can read own payments
  - admin can read all

## New/Updated Edge Functions
- New: `supabase/functions/manage-appointment-payment/index.ts`
  - `create_order`
  - `verify_and_book`
- Updated: `supabase/functions/manage-pro-subscription/index.ts`
  - `create_order`
  - `verify_payment`
  - legacy `activate_test` behavior preserved

## Admin Revenue
- Hook: `useAdminRevenue` in `hooks/useAdmin.ts`
- Uses:
  - `appointment_payments` (paid rows)
  - `subscription_payments` (paid rows)
- Exposes:
  - appointment gross
  - doctor payout
  - platform commission
  - subscription revenue
  - total platform revenue
  - doctor-wise revenue breakup

## Environment Setup
- Frontend `.env`:
  - `EXPO_PUBLIC_RAZORPAY_KEY_ID=...`
- Supabase Edge Function secrets:
  - `RAZORPAY_KEY_ID=...`
  - `RAZORPAY_KEY_SECRET=...`
  - `RAZORPAY_WEBHOOK_SECRET=...`

## Where To Keep Which Key
- Keep in frontend `.env` (safe to expose in app bundle):
  - `EXPO_PUBLIC_RAZORPAY_KEY_ID`
- Keep in Supabase secrets only (never in frontend `.env`):
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`

## Supabase Secret Commands
```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxx
supabase secrets set RAZORPAY_KEY_SECRET=your_secret_here
supabase secrets set RAZORPAY_WEBHOOK_SECRET=whsec_xxxxx
```

## Deploy Commands
```bash
supabase functions deploy manage-appointment-payment
supabase functions deploy manage-pro-subscription
supabase functions deploy razorpay-webhook
```

## Migration Apply
- Apply latest SQL migrations before deploying functions, including:
  - `20260510100000_create_appointment_payments_and_revenue.sql`
  - `20260510113000_add_razorpay_webhook_events.sql`
  - `20260510123000_add_finalize_appointment_payment_rpc.sql`

## Webhook Integration (Standard)
- New function: `supabase/functions/razorpay-webhook/index.ts`
- Signature verification:
  - reads `x-razorpay-signature`
  - validates with `RAZORPAY_WEBHOOK_SECRET` using HMAC SHA-256
- Idempotency:
  - stores each webhook in `payment_webhook_events`
  - unique key: `(provider, event_id)`
- Handled events:
  - payment capture/authorization -> marks payment as `paid`
  - payment failed -> marks payment as `failed`
  - refund events -> marks appointment payment as `refunded`
- Sync targets:
  - `appointment_payments`
  - `subscription_payments`

## Important Risk Notes
- `verify_and_book` should run inside DB transaction/RPC in production to guarantee strict atomicity.
- Refund/cancel flow is not yet implemented for appointment payments.
- Webhook reconciliation is not yet implemented. Production setup should reconcile payment status from Razorpay webhooks.

## Production Hardening Checklist
1. Add Razorpay order creation using server key/secret.
2. Verify payment signature on backend (`razorpay_signature` HMAC validation).
3. Add idempotency keys for create/verify actions.
4. Move booking + payment status update into one SQL RPC transaction.
5. Add refund APIs and status sync.
6. Add admin Revenue tab screen for full doctor-wise breakdown table export.
