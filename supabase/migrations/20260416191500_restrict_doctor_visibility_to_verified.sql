-- Restrict doctor discovery to verified doctors for public/patient views.
-- Allow admin to review all doctors and allow each doctor to view their own row.

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.doctors
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill explicit doctor verification flag from existing legacy KYC flag.
UPDATE public.doctors
SET is_verified = COALESCE(kyc_verify, false)
WHERE is_verified IS DISTINCT FROM COALESCE(kyc_verify, false);

CREATE INDEX IF NOT EXISTS doctors_is_verified_idx ON public.doctors (is_verified);

DROP POLICY IF EXISTS "Doctors are viewable" ON public.doctors;

CREATE POLICY "Doctors are viewable"
ON public.doctors
FOR SELECT
TO authenticated, anon
USING (
  is_verified = true
  OR auth.uid() = id
  OR public.current_user_role_slug() = 'admin'
);
