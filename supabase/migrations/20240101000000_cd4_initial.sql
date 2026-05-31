-- CD4 Consolidated Initial Schema
-- This file merges all previous migrations into a single, clean state.

-- 1. Create Custom Types & Enums
CREATE TYPE gender_enum AS ENUM ('Male', 'Female', 'Other');
CREATE TYPE profile_visibility_enum AS ENUM ('public', 'private', 'doctors_only');
CREATE TYPE appointment_status_enum AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');

-- 2. Roles Table
CREATE TABLE public.roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    permissions TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Profiles Table (1:1 with auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number TEXT UNIQUE,
    age INTEGER CHECK (age >= 1 AND age <= 120),
    gender gender_enum,
    address TEXT,
    weight NUMERIC CHECK (weight >= 1 AND weight <= 500),
    blood_pressure TEXT,
    pulse INTEGER CHECK (pulse >= 20 AND pulse <= 250),
    profile_picture TEXT,
    profile_setup_completed BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    role_id UUID REFERENCES public.roles(id),
    settings JSONB DEFAULT '{
      "notifications": {"push": true, "email": true, "sms": false, "marketing": false},
      "privacy": {"profileVisibility": "public"},
      "language": "English"
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Doctors Table
CREATE TABLE public.doctors (
    id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    city TEXT NOT NULL,
    specialization TEXT NOT NULL,
    experience TEXT NOT NULL,
    fee TEXT NOT NULL,
    bio TEXT,
    rating NUMERIC DEFAULT 5.0,
    registration_number TEXT UNIQUE NOT NULL,
    kyc_verify BOOLEAN DEFAULT FALSE,
    documents TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Slots Table
CREATE TABLE public.slots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_booked BOOLEAN DEFAULT FALSE,
    appointment_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Appointments Table
CREATE TABLE public.appointments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
    status appointment_status_enum DEFAULT 'pending',
    notes TEXT,
    meet_link TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add cyclic dependency resolution for slot.appointment_id
ALTER TABLE public.slots ADD CONSTRAINT slots_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;

-- 7. Insert Default Roles
INSERT INTO public.roles (name, slug, description) VALUES
  ('Admin', 'admin', 'System Administrator'),
  ('Doctor', 'doctor', 'Medical Professional'),
  ('Patient', 'patient', 'Regular User'),
  ('Marketing', 'marketing', 'Marketing User')
ON CONFLICT (slug) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- 8. Enhanced Role Assignment Trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  target_role_slug TEXT;
  target_role_id UUID;
BEGIN
  -- Identify Target Role
  IF new.email IN ('admin@cd4.app', 'nitesh@cd4.app', 'kaushiknitesh143@gmail.com') THEN
    target_role_slug := 'admin';
  ELSE
    target_role_slug := COALESCE(new.raw_user_meta_data->>'role', 'patient');
  END IF;

  -- Fetch Role ID
  SELECT id INTO target_role_id FROM public.roles WHERE slug = target_role_slug LIMIT 1;
  
  -- Fallback to patient if role not found
  IF target_role_id IS NULL THEN
    SELECT id INTO target_role_id FROM public.roles WHERE slug = 'patient' LIMIT 1;
  END IF;

  -- Create Profile
  INSERT INTO public.profiles (id, first_name, last_name, email, phone_number, role_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'first_name', 'User'),
    COALESCE(new.raw_user_meta_data->>'last_name', ''),
    new.email,
    new.phone,
    target_role_id
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 9. Row Level Security Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view doctors" ON public.doctors FOR SELECT USING (true);
CREATE POLICY "Doctors can update their own info" ON public.doctors FOR UPDATE USING (auth.uid() = id);

-- 10. Storage Setup
-- We use a single bucket for consistency
INSERT INTO storage.buckets (id, name, public)
VALUES ('cd4-storage', 'cd4-storage', true)
ON CONFLICT (id) DO NOTHING;

-- Policies for cd4-storage
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Uploads" ON storage.objects;

CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'cd4-storage');
CREATE POLICY "Authenticated Uploads" ON storage.objects FOR INSERT WITH CHECK (
    bucket_id = 'cd4-storage' AND auth.role() = 'authenticated'
);
