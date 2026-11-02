-- CD4 AI agent: curated knowledge (RAG), hybrid search, answer cache and request telemetry.
-- None of these tables hold a message or a reply from a patient, except ai_response_cache,
-- which stores only general questions that say nothing about the person asking.

CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge -----------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('app_help', 'medical')),
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'patient', 'doctor')),
  reviewed_on DATE,
  fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || content)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_embedding ON public.ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_fts ON public.ai_knowledge_chunks USING gin (fts);

-- Service role only: the agent reads this through the function below, the app never reads it directly.
ALTER TABLE public.ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Reciprocal rank fusion of vector and keyword results.
CREATE OR REPLACE FUNCTION public.match_ai_knowledge(
  p_query_text TEXT,
  p_query_embedding TEXT,
  p_audience TEXT DEFAULT 'patient',
  p_category TEXT DEFAULT NULL,
  p_match_count INTEGER DEFAULT 4
)
RETURNS TABLE (id UUID, source TEXT, title TEXT, content TEXT, category TEXT, score DOUBLE PRECISION, keyword_hit BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH eligible AS (
    SELECT c.* FROM public.ai_knowledge_chunks c
    WHERE c.audience IN ('all', p_audience)
      AND (p_category IS NULL OR c.category = p_category)
  ),
  by_vector AS (
    SELECT e.id, 1 - (e.embedding <=> (p_query_embedding::vector)) AS similarity,
           row_number() OVER (ORDER BY e.embedding <=> (p_query_embedding::vector)) AS position
    FROM eligible e
    ORDER BY e.embedding <=> (p_query_embedding::vector)
    LIMIT 20
  ),
  by_keyword AS (
    SELECT e.id, row_number() OVER (ORDER BY ts_rank(e.fts, query) DESC) AS position
    FROM eligible e, websearch_to_tsquery('simple', p_query_text) query
    WHERE e.fts @@ query
    ORDER BY ts_rank(e.fts, query) DESC
    LIMIT 20
  )
  SELECT e.id, e.source, e.title, e.content, e.category,
         COALESCE(v.similarity, 0)::DOUBLE PRECISION AS score,
         k.id IS NOT NULL AS keyword_hit
  FROM eligible e
  LEFT JOIN by_vector v ON v.id = e.id
  LEFT JOIN by_keyword k ON k.id = e.id
  WHERE v.id IS NOT NULL OR k.id IS NOT NULL
  ORDER BY COALESCE(1.0 / (60 + v.position), 0) + COALESCE(1.0 / (60 + k.position), 0) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 4), 10));
$$;

REVOKE ALL ON FUNCTION public.match_ai_knowledge(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- A patient's report chunks. The patient id is a required filter, and a signed-in caller can only pass their own.
CREATE INDEX IF NOT EXISTS idx_medical_report_chunks_fts
  ON public.medical_report_chunks USING gin (to_tsvector('simple', content));

CREATE OR REPLACE FUNCTION public.match_report_chunks_hybrid(
  p_patient_id UUID,
  p_report_id UUID,
  p_query_text TEXT,
  p_query_embedding TEXT,
  p_match_count INTEGER DEFAULT 6
)
RETURNS TABLE (id UUID, report_id UUID, chunk_index INTEGER, content TEXT, score DOUBLE PRECISION, keyword_hit BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH eligible AS (
    SELECT c.* FROM public.medical_report_chunks c
    JOIN public.medical_reports r ON r.id = c.report_id
    WHERE c.patient_id = p_patient_id
      AND r.patient_id = p_patient_id
      AND r.deleted_at IS NULL
      AND (p_report_id IS NULL OR c.report_id = p_report_id)
      AND (auth.uid() IS NULL OR auth.uid() = p_patient_id)
  ),
  by_vector AS (
    SELECT e.id, 1 - (e.embedding <=> (p_query_embedding::vector)) AS similarity,
           row_number() OVER (ORDER BY e.embedding <=> (p_query_embedding::vector)) AS position
    FROM eligible e
    ORDER BY e.embedding <=> (p_query_embedding::vector)
    LIMIT 20
  ),
  by_keyword AS (
    SELECT e.id, row_number() OVER (ORDER BY ts_rank(to_tsvector('simple', e.content), query) DESC) AS position
    FROM eligible e, websearch_to_tsquery('simple', p_query_text) query
    WHERE to_tsvector('simple', e.content) @@ query
    LIMIT 20
  )
  SELECT e.id, e.report_id, e.chunk_index, e.content,
         COALESCE(v.similarity, 0)::DOUBLE PRECISION AS score,
         k.id IS NOT NULL AS keyword_hit
  FROM eligible e
  LEFT JOIN by_vector v ON v.id = e.id
  LEFT JOIN by_keyword k ON k.id = e.id
  WHERE v.id IS NOT NULL OR k.id IS NOT NULL
  ORDER BY COALESCE(1.0 / (60 + v.position), 0) + COALESCE(1.0 / (60 + k.position), 0) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 6), 12));
