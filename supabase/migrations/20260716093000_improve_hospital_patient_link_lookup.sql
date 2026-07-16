-- Allow hospital staff to link a patient using the value they actually know:
-- email, full/partial name, phone number, or profile UUID.
-- The existing RPC name/signature is preserved so deployed clients keep working.

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
  normalized_identifier TEXT := lower(trim(COALESCE(p_email, '')));
  target_patient_id UUID;
  request_id UUID;
  inserted_id UUID;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role_slug() <> 'hospital' THEN
    RAISE EXCEPTION 'Hospital admin access required';
  END IF;

  IF normalized_identifier = '' THEN
    RAISE EXCEPTION 'Patient email, name, phone, or profile ID is required';
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
  WHERE COALESCE(r.slug, 'patient') = 'patient'
    AND (
      lower(COALESCE(p.email, '')) = normalized_identifier
      OR lower(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))) = normalized_identifier
      OR lower(COALESCE(p.first_name, '')) = normalized_identifier
      OR lower(COALESCE(p.last_name, '')) = normalized_identifier
      OR (
        normalized_identifier ~ '[0-9]'
        AND regexp_replace(COALESCE(p.phone_number, ''), '[^0-9]', '', 'g') = regexp_replace(normalized_identifier, '[^0-9]', '', 'g')
      )
      OR p.id::text = normalized_identifier
    )
  ORDER BY
    CASE WHEN lower(COALESCE(p.email, '')) = normalized_identifier THEN 0 ELSE 1 END,
    p.created_at DESC NULLS LAST
  LIMIT 1;

  IF target_patient_id IS NULL THEN
    RAISE EXCEPTION 'Patient not found. Use the registered email, full name, phone, or profile ID.';
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

GRANT EXECUTE ON FUNCTION public.hospital_link_patient(TEXT, UUID, TEXT) TO authenticated;
