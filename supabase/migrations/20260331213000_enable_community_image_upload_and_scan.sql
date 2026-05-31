-- Enable community image uploads with safety scan metadata gate.

INSERT INTO storage.buckets (id, name, public)
VALUES ('community-posts', 'community-posts', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Community post media read" ON storage.objects;
DROP POLICY IF EXISTS "Community post media insert own folder" ON storage.objects;
DROP POLICY IF EXISTS "Community post media update own folder" ON storage.objects;
DROP POLICY IF EXISTS "Community post media delete own folder" ON storage.objects;

CREATE POLICY "Community post media read"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'community-posts');

CREATE POLICY "Community post media insert own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'community-posts'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Community post media update own folder"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'community-posts'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'community-posts'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Community post media delete own folder"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'community-posts'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE OR REPLACE FUNCTION public.community_validate_post_content()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  role_slug TEXT := coalesce(public.current_user_role_slug(), 'patient');
  image_scan_status TEXT := lower(coalesce(NEW.moderation_meta->>'image_scan_status', ''));
BEGIN
  NEW.body := btrim(coalesce(NEW.body, ''));
  NEW.moderation_meta := coalesce(NEW.moderation_meta, '{}'::jsonb);

  IF char_length(NEW.body) < 8 THEN
    RAISE EXCEPTION 'Post is too short.';
  END IF;

  IF char_length(NEW.body) > 1800 THEN
    RAISE EXCEPTION 'Post is too long.';
  END IF;

  IF public.community_contains_blocked_content(NEW.body) THEN
    RAISE EXCEPTION 'Post blocked by safety policy.';
  END IF;

  IF role_slug <> 'admin' AND NOT public.community_is_health_related(NEW.body) THEN
    RAISE EXCEPTION 'Please keep posts health related.';
  END IF;

  IF role_slug <> 'admin' AND coalesce(NEW.image_url, '') <> '' AND NEW.status = 'published' THEN
    IF image_scan_status <> 'approved' THEN
      NEW.status := 'pending_review';
      NEW.moderation_reason := coalesce(NEW.moderation_reason, 'Image post requires moderation review.');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'community_post_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_post_comments;
  END IF;
END;
$$;
