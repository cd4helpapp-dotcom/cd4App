// @ts-nocheck
// Daily AI message quota (free vs Pro) and per-minute burst limit.
// Storage: public.ai_usage_stats (one row per user per day). Plan: public.user_subscriptions.
//
// Defaults: Free 20 messages/day, Pro 100/day, 6 messages per minute (Pro 12). Days roll over at midnight IST.
// Override with CHAT_AI_MESSAGE_LIMIT_PER_WINDOW, CHAT_AI_PRO_MESSAGE_LIMIT_PER_WINDOW,
// CHAT_AI_BURST_LIMIT_MESSAGES, CHAT_AI_PRO_BURST_LIMIT_MESSAGES, CHAT_AI_BURST_WINDOW_MS.

const envInt = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(Deno.env.get(name) || "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const FREE_DAILY_LIMIT = Math.max(1, Math.min(1000, envInt("CHAT_AI_MESSAGE_LIMIT_PER_WINDOW", 20)))
// Pro is always strictly higher than Free, even if an env value is misconfigured.
const PRO_DAILY_LIMIT = Math.max(FREE_DAILY_LIMIT + 1, Math.min(3000, envInt("CHAT_AI_PRO_MESSAGE_LIMIT_PER_WINDOW", 100)))
const FREE_BURST_LIMIT = Math.max(2, Math.min(50, envInt("CHAT_AI_BURST_LIMIT_MESSAGES", 6)))
const PRO_BURST_LIMIT = Math.max(FREE_BURST_LIMIT + 1, Math.min(200, envInt("CHAT_AI_PRO_BURST_LIMIT_MESSAGES", 12)))
const BURST_WINDOW_MS = Math.max(10_000, envInt("CHAT_AI_BURST_WINDOW_MS", 60_000))
const IST_OFFSET_MINUTES = 330

// Voice is billed per audio token and is far more expensive than text, so it has its own small counter
// (one unit = one voice session started). Free 5/day, Pro 30/day; at most 3 session starts per minute.
// Override with VOICE_SESSION_LIMIT_PER_DAY, VOICE_PRO_SESSION_LIMIT_PER_DAY, VOICE_BURST_LIMIT_SESSIONS.
const FREE_VOICE_DAILY_LIMIT = Math.max(1, Math.min(200, envInt("VOICE_SESSION_LIMIT_PER_DAY", 5)))
const PRO_VOICE_DAILY_LIMIT = Math.max(FREE_VOICE_DAILY_LIMIT + 1, Math.min(500, envInt("VOICE_PRO_SESSION_LIMIT_PER_DAY", 30)))
const VOICE_BURST_LIMIT = Math.max(1, Math.min(20, envInt("VOICE_BURST_LIMIT_SESSIONS", 3)))

export type QuotaScope = "chat" | "voice"

const resolveIsPro = async (admin: any, userId: string, nowMs: number): Promise<boolean> => {
  try {
    const { data, error } = await admin
      .from("user_subscriptions")
      .select("status, expires_at")
      .eq("user_id", userId)
      .eq("plan_code", "pro")
      .in("status", ["active", "trialing", "grace"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return false
    if (!data.expires_at) return true
    const expiresMs = new Date(data.expires_at).getTime()
    return Number.isFinite(expiresMs) && expiresMs > nowMs
  } catch {
    // Never lock a paying customer out because of a lookup failure.
    return false
  }
}

export type AiQuota = {
  blocked: boolean
  blockType: "none" | "burst" | "daily"
  limit: number
  used: number
  remaining: number
  isPro: boolean
  burstLimit: number
  burstWindowMs: number
  burstUsed: number
  blockLevel: number
  blockHours: number
  blockUntil: string | null
  retryAfterMs: number
  dayKey: string
  burstWindowStartedAt: string | null
}

export const getAiQuota = async (admin: any, userId: string, scope: QuotaScope = "chat"): Promise<AiQuota> => {
  const nowMs = Date.now()
  const local = new Date(nowMs + IST_OFFSET_MINUTES * 60_000)
  // Voice uses its own rows in the same table (day_key is text), so no migration is needed.
  const dayKey = `${scope === "voice" ? "voice:" : ""}${local.toISOString().split("T")[0]}`
  const dayEndMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - IST_OFFSET_MINUTES * 60_000

  const isPro = await resolveIsPro(admin, userId, nowMs)
  const limit = scope === "voice" ? (isPro ? PRO_VOICE_DAILY_LIMIT : FREE_VOICE_DAILY_LIMIT) : (isPro ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT)
  const burstLimit = scope === "voice" ? VOICE_BURST_LIMIT : (isPro ? PRO_BURST_LIMIT : FREE_BURST_LIMIT)

  const base: AiQuota = {
    blocked: false, blockType: "none", limit, used: 0, remaining: limit, isPro, burstLimit,
    burstWindowMs: BURST_WINDOW_MS, burstUsed: 0, blockLevel: 0, blockHours: 0, blockUntil: null, retryAfterMs: 0, dayKey, burstWindowStartedAt: null,
  }

  const { data: row, error } = await admin
    .from("ai_usage_stats")
    .select("message_count, burst_count, burst_window_started_at")
    .eq("user_id", userId)
    .eq("day_key", dayKey)
    .maybeSingle()
  // If the counter cannot be read, fail open (do not block patients) but log it.
  if (error) {
    console.error("[aiUsage] read failed", error)
    return base
  }

  const used = Math.max(0, Number(row?.message_count) || 0)
  const windowStartMs = row?.burst_window_started_at ? new Date(row.burst_window_started_at).getTime() : 0
  const inBurstWindow = Number.isFinite(windowStartMs) && nowMs - windowStartMs >= 0 && nowMs - windowStartMs < BURST_WINDOW_MS
  const burstUsed = inBurstWindow ? Math.max(0, Number(row?.burst_count) || 0) : 0

  const dailyReached = used >= limit
  const burstReached = burstUsed >= burstLimit
  const retryAfterMs = burstReached ? Math.max(1000, BURST_WINDOW_MS - (nowMs - windowStartMs)) : dailyReached ? Math.max(1000, dayEndMs - nowMs) : 0

  return {
    ...base,
    blocked: dailyReached || burstReached,
    blockType: burstReached ? "burst" : dailyReached ? "daily" : "none",
    used,
    remaining: Math.max(0, limit - used),
    burstUsed,
    burstWindowStartedAt: inBurstWindow ? row.burst_window_started_at : null,
    blockLevel: dailyReached ? 1 : 0,
    blockHours: retryAfterMs > 0 ? Math.ceil(retryAfterMs / 3_600_000) : 0,
    blockUntil: retryAfterMs > 0 ? new Date(nowMs + retryAfterMs).toISOString() : null,
    retryAfterMs,
  }
}

// Counts one message. Called when a request is accepted (before the model runs) so that parallel requests
// cannot all slip under the limit. Returns the quota as it stands after counting.
export const recordAiUsage = async (admin: any, userId: string, quota: AiQuota): Promise<AiQuota> => {
  const nowIso = new Date().toISOString()
  const used = quota.used + 1
  const windowOpen = quota.burstUsed > 0 && Boolean(quota.burstWindowStartedAt)
  const burstUsed = windowOpen ? quota.burstUsed + 1 : 1
  const { error } = await admin.from("ai_usage_stats").upsert(
    {
      user_id: userId,
      day_key: quota.dayKey,
      message_count: used,
      burst_count: burstUsed,
      burst_window_started_at: windowOpen ? quota.burstWindowStartedAt : nowIso,
      updated_at: nowIso,
    },
    { onConflict: "user_id,day_key" },
  )
  if (error) console.error("[aiUsage] write failed", error)
  return { ...quota, used, remaining: Math.max(0, quota.limit - used), burstUsed }
}

// What the patient sees when they hit a limit.
export const quotaBlockedReply = (quota: AiQuota): string => {
  const minutes = Math.max(1, Math.ceil(quota.retryAfterMs / 60_000))
  const hours = Math.ceil(minutes / 60)
  const wait = minutes < 60 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"}`
  if (quota.blockType === "burst") {
    return `You're sending messages very quickly. Please wait about **${wait}** and try again.`
  }
  return quota.isPro
    ? `You've reached today's Pro limit of **${quota.limit}** AI messages. It resets in about **${wait}**.`
    : `You've used all **${quota.limit}** free AI messages for today. **Upgrade to Pro** for a higher daily limit, or try again in about **${wait}**.`
}

export const voiceQuotaBlockedReply = (quota: AiQuota): string => {
  const minutes = Math.max(1, Math.ceil(quota.retryAfterMs / 60_000))
  const hours = Math.ceil(minutes / 60)
  const wait = minutes < 60 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"}`
  if (quota.blockType === "burst") return `You're starting voice sessions too quickly. Please wait about ${wait} and try again.`
  return quota.isPro
    ? `You've used all ${quota.limit} voice sessions for today. They reset in about ${wait}. You can still chat by text.`
    : `You've used all ${quota.limit} free voice sessions for today. Upgrade to Pro for more, or continue by text chat.`
}
