-- The old version trusted the room, role and user the app sent, and compared the role with 'Doctor' while the app sends 'doctor'.
-- So a doctor opening a chat cleared the patient's unread count and never their own, and any signed-in user could mark any room as read.
-- The arguments stay so that installed apps keep working, but only the signed-in user decides what happens.
CREATE OR REPLACE FUNCTION public.mark_room_as_read(target_room_id UUID, user_role TEXT, target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me UUID := auth.uid();
  room RECORD;
BEGIN
  SELECT patient_id, doctor_id INTO room FROM public.chat_rooms WHERE id = target_room_id;
  IF NOT FOUND OR me IS NULL OR me NOT IN (room.patient_id, room.doctor_id) THEN
    RETURN;
  END IF;

  IF me = room.doctor_id THEN
    UPDATE public.chat_rooms SET unread_count_doctor = 0 WHERE id = target_room_id;
  ELSE
    UPDATE public.chat_rooms SET unread_count_patient = 0 WHERE id = target_room_id;
  END IF;

  UPDATE public.chat_messages
  SET is_read = true
  WHERE room_id = target_room_id
    AND sender_id <> me
    AND is_read = false;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_room_as_read(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_room_as_read(UUID, TEXT, UUID) TO authenticated;
