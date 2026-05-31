-- Migration: 20260314150000_add_presence_columns.sql
-- Description: Adds last_seen_at column and update function for presence tracking.

-- 1. Add last_seen_at to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Add last_seen_at to doctors
ALTER TABLE public.doctors 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Create function to update last seen
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS VOID AS $$
BEGIN
    -- Update profiles if the user is a patient
    UPDATE public.profiles
    SET last_seen_at = NOW()
    WHERE id = auth.uid();

    -- Update doctors if the user is a doctor
    UPDATE public.doctors
    SET last_seen_at = NOW()
    WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
