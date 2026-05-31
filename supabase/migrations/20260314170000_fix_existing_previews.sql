-- Migration: 20260314170000_fix_existing_previews.sql
-- Description: Backfills last_message_text and unread counts for existing rooms.

-- 1. Backfill last_message_text
UPDATE public.chat_rooms cr
SET last_message_text = (
    SELECT 
        CASE 
            WHEN m.type = 'image' THEN '📷 Photo'
            WHEN m.type = 'file' THEN '📄 File'
            ELSE m.text 
        END
    FROM public.chat_messages m
    WHERE m.room_id = cr.id
    ORDER BY m.created_at DESC
    LIMIT 1
)
WHERE last_message_text IS NULL;

-- 2. Ensure chat_rooms is in realtime publication (repeating just in case)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'chat_rooms'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;
    END IF;
END $$;
