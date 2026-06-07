-- Hospital onboarding intake for public CD4 web form.
-- Submissions are written by a Supabase Edge Function with service role access.

INSERT INTO public.roles (name, slug, description)
VALUES ('Hospital', 'hospital', 'Hospital partner account')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.hospital_onboarding_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'under_review', 'contacted', 'approved', 'rejected', 'converted')),

  registered_name TEXT NOT NULL,
  display_name TEXT,
  facility_type TEXT NOT NULL,
  ownership_type TEXT,
  website TEXT,
  years_in_operation INTEGER CHECK (years_in_operation IS NULL OR years_in_operation >= 0),
  hospital_description TEXT,

  registration_number TEXT NOT NULL,
  registering_authority TEXT NOT NULL,
  registration_expiry DATE,
  accreditation_status TEXT,
  tax_identifier TEXT,
  primary_document_link TEXT,
  available_documents TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  full_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pin_code TEXT NOT NULL,
  google_maps_link TEXT,
  service_area TEXT,

  authorized_person_name TEXT NOT NULL,
  designation TEXT NOT NULL,
  mobile_number TEXT NOT NULL,
  whatsapp_number TEXT,
  official_email TEXT NOT NULL,
  backup_contact TEXT,

  hospital_admin_user_id UUID,
  hospital_login_email TEXT NOT NULL,
  app_account_status TEXT NOT NULL DEFAULT 'created_pending_review'
    CHECK (app_account_status IN ('created_pending_review', 'active', 'disabled')),

  specialities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  facilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  appointment_mode TEXT NOT NULL,
  opd_timings TEXT NOT NULL,
  initial_doctor_count INTEGER CHECK (initial_doctor_count IS NULL OR initial_doctor_count > 0),
  consultation_fee_range TEXT,
  first_doctors_departments TEXT,

  onboarding_priorities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  go_live_timeline TEXT,
  preferred_call_time TEXT,
  referral_source TEXT,
  additional_notes TEXT,

  authorization_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
  document_paths TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  submitted_ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hospital_onboarding_requests_status_idx
  ON public.hospital_onboarding_requests (status);

CREATE INDEX IF NOT EXISTS hospital_onboarding_requests_city_idx
  ON public.hospital_onboarding_requests (city);

CREATE INDEX IF NOT EXISTS hospital_onboarding_requests_created_at_idx
  ON public.hospital_onboarding_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS hospital_onboarding_requests_registration_number_idx
  ON public.hospital_onboarding_requests (registration_number);

CREATE UNIQUE INDEX IF NOT EXISTS hospital_onboarding_requests_login_email_unique_idx
  ON public.hospital_onboarding_requests (LOWER(hospital_login_email));

ALTER TABLE public.hospital_onboarding_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital onboarding admin select" ON public.hospital_onboarding_requests;
CREATE POLICY "Hospital onboarding admin select"
ON public.hospital_onboarding_requests
FOR SELECT
TO authenticated
USING (public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "Hospital onboarding admin update" ON public.hospital_onboarding_requests;
CREATE POLICY "Hospital onboarding admin update"
ON public.hospital_onboarding_requests
FOR UPDATE
TO authenticated
USING (public.current_user_role_slug() = 'admin')
WITH CHECK (public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "Hospital onboarding admin delete" ON public.hospital_onboarding_requests;
CREATE POLICY "Hospital onboarding admin delete"
ON public.hospital_onboarding_requests
FOR DELETE
TO authenticated
USING (public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "Hospital onboarding service role all" ON public.hospital_onboarding_requests;
CREATE POLICY "Hospital onboarding service role all"
ON public.hospital_onboarding_requests
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT, UPDATE, DELETE ON public.hospital_onboarding_requests TO authenticated;
GRANT ALL ON public.hospital_onboarding_requests TO service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('hospital-onboarding-docs', 'hospital-onboarding-docs', false)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Hospital onboarding docs admin read" ON storage.objects;
CREATE POLICY "Hospital onboarding docs admin read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hospital-onboarding-docs'
  AND public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Hospital onboarding docs admin delete" ON storage.objects;
CREATE POLICY "Hospital onboarding docs admin delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'hospital-onboarding-docs'
  AND public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Hospital onboarding docs service role all" ON storage.objects;
CREATE POLICY "Hospital onboarding docs service role all"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'hospital-onboarding-docs')
WITH CHECK (bucket_id = 'hospital-onboarding-docs');
