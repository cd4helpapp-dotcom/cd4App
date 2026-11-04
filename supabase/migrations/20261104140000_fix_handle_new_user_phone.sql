-- Fix handle_new_user trigger to preserve phone_number from user metadata during email signup
-- Previously new.phone was used, which is only present in SMS auth and NULL in email auth.

-- 1. Safely remove strict UNIQUE constraint on profiles.phone_number.
-- In CD4 Health, primary auth is by EMAIL. Phone number is contact metadata.
-- Enforcing strict UNIQUE on phone_number caused:
-- (a) "duplicate key value violates unique constraint profiles_phone_number_key" when testing accounts or when family members share a mobile number.
-- (b) Migration backfill failures on production database.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_phone_number_key;
DROP INDEX IF EXISTS public.profiles_phone_number_key;
CREATE INDEX IF NOT EXISTS idx_profiles_phone_number ON public.profiles(phone_number);

-- 2. Update trigger to pull phone from raw_user_meta_data
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  target_role_slug TEXT;
  target_role_id UUID;
  normalized_email TEXT;
  extracted_phone TEXT;
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
  ELSIF new.raw_app_meta_data->>'role' = 'hospital' THEN
    target_role_slug := 'hospital';
  ELSIF new.raw_user_meta_data->>'role' = 'doctor' THEN
    target_role_slug := 'doctor';
  ELSE
    target_role_slug := 'patient';
  END IF;

  SELECT id INTO target_role_id FROM public.roles WHERE slug = target_role_slug LIMIT 1;
  IF target_role_id IS NULL THEN
    SELECT id INTO target_role_id FROM public.roles WHERE slug = 'patient' LIMIT 1;
  END IF;

  extracted_phone := COALESCE(
    NULLIF(TRIM(new.raw_user_meta_data->>'phone_number'), ''),
    NULLIF(TRIM(new.raw_user_meta_data->>'phone'), ''),
    NULLIF(TRIM(new.raw_user_meta_data->>'phoneNumber'), ''),
    NULLIF(TRIM(new.phone), '')
  );

  INSERT INTO public.profiles (id, first_name, last_name, email, phone_number, role_id)
  VALUES (
    new.id,
    COALESCE(
      NULLIF(TRIM(new.raw_user_meta_data->>'first_name'), ''),
      NULLIF(TRIM(new.raw_user_meta_data->>'firstName'), ''),
      split_part(COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1),
      'User'
    ),
    COALESCE(
      NULLIF(TRIM(new.raw_user_meta_data->>'last_name'), ''),
      NULLIF(TRIM(new.raw_user_meta_data->>'lastName'), ''),
      ''
    ),
    new.email,
    extracted_phone,
    target_role_id
  )
  ON CONFLICT (id) DO UPDATE
  SET phone_number = COALESCE(public.profiles.phone_number, EXCLUDED.phone_number, extracted_phone),
      role_id = EXCLUDED.role_id,
      updated_at = NOW();

  IF target_role_slug = 'admin' THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin'),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
    WHERE id = new.id;
  END IF;

  IF target_role_slug = 'doctor' THEN
    doctor_city := COALESCE(NULLIF(new.raw_user_meta_data->>'city', ''), 'City Not Set');
    doctor_specialization := COALESCE(NULLIF(new.raw_user_meta_data->>'specialization', ''), 'General Physician');
    doctor_experience := COALESCE(NULLIF(new.raw_user_meta_data->>'experience', ''), '1');
    doctor_fee := COALESCE(NULLIF(new.raw_user_meta_data->>'fee', ''), '500');
    doctor_bio := COALESCE(NULLIF(new.raw_user_meta_data->>'bio', ''), 'Verified Medical Specialist');
    doctor_registration_number := COALESCE(NULLIF(new.raw_user_meta_data->>'registration_number', ''), 'REG-' || substring(new.id::text, 1, 8));

    INSERT INTO public.doctors (
      id,
      city,
      specialization,
      experience,
      fee,
      bio,
      registration_number,
      kyc_verify
    )
    VALUES (
      new.id,
      doctor_city,
      doctor_specialization,
      doctor_experience,
      doctor_fee,
      doctor_bio,
      doctor_registration_number,
      FALSE
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Backfill phone numbers for existing profiles from auth.users metadata
UPDATE public.profiles p
SET phone_number = COALESCE(
      NULLIF(TRIM(u.raw_user_meta_data->>'phone_number'), ''),
      NULLIF(TRIM(u.raw_user_meta_data->>'phone'), ''),
      NULLIF(TRIM(u.raw_user_meta_data->>'phoneNumber'), ''),
      NULLIF(TRIM(u.phone), '')
    ),
    updated_at = NOW()
FROM auth.users u
WHERE p.id = u.id
  AND (p.phone_number IS NULL OR p.phone_number = '')
  AND (
    (u.raw_user_meta_data->>'phone_number' IS NOT NULL AND TRIM(u.raw_user_meta_data->>'phone_number') <> '') OR
    (u.raw_user_meta_data->>'phone' IS NOT NULL AND TRIM(u.raw_user_meta_data->>'phone') <> '') OR
    (u.raw_user_meta_data->>'phoneNumber' IS NOT NULL AND TRIM(u.raw_user_meta_data->>'phoneNumber') <> '') OR
    (u.phone IS NOT NULL AND TRIM(u.phone) <> '')
  );
