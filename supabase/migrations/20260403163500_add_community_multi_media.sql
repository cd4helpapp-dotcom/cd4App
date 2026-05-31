-- Add media JSONB column to community_posts to support multiple photos and videos (Instagram style)
ALTER TABLE public.community_posts
ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Update RLS policies to allow reading media column
-- (Existing policies on community_posts already allow SELECT for published or own posts)

COMMENT ON COLUMN public.community_posts.media IS 'Array of assets: [{ "url": "...", "type": "image" | "video", "thumbnail": "..." }]';
