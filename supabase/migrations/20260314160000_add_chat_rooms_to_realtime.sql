-- Migration: 20260314160000_add_chat_rooms_to_realtime.sql
-- Description: Adds chat_rooms to the realtime publication.

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;
