-- Migration: 20260314180000_fix_chat_room_trigger_security.sql
-- Description: Sets SECURITY DEFINER on the room update trigger to bypass RLS.

-- 1. Replace the function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.update_room_on_message()
RETURNS TRIGGER AS $$
DECLARE
    is_sender_patient BOOLEAN;
BEGIN
    SELECT (patient_id = NEW.sender_id) INTO is_sender_patient
    FROM public.chat_rooms
    WHERE id = NEW.room_id;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Ensure backfill was completely executed for any missed rows
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
WHERE cr.last_message_text IS NULL OR cr.last_message_text = '';
