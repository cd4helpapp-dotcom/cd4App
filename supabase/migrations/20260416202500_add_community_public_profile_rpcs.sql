-- Community-safe profile access helpers.
-- These RPCs expose only public identity fields for community UX
-- without opening full profiles table reads.

CREATE OR REPLACE FUNCTION public.community_get_public_profiles(p_user_ids UUID[])
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  profile_picture TEXT,
  is_verified BOOLEAN,
  role_slug TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.first_name,
    p.last_name,
    p.profile_picture,
    COALESCE(p.is_verified, FALSE) AS is_verified,
    COALESCE(r.slug, 'patient') AS role_slug
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]));
$$;

CREATE OR REPLACE FUNCTION public.community_get_post_likers(p_post_id UUID)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  profile_picture TEXT,
  is_verified BOOLEAN,
  role_slug TEXT,
  liked_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.first_name,
    p.last_name,
    p.profile_picture,
    COALESCE(p.is_verified, FALSE) AS is_verified,
    COALESCE(r.slug, 'patient') AS role_slug,
    l.created_at AS liked_at
  FROM public.community_post_likes l
  JOIN public.community_posts cp ON cp.id = l.post_id
  JOIN public.profiles p ON p.id = l.user_id
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE l.post_id = p_post_id
    AND cp.deleted_at IS NULL
    AND (
      (cp.status = 'published')
      OR cp.author_id = auth.uid()
      OR public.current_user_role_slug() = 'admin'
    )
  ORDER BY l.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.community_get_public_profiles(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_get_post_likers(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.community_get_public_profiles(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_get_post_likers(UUID) TO authenticated;

