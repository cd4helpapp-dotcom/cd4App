-- Keep existing remote hospital onboarding tables compatible with the latest Edge Function.
-- CREATE TABLE IF NOT EXISTS does not add columns when the table already exists.

ALTER TABLE public.hospital_onboarding_requests
  ADD COLUMN IF NOT EXISTS hospital_admin_user_id UUID,
  ADD COLUMN IF NOT EXISTS hospital_login_email TEXT,
  ADD COLUMN IF NOT EXISTS app_account_status TEXT NOT NULL DEFAULT 'created_pending_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hospital_onboarding_requests_app_account_status_check'
      AND conrelid = 'public.hospital_onboarding_requests'::regclass
  ) THEN
    ALTER TABLE public.hospital_onboarding_requests
      ADD CONSTRAINT hospital_onboarding_requests_app_account_status_check
      CHECK (app_account_status IN ('created_pending_review', 'active', 'disabled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS hospital_onboarding_requests_login_email_unique_idx
  ON public.hospital_onboarding_requests (LOWER(hospital_login_email));
