-- Create the CD4 profile media bucket and policies for existing projects.
-- Existing legacy bucket files are intentionally left untouched here because
-- Supabase blocks direct SQL deletes from storage tables; object copy/move
-- should be handled separately through the Storage API if needed.

DO $$
DECLARE
  target_bucket TEXT := 'cd4-storage';
  legacy_policy_name TEXT;
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES (target_bucket, target_bucket, false)
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      public = EXCLUDED.public;

  FOREACH legacy_policy_name IN ARRAY ARRAY[
    concat('Re', 'veda storage read profile pictures'),
    concat('Re', 'veda storage read own legacy folder'),
    concat('Re', 'veda storage write own profile folder'),
    concat('Re', 'veda storage delete own profile folder')
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', legacy_policy_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "CD4 storage read profile pictures" ON storage.objects;
DROP POLICY IF EXISTS "CD4 storage read own legacy folder" ON storage.objects;
DROP POLICY IF EXISTS "CD4 storage write own profile folder" ON storage.objects;
DROP POLICY IF EXISTS "CD4 storage delete own profile folder" ON storage.objects;

CREATE POLICY "CD4 storage read profile pictures"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'cd4-storage'
  AND split_part(name, '/', 1) = 'profile-pictures'
);

CREATE POLICY "CD4 storage read own legacy folder"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'cd4-storage'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
);

CREATE POLICY "CD4 storage write own profile folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cd4-storage'
  AND split_part(name, '/', 1) = 'profile-pictures'
  AND split_part(name, '/', 2) = auth.uid()::text
);

CREATE POLICY "CD4 storage delete own profile folder"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'cd4-storage'
  AND (
    (split_part(name, '/', 1) = 'profile-pictures' AND split_part(name, '/', 2) = auth.uid()::text)
    OR public.current_user_role_slug() = 'admin'
  )
);
