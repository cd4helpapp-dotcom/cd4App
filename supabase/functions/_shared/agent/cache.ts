// @ts-nocheck
// Answer cache for general questions. Health data must never be shared between patients, so a question is cached only
// when it is the first message, says nothing about the person asking, and the model itself marked it educational.

const PERSONAL_MARKERS = /\b(i|i'm|im|i've|my|me|mine|myself|we|our|us|mujhe|mujhko|mera|meri|mere|main|maine|hum|hamara|hamari|humko|hume|hamein|apna|apni|aaj|kal|abhi|since|for \d+|years? old|saal ka|saal ki|din se)\b|(मुझे|मेरा|मेरी|मेरे|मैं|मैंने|हमें|हमारा|आज|कल|अभी)|\d/i

// Measured with scripts/tune-agent-thresholds.mjs; change with the AI_CACHE_SIMILARITY secret.
const similarityFromEnv = Number(Deno.env.get("AI_CACHE_SIMILARITY"))
const SEMANTIC_THRESHOLD = similarityFromEnv >= 0.85 && similarityFromEnv < 1 ? similarityFromEnv : 0.95
const TTL_DAYS = 30

export const normalizeQuestion = (value: unknown): string =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

export const isCacheableQuestion = (message: string, hasHistory: boolean): boolean => {
  const text = String(message || "").trim()
  return !hasHistory && text.length >= 8 && text.length <= 200 && !PERSONAL_MARKERS.test(text)
}

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export const cacheKeyFor = (question: string, language: string, audience: string): Promise<string> =>
  sha256(`v1|${audience}|${language}|${normalizeQuestion(question)}`)

export const lookupExact = async (admin: any, key: string) => {
  const { data } = await admin.from("ai_response_cache").select("id, answer, hit_count").eq("cache_key", key).gt("expires_at", new Date().toISOString()).maybeSingle()
  return data || null
}

export const lookupSemantic = async (admin: any, args: { embedding: number[]; language: string; audience: string }) => {
  const { data, error } = await admin.rpc("match_ai_response_cache", {
    p_query_embedding: JSON.stringify(args.embedding),
    p_language: args.language,
    p_audience: args.audience,
    p_threshold: SEMANTIC_THRESHOLD,
  })
  if (error) return null
  return data?.[0] || null
}

export const markHit = (admin: any, row: { id: string; hit_count?: number }) =>
  admin.from("ai_response_cache").update({ hit_count: (row.hit_count || 0) + 1, last_hit_at: new Date().toISOString() }).eq("id", row.id)

export const storeAnswer = async (admin: any, args: { key: string; question: string; language: string; audience: string; embedding: number[] | null; answer: any }) => {
  if (!args.embedding) return
  const { error } = await admin.from("ai_response_cache").upsert(
    {
      cache_key: args.key,
      question: normalizeQuestion(args.question),
      language: args.language,
      audience: args.audience,
      embedding: JSON.stringify(args.embedding),
      answer: args.answer,
      expires_at: new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString(),
    },
    { onConflict: "cache_key" },
  )
  if (error) console.warn("[agent] cache store failed", error.message)
}
