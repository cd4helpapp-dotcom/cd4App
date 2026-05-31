-- Migration: 20260314130000_enable_replica_identity.sql
-- Description: Sets REPLICA IDENTITY FULL to ensure all columns are sent in Realtime changes.

ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.call_sessions REPLICA IDENTITY FULL;
