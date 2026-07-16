-- Keep the existing RPC signature, but allow hospital staff to link a doctor
-- by the doctor's name as well as the existing email/registration identifier.

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
    RAISE EXCEPTION 'Doctor name or email is required';
  END IF;

  SELECT id INTO request_id
  FROM public.hospital_onboarding_requests
  WHERE hospital_admin_user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT d.id INTO target_doctor_id
  FROM public.doctors d
  LEFT JOIN public.profiles p ON p.id = d.id
  WHERE lower(COALESCE(p.email, '')) = normalized_identifier
     OR lower(COALESCE(d.registration_number, '')) = normalized_identifier
     OR lower(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))) = normalized_identifier
     OR lower(COALESCE(p.first_name, '')) = normalized_identifier
     OR lower(COALESCE(p.last_name, '')) = normalized_identifier
  ORDER BY
    CASE
      WHEN lower(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))) = normalized_identifier THEN 0
      WHEN lower(COALESCE(p.email, '')) = normalized_identifier THEN 1
      ELSE 2
    END,
    d.created_at DESC NULLS LAST
  LIMIT 1;

  IF target_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Doctor not found. Use the doctor name or registered CD4 email.';
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

GRANT EXECUTE ON FUNCTION public.hospital_link_doctor(TEXT, TEXT) TO authenticated;
