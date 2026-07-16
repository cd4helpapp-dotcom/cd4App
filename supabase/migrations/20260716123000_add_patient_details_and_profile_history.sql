-- Link a hospital patient using separate verified identity fields.
CREATE OR REPLACE FUNCTION public.hospital_link_patient_details(
  p_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_doctor_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_patient_id UUID;
  request_id UUID;
  inserted_id UUID;
  normalized_name TEXT := lower(trim(COALESCE(p_name, '')));
  normalized_email TEXT := lower(trim(COALESCE(p_email, '')));
  normalized_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role_slug() <> 'hospital' THEN
    RAISE EXCEPTION 'Hospital admin access required';
  END IF;
  IF normalized_name = '' OR normalized_email = '' OR normalized_phone = '' THEN
    RAISE EXCEPTION 'Patient name, email, and phone are required';
  END IF;

  SELECT id INTO request_id
  FROM public.hospital_onboarding_requests
  WHERE hospital_admin_user_id = auth.uid()
  ORDER BY created_at DESC LIMIT 1;

  IF p_doctor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.hospital_doctors
    WHERE hospital_admin_user_id = auth.uid() AND doctor_id = p_doctor_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select a doctor linked to this hospital';
  END IF;

  SELECT p.id INTO target_patient_id
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE COALESCE(r.slug, 'patient') = 'patient'
    AND lower(COALESCE(p.email, '')) = normalized_email
    AND lower(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))) = normalized_name
    AND regexp_replace(COALESCE(p.phone_number, ''), '[^0-9]', '', 'g') = normalized_phone
  LIMIT 1;

  IF target_patient_id IS NULL THEN
    RAISE EXCEPTION 'Patient details do not match a CD4 patient account';
  END IF;

  INSERT INTO public.hospital_patients (hospital_admin_user_id, onboarding_request_id, doctor_id, patient_id, notes, added_by)
  VALUES (auth.uid(), request_id, p_doctor_id, target_patient_id, NULLIF(trim(COALESCE(p_notes, '')), ''), auth.uid())
  ON CONFLICT (hospital_admin_user_id, patient_id) DO UPDATE
  SET doctor_id = EXCLUDED.doctor_id, notes = COALESCE(EXCLUDED.notes, hospital_patients.notes), status = 'active', updated_at = NOW()
  RETURNING id INTO inserted_id;
  RETURN inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hospital_link_patient_details(TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Patient can view linked hospital history" ON public.hospital_voice_intake_sessions;
CREATE POLICY "Patient can view linked hospital history"
ON public.hospital_voice_intake_sessions
FOR SELECT TO authenticated
USING (patient_id = auth.uid());

DROP POLICY IF EXISTS "AI reports hospital patient access" ON storage.objects;
CREATE POLICY "AI reports hospital patient access"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ai-reports'
  AND EXISTS (
    SELECT 1
    FROM public.hospital_voice_intake_sessions s
    WHERE s.patient_id = auth.uid()
      AND s.metadata->>'pdf_path' = storage.objects.name
  )
);
