-- Migration: 20260314190000_add_reply_to_chat.sql
-- Description: Adds reply_to_id column for message quoting.

ALTER TABLE public.chat_messages
ADD COLUMN reply_to_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL;
