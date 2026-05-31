# Dummy Doctor Seed (India Cities + Departments)

This seed is for quickly onboarding dummy doctors into Supabase for testing.

## Files

- `supabase/seed/india_dummy_doctors.json`  
  Source doctor dataset (city, specialization, KYC doc URLs, profile fields).
- `scripts/seed-dummy-doctors.mjs`  
  Creates/uses auth users, updates `profiles`, upserts `doctors`.

## Required env

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Optional: `DUMMY_DOCTOR_PASSWORD` (default: `CD4@12345`)

## Commands

Validate JSON only:

```bash
npm run seed:dummy-doctors:dry
```

Run real DB seed:

```bash
npm run seed:dummy-doctors
```

Use custom data file:

```bash
node scripts/seed-dummy-doctors.mjs --file=supabase/seed/india_dummy_doctors.json
```

## What the script does

1. Checks/uses `doctor` role id from `roles`.
2. For each doctor:
   - Creates auth user if profile/email does not exist.
   - Updates `profiles` (`role_id`, `is_verified`, `profile_setup_completed`, basic identity fields).
   - Upserts `doctors` row with city/specialization/experience/fee/registration/KYC/docs and profile-completion fields.
3. Marks doctor as verified:
   - `doctors.kyc_verify = true`
   - `doctors.is_verified = true`
