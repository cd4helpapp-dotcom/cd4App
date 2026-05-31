-- Migration: 20260314200000_update_mark_as_read_for_ticks.sql
-- Description: Updates mark_room_as_read RPC to also mark individual messages as read and bypass RLS.

-- Drop the old function first if signature changes
DROP FUNCTION IF EXISTS public.mark_room_as_read(UUID, TEXT);

-- Create the new function with user_id parameter and SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.mark_room_as_read(target_room_id UUID, user_role TEXT, target_user_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Clear room unread counts
    IF user_role = 'Doctor' THEN
        UPDATE public.chat_rooms 
        SET unread_count_doctor = 0 
        WHERE id = target_room_id;
    ELSE
        UPDATE public.chat_rooms 
        SET unread_count_patient = 0 
        WHERE id = target_room_id;
    END IF;

    -- Mark individual messages as read (only those sent by the OTHER party)
    UPDATE public.chat_messages
    SET is_read = true
    WHERE room_id = target_room_id 
      AND sender_id != target_user_id
      AND is_read = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
