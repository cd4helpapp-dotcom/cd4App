-- Hospital admin panel foundation.
-- Hospitals are onboarded from the public web form, then managed from the mobile app.

INSERT INTO public.roles (name, slug, description)
VALUES ('Hospital', 'hospital', 'Hospital partner account')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.hospital_doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_admin_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  onboarding_request_id UUID REFERENCES public.hospital_onboarding_requests(id) ON DELETE SET NULL,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'pending')),
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_admin_user_id, doctor_id)
);

CREATE TABLE IF NOT EXISTS public.hospital_patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_admin_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  onboarding_request_id UUID REFERENCES public.hospital_onboarding_requests(id) ON DELETE SET NULL,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'discharged')),
  notes TEXT,
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_admin_user_id, patient_id)
);

CREATE TABLE IF NOT EXISTS public.hospital_voice_intake_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_admin_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  onboarding_request_id UUID REFERENCES public.hospital_onboarding_requests(id) ON DELETE SET NULL,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Hospital voice intake',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'ready_for_doctor', 'closed')),
  language TEXT NOT NULL DEFAULT 'Hindi / English',
  transcript TEXT,
  ai_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hospital_doctors_hospital_idx
  ON public.hospital_doctors (hospital_admin_user_id, status);

CREATE INDEX IF NOT EXISTS hospital_doctors_doctor_idx
  ON public.hospital_doctors (doctor_id);

CREATE INDEX IF NOT EXISTS hospital_patients_hospital_idx
  ON public.hospital_patients (hospital_admin_user_id, status);

CREATE INDEX IF NOT EXISTS hospital_patients_doctor_idx
  ON public.hospital_patients (doctor_id);

CREATE INDEX IF NOT EXISTS hospital_patients_patient_idx
  ON public.hospital_patients (patient_id);

CREATE INDEX IF NOT EXISTS hospital_voice_intake_hospital_idx
  ON public.hospital_voice_intake_sessions (hospital_admin_user_id, status, created_at DESC);

