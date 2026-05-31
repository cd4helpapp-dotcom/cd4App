-- Secure chat attachment storage:
-- 1) make bucket private (no anonymous public URL access)
-- 2) allow only chat participants to read/upload objects for their room prefix

UPDATE storage.buckets
SET public = false
WHERE id = 'chat-attachments';

DROP POLICY IF EXISTS "Anyone can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Chat participants can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Chat participants can upload chat attachments" ON storage.objects;

CREATE POLICY "Chat participants can view chat attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'chat-attachments'
    AND split_part(name, '/', 1) <> ''
    AND EXISTS (
        SELECT 1
        FROM public.chat_rooms room
        WHERE room.id::text = split_part(name, '/', 1)
          AND (room.patient_id = auth.uid() OR room.doctor_id = auth.uid())
    )
);

CREATE POLICY "Chat participants can upload chat attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'chat-attachments'
    AND split_part(name, '/', 1) <> ''
    AND EXISTS (
        SELECT 1
        FROM public.chat_rooms room
        WHERE room.id::text = split_part(name, '/', 1)
          AND (room.patient_id = auth.uid() OR room.doctor_id = auth.uid())
    )
);
