// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function parseEnvInt(key: string, fallback: number): number {
  const raw = Number((Deno.env.get(key) || "").trim())
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra"
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-5.6-sol"
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
const AI_MESSAGE_LIMIT_PER_WINDOW = Math.max(10, Math.min(1000, parseEnvInt("CHAT_AI_MESSAGE_LIMIT_PER_WINDOW", 40)))
const AI_BURST_LIMIT_MESSAGES = Math.max(2, Math.min(50, parseEnvInt("CHAT_AI_BURST_LIMIT_MESSAGES", 6)))
const AI_BURST_WINDOW_MS = Math.max(10 * 1000, parseEnvInt("CHAT_AI_BURST_WINDOW_MS", 60 * 1000))
const AI_FIRST_BLOCK_MS = Math.max(5 * 60 * 1000, parseEnvInt("CHAT_AI_FIRST_BLOCK_MS", 2 * 60 * 60 * 1000))
const AI_SECOND_BLOCK_MS = Math.max(10 * 60 * 1000, parseEnvInt("CHAT_AI_SECOND_BLOCK_MS", 4 * 60 * 60 * 1000))
const AI_RATE_LIMIT_TZ_OFFSET_MINUTES = 330

const clipText = (value: string, maxLength: number): string => {
  const text = (value || "").trim()
  if (!text) return ""
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

const REPORT_CHAT_HISTORY_LIMIT = Math.max(4, Math.min(16, parseEnvInt("REPORT_CHAT_HISTORY_LIMIT", 10)))
const REPORT_CHAT_HISTORY_ITEM_CHARS = Math.max(120, Math.min(800, parseEnvInt("REPORT_CHAT_HISTORY_ITEM_CHARS", 360)))
const REPORT_CHAT_SUMMARY_CHARS = Math.max(1000, Math.min(5000, parseEnvInt("REPORT_CHAT_SUMMARY_CHARS", 2600)))
const REPORT_CHAT_EXPLANATION_CHARS = Math.max(800, Math.min(4000, parseEnvInt("REPORT_CHAT_EXPLANATION_CHARS", 1800)))
const REPORT_CHAT_EXTRACTED_TEXT_CHARS = Math.max(
  2500,
  Math.min(12000, parseEnvInt("REPORT_CHAT_EXTRACTED_TEXT_CHARS", 6500))
)
const REPORT_CHAT_REPLY_MAX_CHARS = Math.max(1800, Math.min(8000, parseEnvInt("REPORT_CHAT_REPLY_MAX_CHARS", 5200)))
const REPORT_CHAT_GEMINI_TIMEOUT_MS = Math.max(8000, Math.min(30000, parseEnvInt("REPORT_CHAT_GEMINI_TIMEOUT_MS", 14000)))
const REPORT_CHAT_GEMINI_MAX_ATTEMPTS = Math.max(1, Math.min(2, parseEnvInt("REPORT_CHAT_GEMINI_MAX_ATTEMPTS", 1)))
const REPORT_CHAT_GEMINI_MAX_OUTPUT_TOKENS = Math.max(
  240,
  Math.min(1400, parseEnvInt("REPORT_CHAT_GEMINI_MAX_OUTPUT_TOKENS", 520))
)

const toTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 10)
}

const toMedicationLabelArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const rows: string[] = []
  const dedupe = new Set<string>()
  for (const entry of value) {
    let label = ""
    if (typeof entry === "string") {
      label = clipText(entry.trim(), 180)
    } else if (entry && typeof entry === "object") {
      const row: any = entry
      const name = clipText(String(row.name || row.medicine || row.drug || row.medication || "").trim(), 90)
      const dosage = clipText(String(row.dosage || row.dose || row.strength || "").trim(), 50)
      const frequency = clipText(String(row.frequency || row.schedule || row.how_often || "").trim(), 50)
      const timing = clipText(String(row.timing || row.when || row.time || "").trim(), 60)
      const duration = clipText(String(row.duration || row.days || row.period || "").trim(), 50)
      label = [name, dosage, frequency, timing, duration].filter(Boolean).join(" | ").trim()
    }
    if (!label) continue
    const key = label.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.add(key)
    rows.push(label)
    if (rows.length >= 12) break
  }
  return rows
}

