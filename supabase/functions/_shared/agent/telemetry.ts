// @ts-nocheck
// One row per agent request: what route it took and what it cost. Never the message or the reply, because those are health data.

// USD per 1M tokens: input, cached input, output. Update when prices change; an unknown model records a null cost.
const PRICES: Record<string, [number, number, number]> = {
  "gpt-4o-mini": [0.15, 0.075, 0.6],
  "gpt-4o": [2.5, 1.25, 10],
  "gemini-2.5-flash": [0.3, 0.075, 2.5],
}

export const estimateCostUsd = (model: string | null, inputTokens: number, cachedTokens: number, outputTokens: number): number | null => {
  const key = Object.keys(PRICES).find((name) => String(model || "") === name || String(model || "").startsWith(`${name}-`))
  if (!key) return null
  const [input, cached, output] = PRICES[key]
  return ((inputTokens - cachedTokens) * input + cachedTokens * cached + outputTokens * output) / 1_000_000
}

export type AgentEvent = {
  surface: "chat" | "report_chat" | "voice_tool"
  userId?: string | null
  role?: string | null
  route: string
  tier?: string | null
  routeReason?: string | null
  model?: string | null
  inputTokens?: number
  cachedTokens?: number
  outputTokens?: number
  embeddingTokens?: number
  latencyMs?: number
  cacheStatus?: "hit_exact" | "hit_semantic" | "miss" | "skip"
  retrievedChunks?: number
  topScore?: number | null
  guardFlags?: string[]
  unsupportedValues?: number
  error?: string | null
}

// Telemetry must never break or slow a patient's answer.
export const recordAgentEvent = async (admin: any, event: AgentEvent): Promise<void> => {
  try {
    const inputTokens = event.inputTokens || 0
    const cachedTokens = event.cachedTokens || 0
    const outputTokens = event.outputTokens || 0
    await admin.from("ai_agent_events").insert({
      surface: event.surface,
      user_id: event.userId || null,
      role: event.role || null,
      route: event.route,
      tier: event.tier || null,
      route_reason: event.routeReason || null,
      model: event.model || null,
      input_tokens: inputTokens,
      cached_tokens: cachedTokens,
      output_tokens: outputTokens,
      embedding_tokens: event.embeddingTokens || 0,
      cost_usd: estimateCostUsd(event.model || null, inputTokens, cachedTokens, outputTokens),
      latency_ms: event.latencyMs ?? null,
      cache_status: event.cacheStatus || "skip",
      retrieved_chunks: event.retrievedChunks || 0,
      top_score: event.topScore ?? null,
      guard_flags: event.guardFlags || [],
      unsupported_values: event.unsupportedValues || 0,
      error: event.error ? String(event.error).slice(0, 300) : null,
    })
  } catch (error) {
    console.warn("[agent] telemetry failed", error)
  }
}

// Sends the row after the response, so logging adds no wait for the patient.
export const trackInBackground = (admin: any, event: AgentEvent): void => {
  const pending = recordAgentEvent(admin, event)
  try {
    EdgeRuntime.waitUntil(pending)
  } catch {
    // Outside the Supabase runtime the promise simply finishes on its own.
  }
}
