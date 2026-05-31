-- Migration: 20260314120000_add_chat_rooms_insert_policy.sql
-- Description: Adds missing INSERT policy for chat_rooms table.

DROP POLICY IF EXISTS "Users can create their own rooms" ON public.chat_rooms;
CREATE POLICY "Users can create their own rooms" ON public.chat_rooms
    FOR INSERT WITH CHECK (
        auth.uid() = patient_id OR auth.uid() = doctor_id
    );
