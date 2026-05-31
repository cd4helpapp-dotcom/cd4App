-- Ensure these 3 emails always map to admin role:
-- 1) navinchandra665@gmail.com
-- 2) nitesh2kaushik@gmail.com
-- 3) prem31703@gmail.com

DO $$
DECLARE
  admin_role_id UUID;
BEGIN
  SELECT id INTO admin_role_id
  FROM public.roles
  WHERE slug = 'admin'
  LIMIT 1;

  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Admin role not found in public.roles';
  END IF;

  UPDATE public.profiles
  SET role_id = admin_role_id,
      updated_at = NOW()
  WHERE lower(email) IN (
    'navinchandra665@gmail.com',
    'nitesh2kaushik@gmail.com',
    'prem31703@gmail.com'
  );
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  target_role_slug TEXT;
  target_role_id UUID;
  normalized_email TEXT;
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

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
