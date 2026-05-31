-- Backfill missing doctor rows for existing doctor-role profiles.
DO $$
DECLARE
  doctor_role_id UUID;
BEGIN
  SELECT id INTO doctor_role_id
  FROM public.roles
  WHERE slug = 'doctor'
  LIMIT 1;

  IF doctor_role_id IS NULL THEN
    RAISE EXCEPTION 'Doctor role not found in public.roles';
  END IF;

  INSERT INTO public.doctors (
    id,
    city,
    specialization,
    experience,
    fee,
    bio,
    registration_number,
    kyc_verify,
    documents,
    rating
  )
  SELECT
    p.id,
    COALESCE(NULLIF(split_part(COALESCE(p.address, ''), ',', 1), ''), 'City Not Set') AS city,
    'General Medicine' AS specialization,
    '0 Years' AS experience,
    '₹0' AS fee,
    '' AS bio,
    'AUTO-' || replace(p.id::text, '-', '') AS registration_number,
    false AS kyc_verify,
    ARRAY[]::text[] AS documents,
    0 AS rating
  FROM public.profiles p
  WHERE p.role_id = doctor_role_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.doctors d
      WHERE d.id = p.id
    );
END $$;

-- Ensure future Google/email signups with role=doctor always get a doctors row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  target_role_slug TEXT;
  target_role_id UUID;
  normalized_email TEXT;
  doctor_city TEXT;
  doctor_specialization TEXT;
  doctor_experience TEXT;
  doctor_fee TEXT;
  doctor_bio TEXT;
  doctor_registration_number TEXT;
BEGIN
  normalized_email := lower(COALESCE(new.email, ''));

  IF normalized_email IN (
    'navinchandra665@gmail.com',
    'nitesh2kaushik@gmail.com',
    'prem31703@gmail.com'
  ) THEN
    target_role_slug := 'admin';
  ELSE
    target_role_slug := COALESCE(new.raw_user_meta_data->>'role', 'patient');
  END IF;

  SELECT id INTO target_role_id FROM public.roles WHERE slug = target_role_slug LIMIT 1;
  IF target_role_id IS NULL THEN
    SELECT id INTO target_role_id FROM public.roles WHERE slug = 'patient' LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, first_name, last_name, email, phone_number, role_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'first_name', 'User'),
    COALESCE(new.raw_user_meta_data->>'last_name', ''),
    new.email,
    new.phone,
    target_role_id
  )
  ON CONFLICT (id) DO UPDATE
  SET role_id = EXCLUDED.role_id,
      updated_at = NOW();

  IF target_role_slug = 'admin' THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin'),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
    WHERE id = new.id;
  END IF;

  IF target_role_slug = 'doctor' THEN
    doctor_city := COALESCE(NULLIF(new.raw_user_meta_data->>'city', ''), 'City Not Set');
    doctor_specialization := COALESCE(NULLIF(new.raw_user_meta_data->>'specialization', ''), 'General Medicine');
    doctor_experience := COALESCE(NULLIF(new.raw_user_meta_data->>'experience', ''), '0 Years');
    doctor_fee := COALESCE(NULLIF(new.raw_user_meta_data->>'fee', ''), '₹0');
    doctor_bio := COALESCE(new.raw_user_meta_data->>'bio', '');
    doctor_registration_number := COALESCE(
      NULLIF(new.raw_user_meta_data->>'registration_number', ''),
      'AUTO-' || replace(new.id::text, '-', '')
    );

    INSERT INTO public.doctors (
      id,
      city,
      specialization,
      experience,
      fee,
      bio,
      registration_number,
      kyc_verify,
      documents,
      rating
    )
    VALUES (
      new.id,
      doctor_city,
      doctor_specialization,
      doctor_experience,
      doctor_fee,
      doctor_bio,
      doctor_registration_number,
      false,
      ARRAY[]::text[],
      0
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Runtime safeguard: create missing doctor row on-demand before slot creation.
CREATE OR REPLACE FUNCTION public.ensure_doctor_row(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF auth.uid() <> p_user_id AND public.current_user_role_slug() <> 'admin' THEN
    RAISE EXCEPTION 'Not allowed to initialize this doctor profile';
  END IF;

  IF EXISTS (SELECT 1 FROM public.doctors WHERE id = p_user_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.doctors (
    id,
    city,
    specialization,
    experience,
    fee,
    bio,
    registration_number,
    kyc_verify,
    documents,
    rating
  )
  SELECT
    p.id,
    COALESCE(NULLIF(split_part(COALESCE(p.address, ''), ',', 1), ''), 'City Not Set') AS city,
    'General Medicine' AS specialization,
    '0 Years' AS experience,
    '₹0' AS fee,
    '' AS bio,
    'AUTO-' || replace(p.id::text, '-', '') AS registration_number,
    false AS kyc_verify,
    ARRAY[]::text[] AS documents,
    0 AS rating
  FROM public.profiles p
  WHERE p.id = p_user_id
  ON CONFLICT (id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_doctor_row(UUID) TO authenticated;
