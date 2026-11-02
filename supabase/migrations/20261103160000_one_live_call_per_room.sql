-- A room can have one live call. Without this, a double tap or both people calling at once made two ringing rows,
-- and each phone then followed whichever row it heard about last.

-- Calls left open by a phone that crashed or lost its connection.
UPDATE public.call_sessions SET status = 'missed'
WHERE status = 'ringing' AND created_at < now() - interval '2 minutes';

UPDATE public.call_sessions SET status = 'ended', ended_at = now()
WHERE status = 'active' AND created_at < now() - interval '3 hours';

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY room_id ORDER BY created_at DESC) AS position
  FROM public.call_sessions
  WHERE status IN ('ringing', 'active')
)
UPDATE public.call_sessions c SET status = 'ended', ended_at = now()
FROM ranked r
WHERE c.id = r.id AND r.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS call_sessions_one_live_per_room
  ON public.call_sessions (room_id)
  WHERE status IN ('ringing', 'active');

-- The app fetches its own token now, so the other person in the room can no longer read the caller's.
UPDATE public.call_sessions SET agora_token = NULL WHERE agora_token IS NOT NULL;
