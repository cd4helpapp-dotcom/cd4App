// @ts-nocheck
// Retrieval for CD4 AI: curated knowledge chunks, and the signed-in patient's own report chunks.
// Both searches are hybrid. Vectors find meaning ("sugar" and "glucose"), keywords find exact terms ("HbA1c", "CBC").

import { wrapUntrusted } from "./guards.ts"

const EMBEDDING_MODEL = () => (Deno.env.get("RAG_EMBEDDING_MODEL") || "").trim() || "text-embedding-3-small"
// Measured with scripts/tune-agent-thresholds.mjs; change with a secret, no deploy of code needed.
const envNumber = (name: string, fallback: number) => {
  const value = Number(Deno.env.get(name))
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback
}
export const MIN_KNOWLEDGE_SCORE = envNumber("AI_MIN_KNOWLEDGE_SCORE", 0.32)
export const MIN_REPORT_SCORE = envNumber("AI_MIN_REPORT_SCORE", 0.2)

export const embedText = async (apiKey: string, text: string): Promise<{ embedding: number[]; tokens: number } | null> => {
  if (!apiKey || !text.trim()) return null
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL(), input: text.slice(0, 2000) }),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null)
  const embedding = payload?.data?.[0]?.embedding
  return Array.isArray(embedding) ? { embedding, tokens: Number(payload?.usage?.total_tokens) || 0 } : null
}

export type KnowledgeChunk = { id: string; source: string; title: string; content: string; category: string; score: number; keyword_hit: boolean }

export const retrieveKnowledge = async (admin: any, args: { query: string; embedding: number[]; audience: string; category?: string | null; matchCount?: number }): Promise<KnowledgeChunk[]> => {
  const { data, error } = await admin.rpc("match_ai_knowledge", {
    p_query_text: args.query,
    p_query_embedding: JSON.stringify(args.embedding),
    p_audience: args.audience,
    p_category: args.category || null,
    p_match_count: args.matchCount || 4,
  })
  if (error) {
    console.warn("[agent] knowledge search failed", error.message)
    return []
  }
  // A weak match is worse than none: it invites the model to answer from something off-topic.
  return (data || []).filter((row: any) => row.score >= MIN_KNOWLEDGE_SCORE || row.keyword_hit)
}

export const formatKnowledge = (chunks: KnowledgeChunk[]): string =>
  chunks.map((chunk) => wrapUntrusted(`${chunk.category === "app_help" ? "CD4 help" : "Medical reference"}: ${chunk.title}`, chunk.content, 1500)).join("\n")

export const retrieveReportChunks = async (admin: any, args: { patientId: string; reportId?: string | null; query: string; embedding: number[]; matchCount?: number }) => {
  const { data, error } = await admin.rpc("match_report_chunks_hybrid", {
    p_patient_id: args.patientId,
    p_report_id: args.reportId || null,
    p_query_text: args.query,
    p_query_embedding: JSON.stringify(args.embedding),
    p_match_count: args.matchCount || 6,
  })
  if (error) {
    console.warn("[agent] report search failed", error.message)
    return []
  }
  return (data || []).filter((row: any) => row.score >= MIN_REPORT_SCORE || row.keyword_hit)
}
