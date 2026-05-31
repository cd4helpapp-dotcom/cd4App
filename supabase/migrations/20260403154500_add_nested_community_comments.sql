-- Add parent_id to support nested/threaded comments in the community section.
-- This allows comments to reference a parent comment, enabling Instagram-style threads.

ALTER TABLE IF EXISTS public.community_post_comments 
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.community_post_comments(id) ON DELETE SET NULL;

-- Create an index for faster lookups of nested replies.
CREATE INDEX IF NOT EXISTS idx_community_post_comments_parent_id 
ON public.community_post_comments(parent_id);

-- Ensure replica identity is full to support detailed realtime payloads if needed.
ALTER TABLE public.community_post_comments REPLICA IDENTITY FULL;

COMMENT ON COLUMN public.community_post_comments.parent_id IS 'References the comment being replied to, enabling threaded conversations.';