$$;

REVOKE ALL ON FUNCTION public.match_report_chunks_hybrid(UUID, UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_report_chunks_hybrid(UUID, UUID, TEXT, TEXT, INTEGER) TO service_role;

-- Answer cache ---------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  language TEXT NOT NULL,
  audience TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  answer JSONB NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_response_cache_embedding ON public.ai_response_cache USING hnsw (embedding vector_cosine_ops);
ALTER TABLE public.ai_response_cache ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.match_ai_response_cache(p_query_embedding TEXT, p_language TEXT, p_audience TEXT, p_threshold DOUBLE PRECISION)
RETURNS TABLE (id UUID, answer JSONB, hit_count INTEGER, similarity DOUBLE PRECISION)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT c.id, c.answer, c.hit_count, 1 - (c.embedding <=> (p_query_embedding::vector)) AS similarity
  FROM public.ai_response_cache c
  WHERE c.language = p_language
    AND c.audience = p_audience
    AND c.expires_at > now()
    AND 1 - (c.embedding <=> (p_query_embedding::vector)) >= p_threshold
  ORDER BY c.embedding <=> (p_query_embedding::vector)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.match_ai_response_cache(TEXT, TEXT, TEXT, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_response_cache(TEXT, TEXT, TEXT, DOUBLE PRECISION) TO service_role;

-- Observability --------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_agent_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  surface TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT,
  route TEXT NOT NULL,
  tier TEXT,
  route_reason TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  embedding_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6),
  latency_ms INTEGER,
  cache_status TEXT NOT NULL DEFAULT 'skip',
  retrieved_chunks INTEGER NOT NULL DEFAULT 0,
  top_score DOUBLE PRECISION,
  guard_flags TEXT[] NOT NULL DEFAULT '{}',
  unsupported_values INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_events_created_at ON public.ai_agent_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_events_route ON public.ai_agent_events (route, created_at DESC);

ALTER TABLE public.ai_agent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read agent events" ON public.ai_agent_events;
CREATE POLICY "Admins read agent events"
ON public.ai_agent_events
FOR SELECT
TO authenticated
USING (public.is_admin_user(auth.uid()));

CREATE OR REPLACE VIEW public.ai_agent_daily_stats
WITH (security_invoker = true) AS
SELECT
  (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day,
  surface,
  route,
  count(*) AS requests,
  count(*) FILTER (WHERE model IS NOT NULL) AS model_calls,
  count(*) FILTER (WHERE cache_status LIKE 'hit%') AS cache_hits,
  count(*) FILTER (WHERE cache_status = 'miss') AS cache_misses,
  sum(input_tokens) AS input_tokens,
  sum(cached_tokens) AS prompt_cache_tokens,
  sum(output_tokens) AS output_tokens,
  round(sum(cost_usd), 4) AS cost_usd,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  count(*) FILTER (WHERE cardinality(guard_flags) > 0) AS guarded,
  count(*) FILTER (WHERE unsupported_values > 0) AS unsupported_value_replies,
  count(*) FILTER (WHERE error IS NOT NULL) AS errors
FROM public.ai_agent_events
GROUP BY 1, 2, 3;
