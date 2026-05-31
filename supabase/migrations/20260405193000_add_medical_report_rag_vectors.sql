-- RAG foundation for medical reports: chunk storage + pgvector similarity search

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.medical_report_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.medical_reports(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    chunk_char_count INTEGER NOT NULL DEFAULT 0,
    embedding VECTOR(1536) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (report_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_medical_report_chunks_patient_report
    ON public.medical_report_chunks(patient_id, report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_medical_report_chunks_report_idx
    ON public.medical_report_chunks(report_id, chunk_index ASC);

CREATE INDEX IF NOT EXISTS idx_medical_report_chunks_embedding_ivfflat
    ON public.medical_report_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

ALTER TABLE public.medical_report_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can view own medical report chunks" ON public.medical_report_chunks;
CREATE POLICY "Patients can view own medical report chunks"
    ON public.medical_report_chunks
    FOR SELECT
    USING (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can insert own medical report chunks" ON public.medical_report_chunks;
CREATE POLICY "Patients can insert own medical report chunks"
    ON public.medical_report_chunks
    FOR INSERT
    WITH CHECK (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can update own medical report chunks" ON public.medical_report_chunks;
CREATE POLICY "Patients can update own medical report chunks"
    ON public.medical_report_chunks
    FOR UPDATE
    USING (auth.uid() = patient_id)
    WITH CHECK (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can delete own medical report chunks" ON public.medical_report_chunks;
CREATE POLICY "Patients can delete own medical report chunks"
    ON public.medical_report_chunks
    FOR DELETE
    USING (auth.uid() = patient_id);

CREATE OR REPLACE FUNCTION public.set_medical_report_chunks_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_medical_report_chunks_updated_at ON public.medical_report_chunks;
CREATE TRIGGER trg_set_medical_report_chunks_updated_at
    BEFORE UPDATE ON public.medical_report_chunks
    FOR EACH ROW
    EXECUTE FUNCTION public.set_medical_report_chunks_updated_at();

DROP FUNCTION IF EXISTS public.search_medical_report_chunks(UUID, TEXT, INTEGER, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION public.search_medical_report_chunks(
    p_patient_id UUID,
    p_query_embedding TEXT,
    p_match_count INTEGER DEFAULT 5,
    p_min_similarity DOUBLE PRECISION DEFAULT 0.15
)
RETURNS TABLE (
    chunk_id UUID,
    report_id UUID,
    chunk_index INTEGER,
    content TEXT,
    similarity DOUBLE PRECISION,
    report_type TEXT,
    report_created_at TIMESTAMP WITH TIME ZONE,
    report_analyzed_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT
        chunk.id AS chunk_id,
        chunk.report_id,
        chunk.chunk_index,
        chunk.content,
        (1 - (chunk.embedding <=> (p_query_embedding::vector))) AS similarity,
        report.report_type,
        report.created_at AS report_created_at,
        report.analyzed_at AS report_analyzed_at
    FROM public.medical_report_chunks AS chunk
    INNER JOIN public.medical_reports AS report
        ON report.id = chunk.report_id
    WHERE chunk.patient_id = p_patient_id
      AND report.patient_id = p_patient_id
      AND report.deleted_at IS NULL
      AND (auth.uid() IS NULL OR auth.uid() = p_patient_id)
      AND (1 - (chunk.embedding <=> (p_query_embedding::vector))) >= p_min_similarity
    ORDER BY chunk.embedding <=> (p_query_embedding::vector)
    LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 5), 20));
$$;

REVOKE ALL ON FUNCTION public.search_medical_report_chunks(UUID, TEXT, INTEGER, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_medical_report_chunks(UUID, TEXT, INTEGER, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_medical_report_chunks(UUID, TEXT, INTEGER, DOUBLE PRECISION) TO service_role;
