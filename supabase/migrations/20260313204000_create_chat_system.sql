-- Migration: 20260313204000_create_chat_system.sql
-- Description: Sets up the tables and RLS for real-time persistent chat.

-- 1. Create chat_rooms table
CREATE TABLE IF NOT EXISTS public.chat_rooms (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(patient_id, doctor_id)
);

-- 1.1 Add push_token to profiles if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'push_token'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN push_token TEXT;
    END IF;
END $$;

-- 2. Create chat_messages table
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    attachment_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 4. Chat Rooms Policies
DROP POLICY IF EXISTS "Users can see their own rooms" ON public.chat_rooms;
CREATE POLICY "Users can see their own rooms" ON public.chat_rooms
    FOR SELECT USING (
        auth.uid() = patient_id OR auth.uid() = doctor_id
    );

-- 5. Chat Messages Policies
DROP POLICY IF EXISTS "Users can see messages in their rooms" ON public.chat_messages;
CREATE POLICY "Users can see messages in their rooms" ON public.chat_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.chat_rooms
            WHERE id = chat_messages.room_id
            AND (auth.uid() = patient_id OR auth.uid() = doctor_id)
        )
    );

DROP POLICY IF EXISTS "Participants can insert messages" ON public.chat_messages;
CREATE POLICY "Participants can insert messages" ON public.chat_messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.chat_rooms
            WHERE id = chat_messages.room_id
            AND (auth.uid() = patient_id OR auth.uid() = doctor_id)
        )
        AND auth.uid() = sender_id
    );

-- 6. Trigger to update last_message_at
CREATE OR REPLACE FUNCTION public.update_room_last_message_time()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.chat_rooms
    SET last_message_at = NOW()
    WHERE id = NEW.room_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_message_inserted ON public.chat_messages;
CREATE TRIGGER on_message_inserted
    AFTER INSERT ON public.chat_messages
    FOR EACH ROW EXECUTE PROCEDURE public.update_room_last_message_time();

-- 7. Enable Realtime
-- Make sure the publication 'supabase_realtime' exists
-- and add the table to it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- 8. Create call_sessions table (for signalling)
CREATE TABLE IF NOT EXISTS public.call_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
    caller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('audio', 'video')),
    status TEXT DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended', 'missed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see calls for their rooms" ON public.call_sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.chat_rooms
            WHERE id = call_sessions.room_id
            AND (auth.uid() = patient_id OR auth.uid() = doctor_id)
        )
    );

CREATE POLICY "Participants can manage calls" ON public.call_sessions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.chat_rooms
            WHERE id = call_sessions.room_id
            AND (auth.uid() = patient_id OR auth.uid() = doctor_id)
        )
    );

-- 9. Add call_sessions to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;

-- 10. Storage Setup for Chat Attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
CREATE POLICY "Anyone can view chat attachments" ON storage.objects
    FOR SELECT USING (bucket_id = 'chat-attachments');

CREATE POLICY "Authenticated users can upload" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'chat-attachments' 
        AND auth.role() = 'authenticated'
    );

-- 6. Add indices for faster lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON public.chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_patient_id ON public.chat_rooms(patient_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_doctor_id ON public.chat_rooms(doctor_id);
