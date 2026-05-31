-- Dynamic community system with safety moderation, interaction tracking, ads, and RLS.

CREATE TABLE IF NOT EXISTS public.community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  image_url TEXT,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'success_stories', 'challenges', 'mentor_tips')),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending_review', 'hidden', 'rejected')),
  moderation_reason TEXT,
  moderation_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  like_count INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  share_count INTEGER NOT NULL DEFAULT 0 CHECK (share_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.community_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'rejected')),
  moderation_reason TEXT,
  moderation_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.community_post_likes (
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_post_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'native',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.community_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  cta_label TEXT,
  cta_url TEXT,
  placement TEXT NOT NULL DEFAULT 'community_feed',
  frequency_interval INTEGER NOT NULL DEFAULT 4 CHECK (frequency_interval >= 2 AND frequency_interval <= 20),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_community_posts_feed
  ON public.community_posts (is_pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_community_posts_author
  ON public.community_posts (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_posts_status
  ON public.community_posts (status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_community_post_comments_post
  ON public.community_post_comments (post_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_community_post_likes_user
  ON public.community_post_likes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_post_shares_post
  ON public.community_post_shares (post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_ads_active
  ON public.community_ads (active, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.community_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_posts_updated_at ON public.community_posts;
CREATE TRIGGER trg_community_posts_updated_at
BEFORE UPDATE ON public.community_posts
FOR EACH ROW
EXECUTE FUNCTION public.community_set_updated_at();

DROP TRIGGER IF EXISTS trg_community_comments_updated_at ON public.community_post_comments;
CREATE TRIGGER trg_community_comments_updated_at
BEFORE UPDATE ON public.community_post_comments
FOR EACH ROW
EXECUTE FUNCTION public.community_set_updated_at();

DROP TRIGGER IF EXISTS trg_community_ads_updated_at ON public.community_ads;
CREATE TRIGGER trg_community_ads_updated_at
BEFORE UPDATE ON public.community_ads
FOR EACH ROW
EXECUTE FUNCTION public.community_set_updated_at();

CREATE OR REPLACE FUNCTION public.community_contains_blocked_content(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized TEXT := lower(coalesce(p_text, ''));
  keyword TEXT;
  blocked_keywords TEXT[] := ARRAY[
    'porn', 'nude', 'nudes', 'nsfw', 'xxx', 'sex video', 'rape', 'molest',
    'kill', 'murder', 'behead', 'bomb', 'gun', 'shoot', 'self harm', 'suicide'
  ];
BEGIN
  FOREACH keyword IN ARRAY blocked_keywords LOOP
    IF position(keyword IN normalized) > 0 THEN
      RETURN TRUE;
    END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_is_health_related(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized TEXT := lower(coalesce(p_text, ''));
  keyword TEXT;
  health_keywords TEXT[] := ARRAY[
    'health', 'diabetes', 'sugar', 'glucose', 'insulin', 'hba1c',
    'blood pressure', 'bp', 'cholesterol', 'thyroid', 'pcos',
    'diet', 'nutrition', 'exercise', 'walk', 'sleep',
    'report', 'doctor', 'patient', 'medicine', 'medication',
    'wellness', 'weight', 'fitness', 'lab', 'clinic'
  ];
BEGIN
  FOREACH keyword IN ARRAY health_keywords LOOP
    IF position(keyword IN normalized) > 0 THEN
      RETURN TRUE;
    END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_validate_post_content()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  role_slug TEXT := coalesce(public.current_user_role_slug(), 'patient');
BEGIN
  NEW.body := btrim(coalesce(NEW.body, ''));

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
    NEW.status := 'pending_review';
    NEW.moderation_reason := coalesce(NEW.moderation_reason, 'Image post requires moderation review.');
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

  IF public.community_contains_blocked_content(NEW.content) THEN
    RAISE EXCEPTION 'Comment blocked by safety policy.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_posts_validate ON public.community_posts;
CREATE TRIGGER trg_community_posts_validate
BEFORE INSERT OR UPDATE OF body, image_url, status ON public.community_posts
FOR EACH ROW
EXECUTE FUNCTION public.community_validate_post_content();

DROP TRIGGER IF EXISTS trg_community_comments_validate ON public.community_post_comments;
CREATE TRIGGER trg_community_comments_validate
BEFORE INSERT OR UPDATE OF content, status ON public.community_post_comments
FOR EACH ROW
EXECUTE FUNCTION public.community_validate_comment_content();

CREATE OR REPLACE FUNCTION public.community_refresh_post_counts(p_post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.community_posts p
  SET
    like_count = (
      SELECT count(*)::int
      FROM public.community_post_likes l
      WHERE l.post_id = p_post_id
    ),
    comment_count = (
      SELECT count(*)::int
      FROM public.community_post_comments c
      WHERE c.post_id = p_post_id
        AND c.deleted_at IS NULL
        AND c.status = 'published'
    ),
    share_count = (
      SELECT count(*)::int
      FROM public.community_post_shares s
      WHERE s.post_id = p_post_id
    ),
    updated_at = NOW()
  WHERE p.id = p_post_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_likes_count_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.community_refresh_post_counts(coalesce(NEW.post_id, OLD.post_id));
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_comments_count_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.community_refresh_post_counts(coalesce(NEW.post_id, OLD.post_id));
  RETURN coalesce(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.community_shares_count_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.community_refresh_post_counts(coalesce(NEW.post_id, OLD.post_id));
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_community_likes_count ON public.community_post_likes;
CREATE TRIGGER trg_community_likes_count
AFTER INSERT OR DELETE ON public.community_post_likes
FOR EACH ROW
EXECUTE FUNCTION public.community_likes_count_trigger();

DROP TRIGGER IF EXISTS trg_community_comments_count ON public.community_post_comments;
CREATE TRIGGER trg_community_comments_count
AFTER INSERT OR UPDATE OR DELETE ON public.community_post_comments
FOR EACH ROW
EXECUTE FUNCTION public.community_comments_count_trigger();

DROP TRIGGER IF EXISTS trg_community_shares_count ON public.community_post_shares;
CREATE TRIGGER trg_community_shares_count
AFTER INSERT OR DELETE ON public.community_post_shares
FOR EACH ROW
EXECUTE FUNCTION public.community_shares_count_trigger();

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_posts_select_visible" ON public.community_posts;
DROP POLICY IF EXISTS "community_posts_insert_own" ON public.community_posts;
DROP POLICY IF EXISTS "community_posts_update_own_or_admin" ON public.community_posts;

CREATE POLICY "community_posts_select_visible"
ON public.community_posts
FOR SELECT
TO authenticated
USING (
  (
    status = 'published'
    AND deleted_at IS NULL
  )
  OR author_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

CREATE POLICY "community_posts_insert_own"
ON public.community_posts
FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND coalesce(public.current_user_role_slug(), 'patient') IN ('patient', 'doctor', 'admin')
);

CREATE POLICY "community_posts_update_own_or_admin"
ON public.community_posts
FOR UPDATE
TO authenticated
USING (author_id = auth.uid() OR public.current_user_role_slug() = 'admin')
WITH CHECK (author_id = auth.uid() OR public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "community_comments_select_visible" ON public.community_post_comments;
DROP POLICY IF EXISTS "community_comments_insert_own" ON public.community_post_comments;
DROP POLICY IF EXISTS "community_comments_update_own_or_admin" ON public.community_post_comments;

CREATE POLICY "community_comments_select_visible"
ON public.community_post_comments
FOR SELECT
TO authenticated
USING (
  (
    status = 'published'
    AND deleted_at IS NULL
  )
  OR author_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

CREATE POLICY "community_comments_insert_own"
ON public.community_post_comments
FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND coalesce(public.current_user_role_slug(), 'patient') IN ('patient', 'doctor', 'admin')
  AND EXISTS (
    SELECT 1
    FROM public.community_posts p
    WHERE p.id = post_id
      AND p.deleted_at IS NULL
      AND (
        p.status = 'published'
        OR p.author_id = auth.uid()
        OR public.current_user_role_slug() = 'admin'
      )
  )
);

CREATE POLICY "community_comments_update_own_or_admin"
ON public.community_post_comments
FOR UPDATE
TO authenticated
USING (author_id = auth.uid() OR public.current_user_role_slug() = 'admin')
WITH CHECK (author_id = auth.uid() OR public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "community_likes_select_own_or_admin" ON public.community_post_likes;
DROP POLICY IF EXISTS "community_likes_insert_own" ON public.community_post_likes;
DROP POLICY IF EXISTS "community_likes_delete_own_or_admin" ON public.community_post_likes;

CREATE POLICY "community_likes_select_own_or_admin"
ON public.community_post_likes
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.current_user_role_slug() = 'admin');

CREATE POLICY "community_likes_insert_own"
ON public.community_post_likes
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.community_posts p
    WHERE p.id = post_id
      AND p.status = 'published'
      AND p.deleted_at IS NULL
  )
);

CREATE POLICY "community_likes_delete_own_or_admin"
ON public.community_post_likes
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "community_shares_select_own_or_admin" ON public.community_post_shares;
DROP POLICY IF EXISTS "community_shares_insert_own" ON public.community_post_shares;
DROP POLICY IF EXISTS "community_shares_delete_own_or_admin" ON public.community_post_shares;

CREATE POLICY "community_shares_select_own_or_admin"
ON public.community_post_shares
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.current_user_role_slug() = 'admin');

CREATE POLICY "community_shares_insert_own"
ON public.community_post_shares
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.community_posts p
    WHERE p.id = post_id
      AND p.status = 'published'
      AND p.deleted_at IS NULL
  )
);

CREATE POLICY "community_shares_delete_own_or_admin"
ON public.community_post_shares
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "community_ads_select_active" ON public.community_ads;
DROP POLICY IF EXISTS "community_ads_insert_admin" ON public.community_ads;
DROP POLICY IF EXISTS "community_ads_update_admin" ON public.community_ads;
DROP POLICY IF EXISTS "community_ads_delete_admin" ON public.community_ads;

CREATE POLICY "community_ads_select_active"
ON public.community_ads
FOR SELECT
TO authenticated
USING (
  active = TRUE
  AND deleted_at IS NULL
  AND (starts_at IS NULL OR starts_at <= NOW())
  AND (ends_at IS NULL OR ends_at >= NOW())
);

CREATE POLICY "community_ads_insert_admin"
ON public.community_ads
FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role_slug() = 'admin');

CREATE POLICY "community_ads_update_admin"
ON public.community_ads
FOR UPDATE
TO authenticated
USING (public.current_user_role_slug() = 'admin')
WITH CHECK (public.current_user_role_slug() = 'admin');

CREATE POLICY "community_ads_delete_admin"
ON public.community_ads
FOR DELETE
TO authenticated
USING (public.current_user_role_slug() = 'admin');
