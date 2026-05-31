-- Migration: 20260315093000_fix_call_status_constraint.sql
-- Description: Updates the status check constraint for call_sessions to include 'declined'.

ALTER TABLE public.call_sessions DROP CONSTRAINT IF EXISTS call_sessions_status_check;

ALTER TABLE public.call_sessions ADD CONSTRAINT call_sessions_status_check 
    CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined'));
