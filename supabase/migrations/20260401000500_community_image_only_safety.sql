-- Community policy update:
-- Keep text posts/comments open (length-only checks) and rely on image AI scan for adult/nudity/graphic blocks.

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

  IF role_slug <> 'admin' AND coalesce(NEW.image_url, '') <> '' AND NEW.status = 'published' THEN
    IF image_scan_status <> 'approved' THEN
      NEW.status := 'pending_review';
      NEW.moderation_reason := coalesce(NEW.moderation_reason, 'Image post requires moderation review.');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_validate_comment_content()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.content := btrim(coalesce(NEW.content, ''));

  IF char_length(NEW.content) < 2 THEN
    RAISE EXCEPTION 'Comment is too short.';
  END IF;

  IF char_length(NEW.content) > 500 THEN
    RAISE EXCEPTION 'Comment is too long.';
  END IF;

  RETURN NEW;
END;
$$;
