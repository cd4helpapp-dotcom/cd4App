-- Migration: 20260313210000_add_agora_token.sql
-- Description: Adds agora_token column to call_sessions for secure A/V calls.

ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS agora_token TEXT;
