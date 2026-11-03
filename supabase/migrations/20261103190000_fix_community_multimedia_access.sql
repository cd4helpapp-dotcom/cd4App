-- Complete the multi-image community flow: every stored media item is readable
-- to viewers of its published post, while unpublished content stays private.

DROP POLICY IF EXISTS "Community post media read" ON storage.objects;

CREATE POLICY "Community post media read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'community-posts'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.current_user_role_slug() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.community_posts p
      WHERE p.deleted_at IS NULL
        AND (
          p.image_url = storage.objects.name
          OR coalesce(p.media, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('url', storage.objects.name))
        )
        AND (
          p.status = 'published'
          OR p.author_id = auth.uid()
          OR public.current_user_role_slug() = 'admin'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.community_ads a
      WHERE a.image_url = storage.objects.name
        AND a.deleted_at IS NULL
        AND a.active = TRUE
        AND (a.starts_at IS NULL OR a.starts_at <= NOW())
        AND (a.ends_at IS NULL OR a.ends_at >= NOW())
    )
  )
);

-- Captions are optional when one or more images are attached. Empty posts are
-- still rejected, and text-only posts retain the original eight-character rule.
CREATE OR REPLACE FUNCTION public.community_validate_post_content()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  has_media BOOLEAN;
BEGIN
  NEW.body := btrim(coalesce(NEW.body, ''));
  NEW.moderation_meta := coalesce(NEW.moderation_meta, '{}'::jsonb);
  has_media := coalesce(NEW.image_url, '') <> '' OR jsonb_array_length(coalesce(NEW.media, '[]'::jsonb)) > 0;

  IF char_length(NEW.body) < 8 AND NOT has_media THEN
    RAISE EXCEPTION 'Please write at least 8 characters or attach an image.';
  END IF;

  IF char_length(NEW.body) > 1800 THEN
    RAISE EXCEPTION 'Post is too long.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(NEW.media, '[]'::jsonb)) AS item
    WHERE coalesce(item->>'type', 'image') <> 'image'
  ) THEN
    RAISE EXCEPTION 'Only image media is supported for community posts.';
  END IF;

  RETURN NEW;
END;
$$;

-- A reply must belong to the same post as its parent. A plain foreign key on
-- parent_id cannot enforce that relationship by itself.
CREATE OR REPLACE FUNCTION public.community_validate_comment_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.community_post_comments parent_comment
    WHERE parent_comment.id = NEW.parent_id
      AND parent_comment.post_id = NEW.post_id
  ) THEN
    RAISE EXCEPTION 'A reply must reference a comment on the same post.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_comments_validate_parent ON public.community_post_comments;
CREATE TRIGGER trg_community_comments_validate_parent
BEFORE INSERT OR UPDATE OF post_id, parent_id ON public.community_post_comments
FOR EACH ROW
EXECUTE FUNCTION public.community_validate_comment_parent();
