-- Add doctor onboarding/profile-completion fields used by first-login mandatory flow.
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS degree TEXT,
  ADD COLUMN IF NOT EXISTS university TEXT,
  ADD COLUMN IF NOT EXISTS year_of_completion INTEGER,
  ADD COLUMN IF NOT EXISTS registration_council TEXT,
  ADD COLUMN IF NOT EXISTS current_hospital_clinic TEXT,
  ADD COLUMN IF NOT EXISTS previous_work_details TEXT,
  ADD COLUMN IF NOT EXISTS areas_of_expertise TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS languages_spoken TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS treatment_approach TEXT,
  ADD COLUMN IF NOT EXISTS profile_completion_done BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_completion_done_at TIMESTAMPTZ;

-- Keep data quality in a safe range while allowing null during staged onboarding.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctors_year_of_completion_range_check'
      AND conrelid = 'public.doctors'::regclass
  ) THEN
    ALTER TABLE public.doctors
      ADD CONSTRAINT doctors_year_of_completion_range_check
      CHECK (year_of_completion IS NULL OR (year_of_completion >= 1950 AND year_of_completion <= 2100));
  END IF;
END $$;
