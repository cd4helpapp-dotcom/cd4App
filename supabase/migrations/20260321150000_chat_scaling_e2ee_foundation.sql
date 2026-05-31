-- Migration: 20260321150000_chat_scaling_e2ee_foundation.sql
-- Description: Improves chat scalability and adds E2EE-ready message storage fields.

-- 1) Public key storage on profiles (for one-to-one key exchange)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS chat_public_key TEXT;

-- Allow chat participants to read each other's profile row (including chat_public_key)
DROP POLICY IF EXISTS "Profiles chat participant select" ON public.profiles;
CREATE POLICY "Profiles chat participant select"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = id
  OR EXISTS (
    SELECT 1
    FROM public.chat_rooms cr
    WHERE (cr.patient_id = auth.uid() AND cr.doctor_id = profiles.id)
       OR (cr.doctor_id = auth.uid() AND cr.patient_id = profiles.id)
  )
);

-- 2) E2EE fields on chat_messages
ALTER TABLE public.chat_messages
ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS encrypted_payload TEXT,
ADD COLUMN IF NOT EXISTS encryption_version SMALLINT;

ALTER TABLE public.chat_messages
DROP CONSTRAINT IF EXISTS chat_messages_encrypted_payload_check;

ALTER TABLE public.chat_messages
ADD CONSTRAINT chat_messages_encrypted_payload_check
CHECK (
  is_encrypted = FALSE
  OR (is_encrypted = TRUE AND type = 'text' AND encrypted_payload IS NOT NULL)
);

-- 3) Scaling indexes for large-volume rooms (100k+ messages)
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created_desc
  ON public.chat_messages (room_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_unread_created_desc
  ON public.chat_messages (room_id, created_at DESC)
  WHERE is_read = FALSE;

-- 4) Keep room preview safe when messages are encrypted
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
            WHEN COALESCE(NEW.is_encrypted, FALSE) THEN 'Encrypted message'
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
