-- Community privacy, quality controls, throttling, and ad analytics.

UPDATE storage.buckets
SET public = false
WHERE id = 'community-posts';

DROP POLICY IF EXISTS "Community post media read" ON storage.objects;
DROP POLICY IF EXISTS "Community post media insert own folder" ON storage.objects;
DROP POLICY IF EXISTS "Community post media update own folder" ON storage.objects;
DROP POLICY IF EXISTS "Community post media delete own folder" ON storage.objects;

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
      WHERE p.image_url = storage.objects.name
        AND p.deleted_at IS NULL
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
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.current_user_role_slug() = 'admin'
  )
);

CREATE TABLE IF NOT EXISTS public.community_post_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'other',
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_community_post_reports_status_created
  ON public.community_post_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_user_blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_user_id),
  CHECK (blocker_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_user_blocks_blocked
  ON public.community_user_blocks(blocked_user_id);

CREATE TABLE IF NOT EXISTS public.community_muted_keywords (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_community_muted_keywords_user
  ON public.community_muted_keywords(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_ad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id UUID NOT NULL REFERENCES public.community_ads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click')),
  source TEXT NOT NULL DEFAULT 'community_feed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_minute_bucket BIGINT NOT NULL DEFAULT (floor(extract(epoch from NOW()) / 60)::bigint)
);

ALTER TABLE public.community_ad_events
  ADD COLUMN IF NOT EXISTS created_minute_bucket BIGINT;

CREATE INDEX IF NOT EXISTS idx_community_ad_events_ad_created
  ON public.community_ad_events(ad_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_ad_events_type_created
  ON public.community_ad_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_ad_events_user_created
  ON public.community_ad_events(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.community_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_set_ad_event_minute_bucket()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_minute_bucket := floor(extract(epoch from coalesce(NEW.created_at, NOW())) / 60)::bigint;
  RETURN NEW;
END;
$$;

UPDATE public.community_ad_events
SET created_minute_bucket = floor(extract(epoch from created_at) / 60)::bigint
WHERE created_minute_bucket IS NULL;

ALTER TABLE public.community_ad_events
  ALTER COLUMN created_minute_bucket SET NOT NULL;

DROP TRIGGER IF EXISTS trg_community_ad_events_minute_bucket ON public.community_ad_events;
CREATE TRIGGER trg_community_ad_events_minute_bucket
BEFORE INSERT OR UPDATE OF created_at ON public.community_ad_events
FOR EACH ROW
EXECUTE FUNCTION public.community_set_ad_event_minute_bucket();

DELETE FROM public.community_ad_events newer
USING public.community_ad_events older
WHERE newer.event_type = 'impression'
  AND older.event_type = 'impression'
  AND newer.ad_id = older.ad_id
  AND newer.user_id = older.user_id
  AND newer.source = older.source
  AND newer.created_minute_bucket = older.created_minute_bucket
  AND (
    newer.created_at > older.created_at
    OR (newer.created_at = older.created_at AND newer.id::text > older.id::text)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_ad_events_impression_dedupe
  ON public.community_ad_events(ad_id, user_id, source, created_minute_bucket)
  WHERE event_type = 'impression';

DROP TRIGGER IF EXISTS trg_community_post_reports_updated_at ON public.community_post_reports;
CREATE TRIGGER trg_community_post_reports_updated_at
BEFORE UPDATE ON public.community_post_reports
FOR EACH ROW
EXECUTE FUNCTION public.community_set_updated_at();

CREATE OR REPLACE FUNCTION public.community_enforce_post_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  role_slug TEXT := coalesce(public.current_user_role_slug(), 'patient');
  recent_count INTEGER;
BEGIN
  IF role_slug = 'admin' THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::int
  INTO recent_count
  FROM public.community_posts
  WHERE author_id = NEW.author_id
    AND deleted_at IS NULL
    AND created_at >= NOW() - INTERVAL '5 minutes';

  IF recent_count >= 6 THEN
    RAISE EXCEPTION 'You are posting too fast. Please wait 5 minutes before posting again.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_posts
    WHERE author_id = NEW.author_id
      AND deleted_at IS NULL
      AND lower(btrim(body)) = lower(btrim(NEW.body))
      AND created_at >= NOW() - INTERVAL '24 hours'
  ) THEN
    RAISE EXCEPTION 'Duplicate post detected. Please post a fresh update.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_posts_rate_limit ON public.community_posts;
CREATE TRIGGER trg_community_posts_rate_limit
BEFORE INSERT ON public.community_posts
FOR EACH ROW
EXECUTE FUNCTION public.community_enforce_post_rate_limit();

ALTER TABLE public.community_post_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_muted_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_ad_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_reports_select" ON public.community_post_reports;
DROP POLICY IF EXISTS "community_reports_insert_own" ON public.community_post_reports;
DROP POLICY IF EXISTS "community_reports_update_admin" ON public.community_post_reports;

CREATE POLICY "community_reports_select"
ON public.community_post_reports
FOR SELECT
TO authenticated
USING (reporter_id = auth.uid() OR public.current_user_role_slug() = 'admin');

CREATE POLICY "community_reports_insert_own"
ON public.community_post_reports
FOR INSERT
TO authenticated
WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "community_reports_update_admin"
ON public.community_post_reports
FOR UPDATE
TO authenticated
USING (public.current_user_role_slug() = 'admin')
WITH CHECK (public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "community_blocks_select_own" ON public.community_user_blocks;
DROP POLICY IF EXISTS "community_blocks_insert_own" ON public.community_user_blocks;
DROP POLICY IF EXISTS "community_blocks_delete_own" ON public.community_user_blocks;

CREATE POLICY "community_blocks_select_own"
ON public.community_user_blocks
FOR SELECT
TO authenticated
USING (blocker_id = auth.uid() OR public.current_user_role_slug() = 'admin');

CREATE POLICY "community_blocks_insert_own"
ON public.community_user_blocks
FOR INSERT
TO authenticated
WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "community_blocks_delete_own"
ON public.community_user_blocks
FOR DELETE
TO authenticated
USING (blocker_id = auth.uid() OR public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "community_muted_keywords_select_own" ON public.community_muted_keywords;
DROP POLICY IF EXISTS "community_muted_keywords_insert_own" ON public.community_muted_keywords;
DROP POLICY IF EXISTS "community_muted_keywords_delete_own" ON public.community_muted_keywords;

CREATE POLICY "community_muted_keywords_select_own"
ON public.community_muted_keywords
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.current_user_role_slug() = 'admin');

CREATE POLICY "community_muted_keywords_insert_own"
ON public.community_muted_keywords
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "community_muted_keywords_delete_own"
ON public.community_muted_keywords
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "community_ad_events_select_admin" ON public.community_ad_events;
DROP POLICY IF EXISTS "community_ad_events_insert_own" ON public.community_ad_events;

CREATE POLICY "community_ad_events_select_admin"
ON public.community_ad_events
FOR SELECT
TO authenticated
USING (public.current_user_role_slug() = 'admin');

CREATE POLICY "community_ad_events_insert_own"
ON public.community_ad_events
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());