ALTER TABLE public.hospital_onboarding_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital onboarding own select" ON public.hospital_onboarding_requests;
CREATE POLICY "Hospital onboarding own select"
ON public.hospital_onboarding_requests
FOR SELECT
TO authenticated
USING (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

ALTER TABLE public.hospital_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_voice_intake_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital doctors own select" ON public.hospital_doctors;
CREATE POLICY "Hospital doctors own select"
ON public.hospital_doctors
FOR SELECT
TO authenticated
USING (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Hospital doctors own insert" ON public.hospital_doctors;
CREATE POLICY "Hospital doctors own insert"
ON public.hospital_doctors
FOR INSERT
TO authenticated
WITH CHECK (
  hospital_admin_user_id = auth.uid()
  AND public.current_user_role_slug() = 'hospital'
);

DROP POLICY IF EXISTS "Hospital doctors own update" ON public.hospital_doctors;
CREATE POLICY "Hospital doctors own update"
ON public.hospital_doctors
FOR UPDATE
TO authenticated
USING (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
)
WITH CHECK (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Hospital patients own select" ON public.hospital_patients;
CREATE POLICY "Hospital patients own select"
ON public.hospital_patients
FOR SELECT
TO authenticated
USING (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Hospital patients own insert" ON public.hospital_patients;
CREATE POLICY "Hospital patients own insert"
ON public.hospital_patients
FOR INSERT
TO authenticated
WITH CHECK (
  hospital_admin_user_id = auth.uid()
  AND public.current_user_role_slug() = 'hospital'
);

DROP POLICY IF EXISTS "Hospital patients own update" ON public.hospital_patients;
CREATE POLICY "Hospital patients own update"
ON public.hospital_patients
FOR UPDATE
TO authenticated
USING (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
)
WITH CHECK (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Hospital voice own select" ON public.hospital_voice_intake_sessions;
CREATE POLICY "Hospital voice own select"
ON public.hospital_voice_intake_sessions
FOR SELECT
TO authenticated
USING (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Hospital voice own insert" ON public.hospital_voice_intake_sessions;
CREATE POLICY "Hospital voice own insert"
ON public.hospital_voice_intake_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  hospital_admin_user_id = auth.uid()
  AND public.current_user_role_slug() = 'hospital'
);

DROP POLICY IF EXISTS "Hospital voice own update" ON public.hospital_voice_intake_sessions;
CREATE POLICY "Hospital voice own update"
ON public.hospital_voice_intake_sessions
FOR UPDATE
TO authenticated
USING (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
)
WITH CHECK (
  hospital_admin_user_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

DROP POLICY IF EXISTS "Profiles hospital mapped patient select" ON public.profiles;
CREATE POLICY "Profiles hospital mapped patient select"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.hospital_patients hp
    WHERE hp.hospital_admin_user_id = auth.uid()
      AND hp.patient_id = profiles.id
  )
);

CREATE OR REPLACE FUNCTION public.hospital_link_doctor(
  p_identifier TEXT,
  p_department TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_identifier TEXT := lower(trim(COALESCE(p_identifier, '')));
  target_doctor_id UUID;
  request_id UUID;
  inserted_id UUID;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role_slug() <> 'hospital' THEN
    RAISE EXCEPTION 'Hospital admin access required';
  END IF;

  IF normalized_identifier = '' THEN
    RAISE EXCEPTION 'Doctor email or registration number is required';
  END IF;

  SELECT id INTO request_id
  FROM public.hospital_onboarding_requests
  WHERE hospital_admin_user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT d.id INTO target_doctor_id
  FROM public.doctors d
  LEFT JOIN public.profiles p ON p.id = d.id
  WHERE lower(COALESCE(d.registration_number, '')) = normalized_identifier
     OR lower(COALESCE(p.email, '')) = normalized_identifier
  LIMIT 1;

  IF target_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Doctor not found';
  END IF;

  INSERT INTO public.hospital_doctors (
    hospital_admin_user_id,
    onboarding_request_id,
    doctor_id,
    department,
    added_by
  )
  VALUES (
    auth.uid(),
    request_id,
    target_doctor_id,
    NULLIF(trim(COALESCE(p_department, '')), ''),
    auth.uid()
  )
  ON CONFLICT (hospital_admin_user_id, doctor_id) DO UPDATE
  SET department = COALESCE(EXCLUDED.department, hospital_doctors.department),
      status = 'active',
      updated_at = NOW()
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hospital_link_patient(
  p_email TEXT,
  p_doctor_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email TEXT := lower(trim(COALESCE(p_email, '')));
  target_patient_id UUID;
  request_id UUID;
  inserted_id UUID;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role_slug() <> 'hospital' THEN
    RAISE EXCEPTION 'Hospital admin access required';
  END IF;

  IF normalized_email = '' THEN
    RAISE EXCEPTION 'Patient email is required';
  END IF;

  SELECT id INTO request_id
  FROM public.hospital_onboarding_requests
  WHERE hospital_admin_user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  IF p_doctor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.hospital_doctors hd
    WHERE hd.hospital_admin_user_id = auth.uid()
      AND hd.doctor_id = p_doctor_id
      AND hd.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Doctor is not linked to this hospital';
  END IF;

  SELECT p.id INTO target_patient_id
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE lower(COALESCE(p.email, '')) = normalized_email
    AND COALESCE(r.slug, 'patient') = 'patient'
  LIMIT 1;

  IF target_patient_id IS NULL THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  INSERT INTO public.hospital_patients (
    hospital_admin_user_id,
    onboarding_request_id,
    doctor_id,
    patient_id,
    notes,
    added_by
  )
  VALUES (
    auth.uid(),
    request_id,
    p_doctor_id,
    target_patient_id,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    auth.uid()
  )
  ON CONFLICT (hospital_admin_user_id, patient_id) DO UPDATE
  SET doctor_id = COALESCE(EXCLUDED.doctor_id, hospital_patients.doctor_id),
      notes = COALESCE(EXCLUDED.notes, hospital_patients.notes),
      status = 'active',
      updated_at = NOW()
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hospital_link_doctor(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hospital_link_patient(TEXT, UUID, TEXT) TO authenticated;