const parseLooseJsonObject = (value: string): Record<string, any> | null => {
  const trimmed = (value || "").trim()
  if (!trimmed) return null

  const stripCodeFences = (raw: string): string =>
    (raw || "")
      .replace(/```json/gi, "```")
      .replace(/```/g, "")
      .trim()

  const cleaned = stripCodeFences(trimmed)

  const decodeJsonStringSafe = (raw: string): string => {
    const input = (raw || "").trim()
    if (!input) return ""
    try {
      return JSON.parse(`"${input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    } catch {
      return input.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    }
  }

  const extractQuotedField = (raw: string, field: string): string => {
    const regex = new RegExp(
      `["']?${field}["']?\\s*:\\s*(?:"([\\s\\S]*?)"|'([\\s\\S]*?)')(?=\\s*,\\s*["']?[a-zA-Z0-9_]+["']?\\s*:|\\s*\\}|\\s*$)`,
      "i"
    )
    const match = raw.match(regex)
    const captured = match?.[1] || match?.[2] || ""
    if (captured) return decodeJsonStringSafe(captured).trim()

    const plainRegex = new RegExp(`["']?${field}["']?\\s*:\\s*([^,\\n\\r\\}]+)`, "i")
    const plainMatch = raw.match(plainRegex)
    return ((plainMatch?.[1] || "").trim().replace(/^["']|["']$/g, ""))
  }

  const extractStringArrayField = (raw: string, field: string, maxItems: number = 10): string[] => {
    const regex = new RegExp(`["']?${field}["']?\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i")
    const match = raw.match(regex)
    if (!match?.[1]) return []
    const block = match[1]
    const items: string[] = []
    const itemRegex = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'/g
    let itemMatch: RegExpExecArray | null = itemRegex.exec(block)
    while (itemMatch && items.length < maxItems) {
      const decoded = decodeJsonStringSafe(itemMatch[1] || itemMatch[2] || "").trim()
      if (decoded) items.push(decoded)
      itemMatch = itemRegex.exec(block)
    }
    return items
  }

  const tryParse = (candidate: string): any | null => {
    try {
      return JSON.parse(candidate)
    } catch {
      return null
    }
  }

  const normalize = (parsed: any, depth: number = 0): Record<string, any> | null => {
    if (depth > 3 || !parsed) return null
    if (typeof parsed === "string") {
      const nested = parsed.trim()
      if (!nested) return null
      const parsedNested = tryParse(nested)
      if (parsedNested) return normalize(parsedNested, depth + 1)

      const first = nested.indexOf("{")
      const last = nested.lastIndexOf("}")
      if (first >= 0 && last > first) {
        const fromSlice = tryParse(nested.slice(first, last + 1))
        if (fromSlice) return normalize(fromSlice, depth + 1)
      }
      return null
    }
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
    return null
  }

  const direct = normalize(tryParse(cleaned))
  if (direct) return direct

  const first = cleaned.indexOf("{")
  const last = cleaned.lastIndexOf("}")
  if (first >= 0 && last > first) {
    const parsedSlice = normalize(tryParse(cleaned.slice(first, last + 1)))
    if (parsedSlice) return parsedSlice
  }

  const summary =
    extractQuotedField(cleaned, "summary") ||
    extractQuotedField(cleaned, "patient_friendly_explanation")
  const patientExplanation =
    extractQuotedField(cleaned, "patient_friendly_explanation") ||
    summary
  const keyPoints =
    extractStringArrayField(cleaned, "key_points") ||
    extractStringArrayField(cleaned, "keyPoints")

  if (summary || patientExplanation || keyPoints.length > 0) {
    return {
      summary,
      patient_friendly_explanation: patientExplanation,
      key_points: keyPoints,
    }
  }

  return null
}

const getNormalizedReportInsights = (
  rawSummaryValue: string,
  rawKeyPointsValue: unknown
): { summary: string; keyPoints: string[]; patientExplanation: string } => {
  let summary = clipText(rawSummaryValue || "", REPORT_CHAT_SUMMARY_CHARS)
  let keyPoints = toTextArray(rawKeyPointsValue)
  let patientExplanation = ""

  if (rawSummaryValue) {
    const parsed = parseLooseJsonObject(rawSummaryValue)
    if (parsed) {
      const parsedSummary = clipText(String(parsed.summary || ""), REPORT_CHAT_SUMMARY_CHARS)
      const parsedExplanation = clipText(String(parsed.patient_friendly_explanation || ""), REPORT_CHAT_EXPLANATION_CHARS)
      const parsedKeyPoints = toTextArray(parsed.key_points ?? parsed.keyPoints)

      if (parsedExplanation || parsedSummary) {
        summary = parsedExplanation || parsedSummary
      }
      if (keyPoints.length === 0 && parsedKeyPoints.length > 0) {
        keyPoints = parsedKeyPoints
      }
      patientExplanation = parsedExplanation
    }
  }

  return { summary, keyPoints, patientExplanation }
}

const getOpenAIModelName = (): string => {
  const fromEnv = (Deno.env.get("REPORT_CHAT_OPENAI_MODEL") || Deno.env.get("OPENAI_MODEL") || "").trim()
  return fromEnv || DEFAULT_OPENAI_MODEL
}

const getOpenAIModelCandidates = (): string[] => {
  const primary = getOpenAIModelName()
  const fallbacks = (Deno.env.get("REPORT_CHAT_OPENAI_MODEL_FALLBACK") || Deno.env.get("OPENAI_MODEL_FALLBACK") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  const deduped = [primary, ...fallbacks, DEFAULT_OPENAI_FALLBACK_MODEL].filter(
    (model, index, list) => model.length > 0 && list.indexOf(model) === index
  )

  return deduped.length > 0 ? deduped : [DEFAULT_OPENAI_MODEL]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getGeminiModelName = (): string => {
  const fromEnv = (Deno.env.get("REPORT_CHAT_GEMINI_MODEL") || Deno.env.get("GEMINI_MODEL") || "").trim()
  return fromEnv || DEFAULT_GEMINI_MODEL
}

const isLikelyMedicalText = (text: string): boolean => {
  const normalized = (text || "").toLowerCase()
  if (!normalized) return false
  const signals = [
    "hemoglobin",
    "cholesterol",
    "hdl",
    "ldl",
    "triglyceride",
    "glucose",
    "urea",
    "creatinine",
    "cbc",
    "platelet",
    "wbc",
    "x-ray",
    "mri",
    "ct",
    "ultrasound",
    "prescription",
    "tablet",
    "capsule",
    "dose",
    "mg/dl",
    "mmhg",
    "bpm",
    "doctor",
    "patient",
    "diagnosis",
    "impression",
  ]
  return signals.some((token) => normalized.includes(token))
}

const getDayWindowInOffset = (now: Date, offsetMinutes: number) => {
  const utcMs = now.getTime()
  const offsetMs = offsetMinutes * 60 * 1000
  const shifted = new Date(utcMs + offsetMs)
  const year = shifted.getUTCFulloear()
  const month = shifted.getUTCMonth()
  const day = shifted.getUTCDate()
  const startMs = Date.UTC(year, month, day, 0, 0, 0) - offsetMs
  const endMs = startMs + 24 * 60 * 60 * 1000
  return {
    dayKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  }
}

const parseIsoToMs = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const evaluateRateLimit = async (args: { serviceClient: any; userId: string; action: string; now?: Date }) => {
  if (!args.serviceClient) {
    return { blocked: false, used: 0, remaining: AI_MESSAGE_LIMIT_PER_WINDOW, burstUsed: 0, retryAfterMs: 0 }
  }
  const now = args.now || new Date()
  const nowMs = now.getTime()
  const dayWindow = getDayWindowInOffset(now, AI_RATE_LIMIT_TZ_OFFSET_MINUTES)

  const burstWindowStartIso = new Date(nowMs - AI_BURST_WINDOW_MS).toISOString()
  const { data: burstRows } = await args.serviceClient
    .from("ai_agent_actions")
    .select("created_at")
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .gte("created_at", burstWindowStartIso)
    .order("created_at", { ascending: true })
    .limit(AI_BURST_LIMIT_MESSAGES)
  const burstUsed = Array.isArray(burstRows) ? burstRows.length : 0
  if (burstUsed >= AI_BURST_LIMIT_MESSAGES) {
    const oldest = burstRows?.[0]?.created_at ? parseIsoToMs(burstRows[0].created_at) : null
    const retryAfterMs = oldest ? Math.max(1000, AI_BURST_WINDOW_MS - Math.max(0, nowMs - oldest)) : AI_BURST_WINDOW_MS
    return { blocked: true, burst: true, retryAfterMs, used: 0, remaining: AI_MESSAGE_LIMIT_PER_WINDOW, burstUsed }
  }

  const { count: sentCount } = await args.serviceClient
    .from("ai_agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .in("status", ["success", "fallback"])
    .gte("created_at", dayWindow.startIso)
    .lt("created_at", dayWindow.endIso)

  const used = Math.max(0, Number(sentCount) || 0)
  if (used >= AI_MESSAGE_LIMIT_PER_WINDOW) {
    return { blocked: true, burst: false, retryAfterMs: AI_FIRST_BLOCK_MS, used, remaining: 0, burstUsed }
  }

  return {
    blocked: false,
    burst: false,
    retryAfterMs: 0,
    used,
    remaining: Math.max(0, AI_MESSAGE_LIMIT_PER_WINDOW - used),
    burstUsed,
  }
}

const buildGeminiEndpoint = (model: string, apiKey: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

const invokeGeminiWithRetry = async (args: {
  apiKey: string
  systemPrompt: string
  formattedHistory: Array<{ role: "assistant" | "user"; content: string }>
  question: string
}): Promise<{ reply: string; model: string }> => {
  const model = getGeminiModelName()
  const maxAttempts = REPORT_CHAT_GEMINI_MAX_ATTEMPTS
  let lastError: any = null

  const geminiHistory = args.formattedHistory.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }))

  const body = {
    systemInstruction: {
      parts: [{ text: args.systemPrompt }],
    },
    contents: [
      ...geminiHistory,
      {
        role: "user",
        parts: [{ text: args.question }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: REPORT_CHAT_GEMINI_MAX_OUTPUT_TOKENS,
    },
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort("request_timeout"), REPORT_CHAT_GEMINI_TIMEOUT_MS)

    try {
      const response = await fetch(buildGeminiEndpoint(model, args.apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error?.message || `Gemini report chat failed (${response.status})`)
      }

      const reply = (data?.candidates || [])
        .flatMap((candidate: any) => candidate?.content?.parts || [])
        .map((part: any) => (typeof part?.text === "string" ? part.text.trim() : ""))
        .find((text: string) => text.length > 0) || ""

      if (!reply) {
        throw new Error("Gemini returned empty report chat response.")
      }

      return { reply, model }
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts) {
        await sleep(300 * attempt)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(lastError?.message || "Gemini report chat unavailable")
}

const hasMarkdownStructure = (value: string): boolean =>
  /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>\s)/m.test(value || "") ||
  /\*\*[^*]+\*\*/.test(value || "") ||
  /`[^`]+`/.test(value || "")

const containsEmoji = (value: string): boolean =>
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(value || "")

const stripVisualMarkers = (value: string): string =>
  (value || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[`*_~>#]/g, "")
    .trim()

const hasMeaningfulText = (value: string): boolean =>
  /[\p{L}\p{N}]/u.test(stripVisualMarkers(value))

const sanitizeMarkdownBullets = (markdown: string): string => {
  if (!(markdown || "").trim()) return ""
  const lines = markdown.split("\n")
  const cleaned: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const bulletMatch = trimmed.match(/^([-*]|\d+\.)\s+(.*)$/)

    if (!bulletMatch) {
      cleaned.push(line)
      continue
    }

    const body = (bulletMatch[2] || "").trim()
    if (hasMeaningfulText(body)) {
      cleaned.push(line)
      continue
    }

    const next = (lines[index + 1] || "").trim()
    const nextIsBullet = /^([-*]|\d+\.)\s+/.test(next)
    if (next && !nextIsBullet && hasMeaningfulText(next)) {
      const marker = bulletMatch[1]
      cleaned.push(`${marker} ${next}`)
      index += 1
    }
  }

  return cleaned
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const hasSafetyCriticalSignal = (value: string): boolean => {
  const text = (value || "").toLowerCase()
  if (!text) return false
  // Keep emoji suppression only for truly emergency language.
  // Avoid generic words like "critical"/"severe" that can appear in normal report phrasing.
  const criticalPatterns = [
    /\bcall\s*911\b/i,
    /\bgo to (the )?(er|emergency)\b/i,
    /\bhospital immediately\b/i,
    /\bseek immediate medical attention\b/i,
    /\bnot breathing\b/i,
    /\bunconscious\b/i,
    /\bheavy bleeding\b/i,
    /\bsevere chest pain\b/i,
    /\bstroke symptoms?\b/i,
    /\bheart attack\b/i,
    /\bemergency\b/i,
  ]
  return criticalPatterns.some((pattern) => pattern.test(text))
}

const pickHeadingEmoji = (line: string): string => {
  const text = (line || "").toLowerCase()
  if (text.includes("warning") || text.includes("watchout") || text.includes("caution")) return "⚠️"
  if (text.includes("next") || text.includes("step") || text.includes("question")) return "👉"
  if (text.includes("summary")) return "🩺"
  if (text.includes("finding") || text.includes("point")) return "✨"
  return "✨"
}

const enrichMarkdownWithFriendlyEmojis = (markdown: string, maxEmojiBoost: number): string => {
  if (!markdown.trim()) return markdown
  const lines = markdown.split("\n")
  let added = 0
  let firstTextLineIndex = -1
  const bulletEmojis = ["✅", "✨", "💡", "🧠", "📌", "🔍"]
  const numberEmojis = ["👉", "➡️", "📝", "✅"]

  const updatedLines = lines.map((line, index) => {
    const trimmed = line.trim()
    if (firstTextLineIndex === -1 && trimmed.length > 0) {
      firstTextLineIndex = index
    }

    if (added >= maxEmojiBoost) return line
    if (containsEmoji(line)) return line

    if (/^\s*#{1,6}\s+/.test(line)) {
      const emoji = pickHeadingEmoji(line)
      if (emoji) {
        added += 1
        return `${line} ${emoji}`
      }
    }

    if (/^\s*-\s+/.test(line)) {
      const bulletBody = line.replace(/^(\s*-\s+)/, "").trim()
      if (!hasMeaningfulText(bulletBody)) {
        return line
      }
      const emoji = bulletEmojis[added % bulletEmojis.length]
      added += 1
      return line.replace(/^(\s*-\s+)/, `$1${emoji} `)
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const numberedBody = line.replace(/^(\s*\d+\.\s+)/, "").trim()
      if (!hasMeaningfulText(numberedBody)) {
        return line
      }
      const emoji = numberEmojis[added % numberEmojis.length]
      added += 1
      return line.replace(/^(\s*\d+\.\s+)/, `$1${emoji} `)
    }

    return line
  })

  if (firstTextLineIndex >= 0 && added < maxEmojiBoost) {
    const firstLine = updatedLines[firstTextLineIndex] || ""
    if (!containsEmoji(firstLine) && !/^\s*#{1,6}\s+/.test(firstLine)) {
      updatedLines[firstTextLineIndex] = `🙂 ${firstLine}`
    }
  }

  return updatedLines.join("\n")
}

const splitSentences = (value: string): string[] => {
  const compact = (value || "").replace(/\s+/g, " ").trim()
  if (!compact) return []
  return (compact.match(/[^.!?]+[.!?]?/g) || [compact])
    .map((item) => item.trim())
    .filter(Boolean)
}

const hasStructuredSections = (value: string): boolean =>
  /(###\s+|##\s+|^\s*-\s+)/m.test(value || "")

const toBullets = (items: string[], prefixEmoji: string): string[] =>
  items.filter(Boolean).map((item) => `- ${prefixEmoji} ${item}`)

const mergeUniquePoints = (lists: string[][], maxItems: number): string[] => {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const item of list) {
      const normalized = (item || "").trim()
      if (!normalized) continue
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(normalized)
      if (merged.length >= maxItems) return merged
    }
  }
  return merged
}

const normalizeLegacyReportHeadings = (markdown: string): string => {
  const lines = (markdown || "").split("\n")
  const headingPattern =
    /^\s*#{1,6}\s*(summary|quick summary|key findings?|key points?|detailed points?|explained points?|watchouts?|what to do next|next steps?|next questions? for doctor|questions? for doctor|what this means)\b/i

  const cleaned = lines.filter((line) => !headingPattern.test(line))
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

const hasDetailIntent = (value: string): boolean => {
  const text = (value || "").toLowerCase()
  if (!text) return false
  const keywords = [
    "detail",
    "detailed",
    "deep",
    "explain",
    "full",
    "complete",
    "sab",
    "poora",
    "samjhao",
    "samjha",
    "achhe se",
    "simple way",
    "point wise",
    "step by step",
    "all values",
    "har value",
    "value",
    "range",
    "normal range",
    "parameter",
    "sab values",
    "complete report",
  ]
  return keywords.some((keyword) => text.includes(keyword))
}

const isPrescriptionLikeQuestion = (value: string): boolean => {
  const text = (value || "").toLowerCase()
  if (!text) return false
  const tokens = [
    "prescription",
    "rx",
    "medicine",
    "medicines",
    "medication",
    "tablet",
    "capsule",
    "syrup",
    "dose",
    "dosage",
    "kitna",
    "dawai",
    "davai",
    "drug",
    "what should i take",
    "kya lu",
  ]
  return tokens.some((token) => text.includes(token))
}

const buildNonPrescriptionGuidanceReply = (args: {
  reportType: string
  keyPoints: string[]
  cautionFlags: string[]
  followUps: string[]
}): string => {
  const reportTypeLabel = args.reportType || "medical_report"
  const highlights = mergeUniquePoints([args.keyPoints], 4)
  const nextSteps = mergeUniquePoints([args.followUps, args.cautionFlags], 4)

  const sections: string[] = []
  sections.push("### Prescription Status")
  sections.push(
    `This uploaded file looks like **${reportTypeLabel}**, not a doctor prescription. I cannot create a new prescription from this report.`
  )

  if (highlights.length > 0) {
    sections.push("", "### Report Highlights")
    sections.push(...toBullets(highlights, "🔎"))
  }

  if (nextSteps.length > 0) {
    sections.push("", "### Suggested Next Steps")
    sections.push(...toBullets(nextSteps, "✅"))
  }

  sections.push(
    "",
    "### Safety",
    "- ⚠️ Do not start/stop medicines based only on AI.",
    "- 👨‍⚕️ Share this report with your doctor for a valid prescription."
  )

  return sections.join("\n").trim()
}

const buildMarkdownFromJsonLikeReply = (raw: string, forceDetailed: boolean): string | null => {
  const parsed = parseLooseJsonObject(raw)
  if (!parsed) return null

  const summary =
    clipText(String(parsed.patient_friendly_explanation || parsed.summary || ""), 2200)
  const keyPoints = toTextArray(parsed.key_points ?? parsed.keyPoints)
  const cautionFlags = toTextArray(parsed.caution_flags ?? parsed.cautionFlags)
  const followUps = toTextArray(parsed.suggested_followups ?? parsed.suggestedFollowups)
  const medications = toTextArray(parsed.medications ?? parsed.prescriptions ?? parsed.prescription_items)
  const explainedPoints = mergeUniquePoints([keyPoints], forceDetailed ? 18 : 8)

  if (!summary && explainedPoints.length === 0 && cautionFlags.length === 0 && followUps.length === 0 && medications.length === 0) {
    return null
  }

  const sections: string[] = []
  if (summary) {
    sections.push("### Quick Summary")
    sections.push(`🙂 ${summary}`)
  }
  if (explainedPoints.length > 0) {
    if (sections.length > 0) sections.push("")
    sections.push("### Key Findings")
    sections.push(...toBullets(explainedPoints, "🔎"))
  }
  if (medications.length > 0) {
    if (sections.length > 0) sections.push("")
    sections.push("### Medicines Mentioned")
    sections.push(...toBullets(medications, "💊"))
  }
  if (cautionFlags.length > 0) {
    if (sections.length > 0) sections.push("")
    sections.push("### Watchouts")
    sections.push(...toBullets(cautionFlags, "⚠️"))
  }
  if (followUps.length > 0) {
    if (sections.length > 0) sections.push("")
    sections.push("### Next Steps")
    sections.push(...toBullets(followUps, "✅"))
  }

  return sections.join("\n").trim()
}

const ensureDetailedReportMarkdown = (raw: string, forceDetailed: boolean): string => {
  const text = (raw || "").trim()
  if (!text) return ""

  if (hasStructuredSections(text)) {
    return normalizeLegacyReportHeadings(text)
  }

  const sentences = splitSentences(text)
  if (sentences.length === 0) return text

  const summaryLine = sentences[0]
  const detailLines = sentences.slice(1, forceDetailed ? 16 : 7)

  const sections: string[] = []
  sections.push("### Quick Summary")
  sections.push(`🙂 ${summaryLine}`)

  if (detailLines.length > 0) {
    sections.push("", "### Key Findings", ...toBullets(detailLines, "🔎"))
  }

  return sections.join("\n").trim()
}

const formatReportAssistantReply = (
  rawReply: string,
  options?: { useEmoji?: boolean; safetyCritical?: boolean; question?: string }
): string => {
  const forceDetailed = hasDetailIntent(options?.question || "")
  const normalizedFromJson = buildMarkdownFromJsonLikeReply(rawReply, forceDetailed)
  let text = (rawReply || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (normalizedFromJson) {
    text = normalizedFromJson
  }

  if (!text) return ""

  const minLengthForSectioning = forceDetailed ? 80 : 120

  if (!hasMarkdownStructure(text) && text.length >= minLengthForSectioning) {
    const sentences = splitSentences(text)
    if (sentences.length >= (forceDetailed ? 2 : 3)) {
      const summaryLine = sentences[0]
      const findings = sentences.slice(1, forceDetailed ? 16 : 7)

      const parts = [
        `🙂 ${summaryLine}`,
        "",
        ...findings.map((item) => `- 🔎 ${item}`),
      ]

      text = parts.join("\n")
    }
  }

  text = ensureDetailedReportMarkdown(text, forceDetailed)

  if (options?.useEmoji && !options?.safetyCritical) {
    text = enrichMarkdownWithFriendlyEmojis(text, forceDetailed ? 22 : 16)
  }

  return sanitizeMarkdownBullets(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const invokeOpenAIWithRetry = async (args: {
  apiKey: string
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
}): Promise<{ reply: string; model: string }> => {
  const candidates = getOpenAIModelCandidates()
  let lastError: any = null

  for (const model of candidates) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort("request_timeout"), 18_000)

      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${args.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: args.messages,
            reasoning_effort: "low",
            temperature: 0.35,
            top_p: 0.95,
            max_completion_tokens: 1800,
          }),
          signal: controller.signal,
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error?.message || `OpenAI report chat failed (${response.status})`)
        }

        const rawContent = data?.choices?.[0]?.message?.content
        const reply =
          typeof rawContent === "string"
            ? rawContent.trim()
            : Array.isArray(rawContent)
              ? rawContent
                .map((part: any) => (typeof part?.text === "string" ? part.text.trim() : ""))
                .find((text: string) => text.length > 0) || ""
              : ""

        if (!reply) {
          throw new Error("OpenAI returned empty report chat response.")
        }

        return { reply, model }
      } catch (error) {
        lastError = error
        if (attempt < 2) {
          await sleep(300 * attempt)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  throw new Error(lastError?.message || "OpenAI report chat unavailable")
}

const createServiceClient = () => {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) {
    throw new Error("Supabase service role is not configured.")
  }
  return createClient(url, key)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const requestStartedAt = Date.now()
    const authHeader = req.headers.get("authorization") || ""
    const accessToken = authHeader.replace("Bearer ", "").trim()
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const serviceClient = createServiceClient()
    const {
      data: { user },
      error: userError,
    } = await serviceClient.auth.getUser(accessToken)

    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const rateLimit = await evaluateRateLimit({
      serviceClient,
      userId: user.id,
      action: "medical_report_chat",
    })
    if (rateLimit.blocked) {
      return new Response(
        JSON.stringify({
          success: false,
          message: rateLimit.burst
            ? "Too many rapid messages. Please wait a moment and try again."
            : "Daily AI limit reached. Please try again later.",
          retryAfterMs: rateLimit.retryAfterMs,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const body = await req.json()
    const reportId = typeof body?.reportId === "string" ? body.reportId : ""
    const question = clipText(typeof body?.question === "string" ? body.question : "", 2000)
    const responseLanguage = typeof body?.responseLanguage === "string" ? body.responseLanguage.trim().toLowerCase() : "auto"
    const forceEnglishResponse = responseLanguage === "en" || responseLanguage === "english"
    if (!reportId) {
      throw new Error("reportId is required.")
    }
    if (!question) {
      throw new Error("question is required.")
    }

    const { data: report, error: reportError } = await serviceClient
      .from("medical_reports")
      .select("id, patient_id, file_name, report_type, analysis_status, ai_summary, ai_key_points, ai_structured, extracted_text")
      .eq("id", reportId)
      .eq("patient_id", user.id)
      .is("deleted_at", null)
      .single()

    if (reportError || !report) {
      throw new Error("Report not found for this user.")
    }

    const normalizedReportInsights = getNormalizedReportInsights(report.ai_summary || "", report.ai_key_points)
    const reportSummary = normalizedReportInsights.summary
    const keyPoints = normalizedReportInsights.keyPoints
    const cautionFlags = toTextArray(report.ai_structured?.caution_flags ?? report.ai_structured?.cautionFlags)
    const followUps = toTextArray(report.ai_structured?.suggested_followups ?? report.ai_structured?.suggestedFollowups)
    const prescriptionDetails =
      (report.ai_structured?.prescription_details && typeof report.ai_structured.prescription_details === "object")
        ? report.ai_structured.prescription_details
        : {}
    const prescriptionMedicationLines = toMedicationLabelArray(
      prescriptionDetails?.medications || report.ai_structured?.medications
    )
    const prescriptionInstructions = toTextArray(
      prescriptionDetails?.general_instructions || prescriptionDetails?.instructions
    )
    const prescriptionDiagnosis = clipText(String(prescriptionDetails?.diagnosis || ""), 220)
    const prescriptionFollowupDate = clipText(
      String(prescriptionDetails?.followup_date || prescriptionDetails?.followupDate || ""),
      80
    )
    const prescriptionDoctorName = clipText(
      String(prescriptionDetails?.doctor_name || prescriptionDetails?.doctorName || ""),
      100
    )
    const normalizedReportType = String(report.report_type || "").trim().toLowerCase()
    const isPrescriptionReportContext =
      normalizedReportType.includes("prescription") ||
      prescriptionMedicationLines.length > 0 ||
      prescriptionInstructions.length > 0 ||
      Boolean(prescriptionDoctorName) ||
      Boolean(prescriptionDiagnosis)
    const asksPrescriptionQuestion = isPrescriptionLikeQuestion(question)
    const patientFriendlyExplanation =
      clipText(report.ai_structured?.patient_friendly_explanation || "", REPORT_CHAT_EXPLANATION_CHARS) ||
      normalizedReportInsights.patientExplanation
    const extractedText = clipText(report.extracted_text || "", REPORT_CHAT_EXTRACTED_TEXT_CHARS)

    if ((report.analysis_status === "pending" || report.analysis_status === "processing") && !reportSummary) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Report is still being scanned.",
          data: {
            reply: "Your report scan is still in progress. Please wait a bit and ask again.",
            status: report.analysis_status,
            source: "fallback",
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const userInsertPromise = serviceClient.from("medical_report_chat_messages").insert({
      report_id: reportId,
      patient_id: user.id,
      role: "user",
      content: question,
    })
      .then(() => null)
      .catch((error: any) => {
        console.warn("medical-report-chat user_message_insert_failed:", error?.message || error)
        return null
      })

    const historyStartedAt = Date.now()
    const { data: recentMessages } = await serviceClient
      .from("medical_report_chat_messages")
      .select("role, content, created_at")
      .eq("report_id", reportId)
      .eq("patient_id", user.id)
      .order("created_at", { ascending: false })
      .limit(REPORT_CHAT_HISTORY_LIMIT)
    const historyLoadMs = Date.now() - historyStartedAt
    const orderedRecentMessages = [...(recentMessages || [])].reverse()

    const formattedHistory = orderedRecentMessages.map((message: any) => ({
      role: (message.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: clipText(typeof message?.content === "string" ? message.content : "", REPORT_CHAT_HISTORY_ITEM_CHARS),
    }))

    const historyText = orderedRecentMessages
      .map((message: any) => `${message.role === "assistant" ? "Assistant" : "User"}: ${clipText(message.content || "", REPORT_CHAT_HISTORY_ITEM_CHARS)}`)
      .join("\n")

    if (asksPrescriptionQuestion && !isPrescriptionReportContext) {
      const guardedReply = buildNonPrescriptionGuidanceReply({
        reportType: normalizedReportType || "medical_report",
        keyPoints,
        cautionFlags,
        followUps,
      })
      const safetyCritical = hasSafetyCriticalSignal(`${question}\n${guardedReply}`)
      const trimmedReply = clipText(
        formatReportAssistantReply(guardedReply, {
          useEmoji: false,
          safetyCritical,
          question,
        }) || guardedReply,
        REPORT_CHAT_REPLY_MAX_CHARS
      )

      const persistStartedAt = Date.now()
      await Promise.all([
        userInsertPromise,
        serviceClient.from("medical_report_chat_messages").insert({
          report_id: reportId,
          patient_id: user.id,
          role: "assistant",
          content: trimmedReply,
        }),
        serviceClient.from("ai_agent_actions").insert({
          user_id: user.id,
          conversation_id: reportId,
          action: "medical_report_chat",
          status: "fallback",
          payload: {
            source: "guard_non_prescription",
            model: null,
            reportType: normalizedReportType || "medical_report",
          },
        }),
      ])
      const persistMs = Date.now() - persistStartedAt

      return new Response(
        JSON.stringify({
          success: true,
          message: "Report question answered.",
          data: {
            reply: trimmedReply,
            reportId,
            source: "fallback",
            model: null,
            timings: {
              historyLoadMs,
              aiMs: 0,
              persistMs,
              processingMs: Date.now() - requestStartedAt,
            },
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const needsDeepContext = hasDetailIntent(question) || !reportSummary
    const contextText = [
      `Report file: ${report.file_name || "uploaded-report"}`,
      `Report type: ${report.report_type || "medical_report"}`,
      reportSummary ? `Summary: ${reportSummary}` : "",
      patientFriendlyExplanation ? `Patient explanation: ${patientFriendlyExplanation}` : "",
      keyPoints.length > 0 ? `Key points: ${keyPoints.join(" | ")}` : "",
      cautionFlags.length > 0 ? `Caution flags: ${cautionFlags.join(" | ")}` : "",
      followUps.length > 0 ? `Suggested followups: ${followUps.join(" | ")}` : "",
      `Prescription context detected: ${isPrescriptionReportContext ? "yes" : "no"}`,
      prescriptionDoctorName ? `Prescription doctor: ${prescriptionDoctorName}` : "",
      prescriptionDiagnosis ? `Prescription diagnosis/condition: ${prescriptionDiagnosis}` : "",
      prescriptionMedicationLines.length > 0 ? `Prescription medicines: ${prescriptionMedicationLines.join(" | ")}` : "",
      prescriptionInstructions.length > 0 ? `Prescription instructions: ${prescriptionInstructions.join(" | ")}` : "",
      prescriptionFollowupDate ? `Prescription follow-up date: ${prescriptionFollowupDate}` : "",
      needsDeepContext && extractedText ? `Extracted report text (trimmed): ${extractedText}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const systemPrompt = [
      "You are CD4 Medical Report Assistant.",
      "Answer only from this report context.",
      "If user asks unrelated/non-medical topic, politely refuse and redirect to report-related question.",
      forceEnglishResponse
        ? "Respond only in clear professional English. Do not use Hindi or mixed-script output."
        : "Mirror user's language/script from latest message.",
      "Keep response factual, simple, and clear; if data is missing, say 'not clearly visible in report'.",
      "No diagnosis certainty and no dosage/treatment prescription.",
      "You may explain prescription details already visible in uploaded report, but never invent new medicine instructions.",
      isPrescriptionReportContext
        ? "If prescription context is detected, present medicines in clean point-wise format: Medicine | Dose | Frequency | Timing | Duration. Use 'not clearly visible in report' for missing fields."
        : "If this is not a prescription report, never generate a prescription; instead provide report-based guidance and ask user to consult doctor for actual Rx.",
      "Return readable Markdown text only (no raw JSON).",
      "Prefer natural flow: answer the question directly, then give only the few report points needed to support it.",
      "For important values explain test name, observed value, reference range (if visible), and simple meaning.",
      "Use friendly emojis in non-critical replies; keep urgent/warning lines serious.",
    ].join("\n")

    const userPrompt = [
      "Report context:",
      clipText(contextText, 8000),
      "",
      "Conversation so far:",
      clipText(historyText || "No prior messages.", 2400),
      "",
      "Formatting intent:",
      needsDeepContext
        ? "User asked for detailed explanation. Give a short conclusion first, then focused point-wise explanation with visible values and meaning; remove repetition."
        : "Use concise-friendly explanation unless the question clearly asks for deep detail.",
      "",
      `Latest user question: ${question}`,
    ].join("\n")

    const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim()
    const geminiApiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim()
    if (!openAiApiKey && !geminiApiKey) {
      throw new Error("OPENAI_API_KEY (preferred) or GEMINI_API_KEY must be configured on Edge runtime.")
    }
    console.log("[medical-report-chat] Provider Mode -> OpenAI primary, Gemini fallback")
    console.log(`[medical-report-chat] Keys Present -> OpenAI: ${!!openAiApiKey} | Gemini: ${!!geminiApiKey}`)
    console.log(`[medical-report-chat] Configured OpenAI Model -> ${getOpenAIModelName()}`)
    console.log(`[medical-report-chat] OpenAI Model Candidates -> ${getOpenAIModelCandidates().join(", ")}`)
    if (geminiApiKey) {
      console.log(`[medical-report-chat] Configured Gemini Model -> ${getGeminiModelName()}`)
    }

    let reply = ""
    let source: "openai" | "gemini" | "fallback" = "fallback"
    let selectedModel: string | null = null
    let aiMs = 0

    if (!isLikelyMedicalText(contextText)) {
      throw new Error("This conversation is only for medical reports. Upload a lab/imaging/prescription report to continue.")
    }

    const openAiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...formattedHistory,
      { role: "user" as const, content: userPrompt },
    ]

    if (openAiApiKey) {
      try {
        const aiStartedAt = Date.now()
        const openAiResult = await invokeOpenAIWithRetry({
          apiKey: openAiApiKey,
          messages: openAiMessages,
        })
        aiMs = Date.now() - aiStartedAt
        reply = openAiResult.reply
        source = "openai"
        selectedModel = openAiResult.model
      } catch (openAiError: any) {
        console.error("medical-report-chat openai_failed:", openAiError?.message || openAiError)
        if (!geminiApiKey) {
          throw new Error(openAiError?.message || "OpenAI report chat failed")
        }
      }
    }

    if (!reply && geminiApiKey) {
      try {
        const aiStartedAt = Date.now()
        const geminiResult = await invokeGeminiWithRetry({
          apiKey: geminiApiKey,
          systemPrompt,
          formattedHistory,
          question: userPrompt,
        })
        aiMs = Date.now() - aiStartedAt
        reply = geminiResult.reply
        source = "gemini"
        selectedModel = geminiResult.model
      } catch (geminiError: any) {
        console.error("medical-report-chat gemini_failed:", geminiError?.message || geminiError)
        throw new Error(geminiError?.message || "Gemini report chat failed")
      }
    }

    if (!reply) {
      throw new Error("AI provider returned empty reply.")
    }

    const safetyCritical = hasSafetyCriticalSignal(`${question}\n${reply}`)
    const formattedReply = formatReportAssistantReply(reply, {
      useEmoji: true,
      safetyCritical,
      question,
    })
    const trimmedReply = clipText(formattedReply || reply, REPORT_CHAT_REPLY_MAX_CHARS)

    const persistStartedAt = Date.now()
    await Promise.all([
      userInsertPromise,
      serviceClient.from("medical_report_chat_messages").insert({
        report_id: reportId,
        patient_id: user.id,
        role: "assistant",
        content: trimmedReply,
      }),
      serviceClient.from("ai_agent_actions").insert({
        user_id: user.id,
        conversation_id: reportId,
        action: "medical_report_chat",
        status: source === "fallback" ? "fallback" : "success",
        payload: {
          model: selectedModel,
          source,
        },
      }),
    ])
    const persistMs = Date.now() - persistStartedAt

    return new Response(
      JSON.stringify({
        success: true,
        message: "Report question answered.",
        data: {
          reply: trimmedReply,
          reportId,
          source,
          model: selectedModel,
          timings: {
            historyLoadMs,
            aiMs,
            persistMs,
            processingMs: Date.now() - requestStartedAt,
          },
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (error) {
    console.error("medical-report-chat failed:", error?.message || error)
    return new Response(
      JSON.stringify({
        success: false,
        message: error?.message || "Failed to answer report question.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
