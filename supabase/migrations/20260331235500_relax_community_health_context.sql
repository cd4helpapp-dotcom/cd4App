-- Allow normal personal wellbeing updates while keeping community health-focused and safe.

CREATE OR REPLACE FUNCTION public.community_is_health_related(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized TEXT := lower(coalesce(p_text, ''));
  keyword TEXT;
  has_health BOOLEAN := FALSE;
  has_wellbeing BOOLEAN := FALSE;
  has_personal BOOLEAN := FALSE;
  health_keywords TEXT[] := ARRAY[
    'health', 'diabetes', 'sugar', 'glucose', 'insulin', 'hba1c',
    'blood pressure', 'bp', 'cholesterol', 'thyroid', 'pcos',
    'diet', 'nutrition', 'exercise', 'walk', 'sleep',
    'report', 'doctor', 'patient', 'medicine', 'medication',
    'wellness', 'weight', 'fitness', 'lab', 'clinic'
  ];
  wellbeing_keywords TEXT[] := ARRAY[
    'feel', 'feeling', 'feeling well', 'better', 'improving', 'improvement',
    'progress', 'streak', 'journey', 'recovery', 'recovering', 'healing',
    'motivation', 'discipline', 'happy', 'happier', 'wellbeing', 'healthy',
    'khush', 'acha', 'accha', 'theek', 'thik', 'behtar', 'sehat'
  ];
  personal_hints TEXT[] := ARRAY[
    ' i ', ' im ', ' i''m ', ' my ', ' me ', ' today ',
    ' feeling ', ' feel ', ' progress ', ' journey ', ' streak ', ' update ',
    ' khush ', ' acha ', ' accha ', ' theek ', ' thik ', ' behtar '
  ];
BEGIN
  normalized := ' ' || regexp_replace(normalized, '\s+', ' ', 'g') || ' ';

  FOREACH keyword IN ARRAY health_keywords LOOP
    IF position(keyword IN normalized) > 0 THEN
      has_health := TRUE;
      EXIT;
    END IF;
  END LOOP;

  IF has_health THEN
    RETURN TRUE;
  END IF;

  FOREACH keyword IN ARRAY wellbeing_keywords LOOP
    IF position(keyword IN normalized) > 0 THEN
      has_wellbeing := TRUE;
      EXIT;
    END IF;
  END LOOP;

  IF NOT has_wellbeing THEN
    RETURN FALSE;
  END IF;

  FOREACH keyword IN ARRAY personal_hints LOOP
    IF position(keyword IN normalized) > 0 THEN
      has_personal := TRUE;
      EXIT;
    END IF;
  END LOOP;

  RETURN has_personal;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_validate_post_content()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  role_slug TEXT := coalesce(public.current_user_role_slug(), 'patient');
  image_scan_status TEXT := lower(coalesce(NEW.moderation_meta->>'image_scan_status', ''));
BEGIN
  NEW.body := btrim(coalesce(NEW.body, ''));
  NEW.moderation_meta := coalesce(NEW.moderation_meta, '{}'::jsonb);

  IF char_length(NEW.body) < 8 THEN
    RAISE EXCEPTION 'Post is too short.';
  END IF;

  IF char_length(NEW.body) > 1800 THEN
    RAISE EXCEPTION 'Post is too long.';
  END IF;

  IF public.community_contains_blocked_content(NEW.body) THEN
    RAISE EXCEPTION 'Post blocked by safety policy.';
  END IF;

  IF role_slug <> 'admin' AND NOT public.community_is_health_related(NEW.body) THEN
    RAISE EXCEPTION 'Please keep posts around health and wellbeing updates.';
  END IF;

  IF role_slug <> 'admin' AND coalesce(NEW.image_url, '') <> '' AND NEW.status = 'published' THEN
    IF image_scan_status <> 'approved' THEN
      NEW.status := 'pending_review';
      NEW.moderation_reason := coalesce(NEW.moderation_reason, 'Image post requires moderation review.');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
