-- Migration: 20260314140000_whatsapp_style_updates.sql
-- Description: Adds unread counts and last message text to chat_rooms with triggers.

-- 1. Add columns to chat_rooms
ALTER TABLE public.chat_rooms 
ADD COLUMN IF NOT EXISTS last_message_text TEXT,
ADD COLUMN IF NOT EXISTS unread_count_patient INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS unread_count_doctor INT DEFAULT 0;

-- 2. Update the room update function to handle text and unread counts
CREATE OR REPLACE FUNCTION public.update_room_on_message()
RETURNS TRIGGER AS $$
DECLARE
    is_sender_patient BOOLEAN;
BEGIN
    -- Get sender role (we assume sender_id is in profiles)
    -- We can check if sender_id matches patient_id in chat_rooms
    SELECT (patient_id = NEW.sender_id) INTO is_sender_patient
    FROM public.chat_rooms
    WHERE id = NEW.room_id;

    -- Update room metadata
    UPDATE public.chat_rooms
    SET 
        last_message_at = NOW(),
        last_message_text = CASE 
            WHEN NEW.type = 'image' THEN '📷 Photo'
            WHEN NEW.type = 'file' THEN '📄 File'
            ELSE NEW.text 
        END,
        unread_count_doctor = CASE 
            WHEN is_sender_patient THEN unread_count_doctor + 1 
            ELSE unread_count_doctor 
        END,
        unread_count_patient = CASE 
            WHEN NOT is_sender_patient THEN unread_count_patient + 1 
            ELSE unread_count_patient 
        END
    WHERE id = NEW.room_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Replace the old trigger with the new one
DROP TRIGGER IF EXISTS on_message_inserted ON public.chat_messages;
CREATE TRIGGER on_message_inserted
    AFTER INSERT ON public.chat_messages
    FOR EACH ROW EXECUTE PROCEDURE public.update_room_on_message();

-- 4. RPC to mark room as read
CREATE OR REPLACE FUNCTION public.mark_room_as_read(target_room_id UUID, user_role TEXT)
RETURNS VOID AS $$
BEGIN
    IF user_role = 'Doctor' THEN
        UPDATE public.chat_rooms 
        SET unread_count_doctor = 0 
        WHERE id = target_room_id;
    ELSE
        UPDATE public.chat_rooms 
        SET unread_count_patient = 0 
        WHERE id = target_room_id;
    END IF;
END;
$$ LANGUAGE plpgsql;
