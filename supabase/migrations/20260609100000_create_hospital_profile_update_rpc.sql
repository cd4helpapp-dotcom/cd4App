-- Safe hospital-owned profile update for the hospital app panel.
-- Keeps verification/legal review fields controlled, while allowing operational details to be updated.

CREATE OR REPLACE FUNCTION public.hospital_update_profile(
  p_display_name TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_full_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_pin_code TEXT DEFAULT NULL,
  p_google_maps_link TEXT DEFAULT NULL,
  p_authorized_person_name TEXT DEFAULT NULL,
  p_designation TEXT DEFAULT NULL,
  p_mobile_number TEXT DEFAULT NULL,
  p_whatsapp_number TEXT DEFAULT NULL,
  p_official_email TEXT DEFAULT NULL,
  p_specialities TEXT[] DEFAULT NULL,
  p_facilities TEXT[] DEFAULT NULL,
  p_opd_timings TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id UUID;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role_slug() <> 'hospital' THEN
    RAISE EXCEPTION 'Hospital admin access required';
  END IF;

  SELECT id INTO request_id
  FROM public.hospital_onboarding_requests
  WHERE hospital_admin_user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  IF request_id IS NULL THEN
    RAISE EXCEPTION 'Hospital onboarding profile not found';
  END IF;

  UPDATE public.hospital_onboarding_requests
  SET
    display_name = NULLIF(trim(COALESCE(p_display_name, display_name, '')), ''),
    website = NULLIF(trim(COALESCE(p_website, website, '')), ''),
    full_address = COALESCE(NULLIF(trim(COALESCE(p_full_address, '')), ''), full_address),
    city = COALESCE(NULLIF(trim(COALESCE(p_city, '')), ''), city),
    state = COALESCE(NULLIF(trim(COALESCE(p_state, '')), ''), state),
    pin_code = COALESCE(NULLIF(trim(COALESCE(p_pin_code, '')), ''), pin_code),
    google_maps_link = NULLIF(trim(COALESCE(p_google_maps_link, google_maps_link, '')), ''),
    authorized_person_name = COALESCE(NULLIF(trim(COALESCE(p_authorized_person_name, '')), ''), authorized_person_name),
    designation = COALESCE(NULLIF(trim(COALESCE(p_designation, '')), ''), designation),
    mobile_number = COALESCE(NULLIF(trim(COALESCE(p_mobile_number, '')), ''), mobile_number),
    whatsapp_number = NULLIF(trim(COALESCE(p_whatsapp_number, whatsapp_number, '')), ''),
    official_email = COALESCE(NULLIF(lower(trim(COALESCE(p_official_email, ''))), ''), official_email),
    specialities = COALESCE(p_specialities, specialities),
    facilities = COALESCE(p_facilities, facilities),
    opd_timings = COALESCE(NULLIF(trim(COALESCE(p_opd_timings, '')), ''), opd_timings),
    updated_at = NOW()
  WHERE id = request_id
    AND hospital_admin_user_id = auth.uid();

  RETURN request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hospital_update_profile(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT
) TO authenticated;
