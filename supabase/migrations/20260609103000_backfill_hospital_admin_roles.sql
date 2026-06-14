-- Existing hospital onboarding accounts may have been created before the hospital role existed.
-- Move every linked hospital admin profile onto the hospital role.

INSERT INTO public.roles (name, slug, description)
VALUES ('Hospital', 'hospital', 'Hospital partner account')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = NOW();

UPDATE public.profiles p
SET role_id = r.id,
    updated_at = NOW()
FROM public.roles r
WHERE r.slug = 'hospital'
  AND EXISTS (
    SELECT 1
    FROM public.hospital_onboarding_requests hor
    WHERE hor.hospital_admin_user_id = p.id
  );

UPDATE auth.users u
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'hospital'),
    raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'hospital'),
    updated_at = NOW()
WHERE EXISTS (
  SELECT 1
  FROM public.hospital_onboarding_requests hor
  WHERE hor.hospital_admin_user_id = u.id
);
