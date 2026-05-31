-- Temporary policy: publish community image posts immediately even if scan service is unavailable.
-- Adult/nudity/graphic images are still blocked when scanner returns an explicit block decision.

CREATE OR REPLACE FUNCTION public.community_validate_post_content()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.body := btrim(coalesce(NEW.body, ''));
  NEW.moderation_meta := coalesce(NEW.moderation_meta, '{}'::jsonb);

  IF char_length(NEW.body) < 8 THEN
    RAISE EXCEPTION 'Post is too short.';
  END IF;

  IF char_length(NEW.body) > 1800 THEN
    RAISE EXCEPTION 'Post is too long.';
  END IF;

  -- Intentionally no auto-downgrade to pending_review for image posts.
  -- Upload flow can still set status explicitly when needed.
  RETURN NEW;
END;
$$;
