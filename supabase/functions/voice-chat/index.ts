// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DEFAULT_TTS_MODEL = Deno.env.get("VOICE_MODEL")?.trim() || "gpt-4o-tts"
const DEFAULT_TTS_FALLBACK_MODEL = Deno.env.get("VOICE_MODEL_FALLBACK")?.trim() || "tts-1"
const DEFAULT_STT_MODEL = Deno.env.get("VOICE_TRANSCRIBE_MODEL")?.trim() || "gpt-4o-transcribe"
const DEFAULT_STT_FALLBACK_MODEL = Deno.env.get("VOICE_TRANSCRIBE_MODEL_FALLBACK")?.trim() || "whisper-1"
const DEFAULT_SCOPE_MODEL = Deno.env.get("VOICE_SCOPE_MODEL")?.trim() || "gpt-5.6-luna"
const DEFAULT_SCOPE_FALLBACK_MODEL = Deno.env.get("VOICE_SCOPE_MODEL_FALLBACK")?.trim() || "gpt-4o-mini"
const DEFAULT_TTS_MODE: "fast" | "premium" =
  (Deno.env.get("VOICE_DEFAULT_TTS_MODE") || "premium").trim().toLowerCase() === "fast"
    ? "fast"
    : "premium"
const DEFAULT_AUDIO_MIME_TYPE = Deno.env.get("VOICE_AUDIO_MIME_TYPE")?.trim() || "audio/mpeg"
const DEFAULT_AUDIO_RESPONSE_FORMAT = DEFAULT_AUDIO_MIME_TYPE.includes("wav")
  ? "wav"
  : DEFAULT_AUDIO_MIME_TYPE.includes("ogg") || DEFAULT_AUDIO_MIME_TYPE.includes("opus")
    ? "opus"
    : "mp3"
const MAX_AUDIO_SECONDS = Math.max(5, Math.min(120, Number(Deno.env.get("VOICE_MAX_AUDIO_SECONDS") || "15")))
const MAX_AUDIO_BYTES = Math.max(256_000, Math.min(8_000_000, Number(Deno.env.get("VOICE_MAX_AUDIO_BYTES") || "4000000")))
const VOICE_HISTORY_LIMIT = Math.max(2, Math.min(20, parseEnvInt("VOICE_HISTORY_LIMIT", 10)))
const VOICE_HISTORY_CONTENT_LIMIT = Math.max(80, Math.min(1200, parseEnvInt("VOICE_HISTORY_CONTENT_LIMIT", 260)))
const VOICE_REPLY_TARGET_CHARS = Math.max(220, Math.min(2200, parseEnvInt("VOICE_REPLY_TARGET_CHARS", 900)))
const VOICE_REPLY_TARGET_CHARS_FAST = Math.max(120, Math.min(900, parseEnvInt("VOICE_REPLY_TARGET_CHARS_FAST", 420)))
const DEFAULT_TTS_VOICE = (Deno.env.get("VOICE_TTS_DEFAULT_VOICE") || "nova").trim() || "nova"
const FEMALE_TTS_VOICE = (Deno.env.get("VOICE_TTS_FEMALE_VOICE") || "nova").trim() || "nova"
const MALE_TTS_VOICE = (Deno.env.get("VOICE_TTS_MALE_VOICE") || "onyx").trim() || "onyx"
const VOICE_TTS_SPEED = Math.max(0.85, Math.min(1.25, Number(Deno.env.get("VOICE_TTS_SPEED") || "0.98")))
const VOICE_TTS_STYLE = (Deno.env.get("VOICE_TTS_STYLE") || "Warm, natural, human conversational telemedicine tone. Speak clearly with gentle pacing, subtle pauses, and expressive but calm delivery. Avoid robotic cadence. Keep explanations clinically sensible and easy to understand.").trim()
const VOICE_CHAT_TIMEOUT_MS = Math.max(2000, Math.min(45000, parseEnvInt("VOICE_CHAT_TIMEOUT_MS", 15000)))
const VOICE_TTS_TIMEOUT_MS = Math.max(2000, Math.min(30000, parseEnvInt("VOICE_TTS_TIMEOUT_MS", 15000)))
const VOICE_TTS_MAX_INPUT_CHARS = Math.max(180, Math.min(2200, parseEnvInt("VOICE_TTS_MAX_INPUT_CHARS", 1200)))
const VOICE_TTS_FAST_MAX_INPUT_CHARS = Math.max(80, Math.min(900, parseEnvInt("VOICE_TTS_FAST_MAX_INPUT_CHARS", 520)))

const AI_MESSAGE_LIMIT_PER_WINDOW = Math.max(10, Math.min(1000, parseEnvInt("CHAT_AI_MESSAGE_LIMIT_PER_WINDOW", 20)))
const AI_BURST_LIMIT_MESSAGES = Math.max(2, Math.min(50, parseEnvInt("CHAT_AI_BURST_LIMIT_MESSAGES", 6)))
const AI_BURST_WINDOW_MS = Math.max(10 * 1000, parseEnvInt("CHAT_AI_BURST_WINDOW_MS", 60 * 1000))
const AI_FIRST_BLOCK_MS = Math.max(5 * 60 * 1000, parseEnvInt("CHAT_AI_FIRST_BLOCK_MS", 2 * 60 * 60 * 1000))
const AI_SECOND_BLOCK_MS = Math.max(10 * 60 * 1000, parseEnvInt("CHAT_AI_SECOND_BLOCK_MS", 4 * 60 * 60 * 1000))
const AI_RATE_LIMIT_TZ_OFFSET_MINUTES = 330
const PRO_AI_MESSAGE_LIMIT_PER_WINDOW = (() => {
  const recommendedProFloor = Math.max(120, AI_MESSAGE_LIMIT_PER_WINDOW * 3)
  const configured = parseEnvInt("CHAT_AI_PRO_MESSAGE_LIMIT_PER_WINDOW", recommendedProFloor)
  const normalized = Math.min(3000, configured)
  // Guard against env values that accidentally make Pro equal to free tier.
  return Math.max(AI_MESSAGE_LIMIT_PER_WINDOW + 1, normalized)
})()
const PRO_AI_BURST_LIMIT_MESSAGES = (() => {
  const recommendedProBurstFloor = Math.max(12, AI_BURST_LIMIT_MESSAGES * 2)
  const configured = parseEnvInt("CHAT_AI_PRO_BURST_LIMIT_MESSAGES", recommendedProBurstFloor)
  const normalized = Math.min(200, configured)
  return Math.max(AI_BURST_LIMIT_MESSAGES + 1, normalized)
})()

const normalizeText = (value: string): string =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")

const HINDI_ROMAN_TTS_PATTERN =
  /\b(kya|mujhe|mera|meri|mere|mai|main|haan|han|nahi|nahin|hai|hain|kar do|kardo|kr do|krdo|chahiye|batao|dikhao|aaj|kal|subah|shaam|raat|dard|bukhar|dawai|doctor se|slot|book kar)\b/i

const isLikelyHindiVoiceText = (value: string): boolean => {
  const raw = (value || "").trim()
  if (!raw) return false
  if (/[\u0900-\u097F]/.test(raw)) return true
  return HINDI_ROMAN_TTS_PATTERN.test(raw)
}

const buildVoiceStyleInstruction = (text: string): string => {
  if (/[\u0900-\u097F]/.test(text || "")) {
    return "Speak only the supplied Devanagari Hindi text, with clear Indian pronunciation and a calm junior-doctor tone. Do not translate it or insert English sentences."
  }
  if (isLikelyHindiVoiceText(text)) {
    return "Speak only the supplied Roman Hindi text with clear Indian pronunciation and a calm junior-doctor tone. Do not translate it, switch to Devanagari, or insert English sentences."
  }
  return `${VOICE_TTS_STYLE} Speak only in English and do not insert Hindi or Hinglish.`
}

const VOICE_MEDICAL_SCOPE_TERMS = [
  "health",
  "medical",
  "doctor",
  "appointment",
  "medicine",
  "tablet",
  "dawai",
  "dava",
  "symptom",
  "pain",
  "dard",
  "fever",
  "bukhar",
  "cold",
  "cough",
  "khansi",
  "flu",
  "headache",
  "sir dard",
  "sar dard",
  "migraine",
  "vomit",
  "nausea",
  "dizziness",
  "injury",
  "fracture",
  "broken",
  "bone",
  "joint",
  "sprain",
  "swelling",
  "bleeding",
  "wound",
  "cut",
  "burn",
  "hand",
  "arm",
  "leg",
  "finger",
  "wrist",
  "ankle",
  "haath",
  "hath",
  "pair",
  "ungli",
  "kalai",
  "toot",
  "toota",
  "tut",
  "tuta",
  "orthopedic",
  "ortho",
  "slot",
  "slots",
  "timing",
  "book",
  "booking",
  "available",
  "availability",
  "milna",
  "timetable",
  "samay",
  "consultation",
  "bp",
  "blood pressure",
  "pulse",
  "sugar",
  "diabetes",
  "thyroid",
  "cholesterol",
  "weight",
  "diet",
  "sleep",
  "anxiety",
  "depression",
  "stress",
  "rash",
  "allergy",
  "period",
  "pregnancy",
  "report",
  "lab",
  "test",
  "cbc",
  "lft",
  "kft",
  "xray",
  "mri",
  "scan",
  "hospital",
  "clinic",
  "heart",
  "chest pain",
  "breathing",
  "asthma",
  "skin",
  "infection",
]

const VOICE_NON_MEDICAL_SCOPE_TERMS = [
  "movie",
  "song",
  "music",
  "cricket score",
  "football score",
  "match score",
  "stock",
  "share price",
  "crypto",
  "bitcoin",
  "coding",
  "code",
  "programming",
  "javascript",
  "react",
  "python",
  "weather",
  "flight",
  "hotel",
  "shopping",
  "joke",
  "meme",
  "politics",
  "election",
  "news",
]

const resolveVoicePreset = (value: unknown): { persona: "male" | "female"; voice: string } => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (normalized === "male" || normalized === "man" || normalized === "onyx") {
    return {
      persona: "male",
      voice: MALE_TTS_VOICE || DEFAULT_TTS_VOICE || "onyx",
    }
  }

  if (normalized === "female" || normalized === "woman" || normalized === "nova") {
    return {
      persona: "female",
      voice: FEMALE_TTS_VOICE || DEFAULT_TTS_VOICE || "nova",
    }
  }

  return {
    persona: "female",
    voice: FEMALE_TTS_VOICE || DEFAULT_TTS_VOICE || "nova",
  }
}

const GENERAL_VOICE_CONCERN_VALUES = new Set(["", "general", "general assistant", "assistant"])

const CONTEXTUAL_HEALTHCARE_FOLLOWUP_PATTERN =
  /\b(yes|yeah|haan|han|hmm|ok|okay|book|booking|book it|confirm|confirmed|go ahead|continue|next|show|more|options|slot|slots|first|second|third|last|same doctor|doctor hi|isi doctor|wahi|yeh wala|this one|that one|consult|appointment|schedule)\b/i

const isMedicalVoiceScope = (text: string): boolean => {
  const normalized = normalizeText(text)
  if (!normalized) return false
  return VOICE_MEDICAL_SCOPE_TERMS.some((term) => normalized.includes(term))
}

const isClearlyNonMedicalVoiceScope = (text: string): boolean => {
  const normalized = normalizeText(text)
  if (!normalized) return false
  return VOICE_NON_MEDICAL_SCOPE_TERMS.some((term) => normalized.includes(term))
}

const getFastMedicalScopeDecision = (
  text: string,
  concern: string,
): { isMedical: boolean; source: "fast_path"; reason: string; modelUsed: null } | null => {
  const normalizedText = normalizeText(text)
  if (!normalizedText) return null

  const normalizedConcern = normalizeText(concern)
  const medicalMatchCount = VOICE_MEDICAL_SCOPE_TERMS.reduce(
    (count, term) => count + (normalizedText.includes(term) ? 1 : 0),
    0,
  )
  const hasExplicitMedicalConcern =
    normalizedConcern.length > 0 && !GENERAL_VOICE_CONCERN_VALUES.has(normalizedConcern)
  const isContextualHealthcareFollowUp =
    hasExplicitMedicalConcern &&
    normalizedText.split(/\s+/).filter(Boolean).length <= 8 &&
    CONTEXTUAL_HEALTHCARE_FOLLOWUP_PATTERN.test(normalizedText)
  const hasStrongMedicalSignal = /(symptom|symptoms|doctor|appointment|medicine|tablet|pain|fever|cough|cold|headache|migraine|report|test|scan|period|pregnancy|rash|allergy|infection|breath|breathing|dard|bukhar|dawai|sugar|bp|injury|fracture|broken|bone|joint|sprain|swelling|bleeding|wound|burn|orthopedic|ortho|haath|hath|hand|arm|leg|finger|wrist|ankle|toot|toota|tut|tuta)\b/.test(
    normalizedText,
  )
  const hasStrongNonMedicalSignal = isClearlyNonMedicalVoiceScope(normalizedText)

  if (hasStrongNonMedicalSignal && medicalMatchCount === 0 && !hasStrongMedicalSignal && !isContextualHealthcareFollowUp) {
    return {
      isMedical: false,
      source: "fast_path",
      reason: "non_medical_fast_path",
      modelUsed: null,
    }
  }

  if (medicalMatchCount >= 2 || (medicalMatchCount >= 1 && hasStrongMedicalSignal)) {
    return {
      isMedical: true,
      source: "fast_path",
      reason: "medical_fast_path",
      modelUsed: null,
    }
  }

  if (isContextualHealthcareFollowUp) {
    return {
      isMedical: true,
      source: "fast_path",
      reason: "context_followup_fast_path",
      modelUsed: null,
    }
  }

  return null
}

const getVoiceScopeMessage = (text: string): string => {
  const raw = text || ""
  const hasDevanagari = /[\u0900-\u097F]/.test(raw)
  const normalized = normalizeText(raw)
  const looksHindiRoman = /\b(kya|mujhe|mera|meri|hai|nahi|doctor|dawai|bukhar|sir|dard)\b/.test(normalized)

  if (hasDevanagari || looksHindiRoman) {
    if (hasDevanagari) {
      return "मैं केवल स्वास्थ्य और चिकित्सा से जुड़े विषयों पर मदद कर सकता हूँ। कृपया अपने लक्षण, रिपोर्ट, दवाइयों या डॉक्टर परामर्श से जुड़ा सवाल पूछें।"
    }
    return "Main sirf health aur medical topics par madad kar sakta hoon. Kripya apne symptoms, reports, medicines, ya doctor consultation se related sawal poochiye."
  }
  return "I can only help with health and medical topics. Please ask about symptoms, reports, medicines, or doctor consultation."
}

const parseScopeClassifierResult = (raw: string): { isMedical: boolean; reason: string } | null => {
  const input = (raw || "").trim()
  if (!input) return null

  try {
    const parsed = JSON.parse(input)
    if (typeof parsed?.is_medical === "boolean") {
      return {
        isMedical: parsed.is_medical,
        reason: typeof parsed?.reason === "string" ? parsed.reason.trim().slice(0, 180) : "",
      }
    }
  } catch {
    // best-effort fallback below
  }

  const normalized = normalizeText(input)
  if (normalized.includes('"is_medical":true') || normalized.includes('"is_medical": true')) {
    return { isMedical: true, reason: "parsed_from_text" }
  }
  if (normalized.includes('"is_medical":false') || normalized.includes('"is_medical": false')) {
    return { isMedical: false, reason: "parsed_from_text" }
  }
  return null
}

const classifyMedicalScopeByAI = async (args: {
  text: string
  concern?: string
  history?: Array<{ role?: string; content?: string }>
  openAiKey: string
  model: string
  fallbackModel: string
}): Promise<{ isMedical: boolean; reason: string; modelUsed: string }> => {
  const contextConcern = typeof args.concern === "string" ? args.concern.trim() : ""
  const recentHistory = (Array.isArray(args.history) ? args.history : [])
    .slice(-6)
    .map((item) => {
      const role = item?.role === "assistant" ? "AI" : "User"
      const content = typeof item?.content === "string" ? item.content.trim().replace(/\s+/g, " ") : ""
      return content ? `${role}: ${content.slice(0, 180)}` : ""
    })
    .filter(Boolean)
    .join("\n")
  const prompt = `Classify if user query is medical/health related for a healthcare voice assistant.
Return strict JSON only:
{"is_medical": true|false, "reason": "short_reason"}

Medical includes symptoms, diseases, diagnosis, injuries, fracture/bone/joint issues, first-aid concerns, lab reports, medicine, treatment, diet, wellness, mental health, doctor/hospital/appointment.
Non-medical includes coding, entertainment, jokes, finance, travel, shopping, politics, general trivia.
If mixed, mark true only when medical help is clearly requested.
Short follow-ups like "book it", "first slot", "yes continue", or "show more options" should be marked true only when they clearly refer to the ongoing healthcare context below.
If the user switches topic to politics, coding, news, or another unrelated subject, mark false even if prior messages were medical.

Selected concern/context: ${contextConcern || "General Assistant"}
Recent conversation context:
${recentHistory || "No recent history."}

Latest user query: ${args.text}`

  const requestOnce = async (modelName: string) => {
    const controller = new AbortController()
    // Scope routing must never make a voice reply wait for a long secondary AI call.
    const timeout = setTimeout(() => controller.abort("scope_timeout"), 2500)

    try {
      const isGpt56 = /^gpt-5\.6(?:-|$)/i.test(modelName)
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.openAiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          ...(isGpt56
            ? { reasoning_effort: "none", max_completion_tokens: 90 }
            : { temperature: 0, max_tokens: 90 }),
          messages: [
            {
              role: "system",
              content: "You are a strict JSON classifier for medical scope routing.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
        signal: controller.signal,
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error?.message || "scope_classifier_failed")
      }
      const raw = payload?.choices?.[0]?.message?.content
      const content = typeof raw === "string" ? raw : Array.isArray(raw)
        ? raw.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("\n")
        : ""
      const parsed = parseScopeClassifierResult(content)
      if (!parsed) {
        throw new Error("scope_classifier_parse_failed")
      }
      return { ...parsed, modelUsed: modelName }
    } finally {
      clearTimeout(timeout)
    }
  }

  try {
    return await requestOnce(args.model)
  } catch (error) {
    if (args.fallbackModel && args.fallbackModel !== args.model) {
      return await requestOnce(args.fallbackModel)
    }
    throw error
  }
}

function parseEnvInt(key: string, fallback: number): number {
  const raw = Number((Deno.env.get(key) || "").trim())
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

const extractSentences = (buffer: string): { sentences: string[], rest: string } => {
  const sentences: string[] = [];
  let current = buffer;
  const softChunkTarget = 140;
  const hardChunkLimit = 220;

  while (true) {
    const match = current.match(/[.?!।\n]/);
    if (match && match.index !== undefined) {
      const boundaryIdx = match.index;
      const sentence = current.slice(0, boundaryIdx + 1);
      sentences.push(sentence);
      current = current.slice(boundaryIdx + 1);
      continue;
    }

    if (current.length < softChunkTarget) {
      break;
    }

    let fallbackBoundary = -1;
    const softSlice = current.slice(0, hardChunkLimit);
    const candidateBoundaries = [
      softSlice.lastIndexOf(", "),
      softSlice.lastIndexOf("; "),
      softSlice.lastIndexOf(": "),
      softSlice.lastIndexOf(" - "),
      softSlice.lastIndexOf(" "),
    ];
    for (const candidate of candidateBoundaries) {
      if (candidate >= softChunkTarget * 0.45) {
        fallbackBoundary = candidate;
        break;
      }
    }

    if (fallbackBoundary < 0) {
      fallbackBoundary = Math.min(current.length, hardChunkLimit);
    } else {
      fallbackBoundary += 1;
    }

    const sentence = current.slice(0, fallbackBoundary).trim();
    if (!sentence) {
      break;
    }
    sentences.push(sentence);
    current = current.slice(fallbackBoundary);
  }

  return { sentences, rest: current };
};

const concatenateBase64Audio = (chunks: string[]): string => {
  const validChunks = chunks.filter(Boolean);
  if (validChunks.length === 0) return "";
  if (validChunks.length === 1) return validChunks[0];
  
  let totalLength = 0;
  const binaryChunks = validChunks.map(base64 => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    totalLength += bytes.length;
    return bytes;
  });

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const bytes of binaryChunks) {
    merged.set(bytes, offset);
    offset += bytes.length;
  }

  let binary = '';
  for (let i = 0; i < merged.byteLength; i++) {
    binary += String.fromCharCode(merged[i]);
  }
  return btoa(binary);
};

type ParsedSseEvent = {
  event: string
  data: any
}

const parseSseBuffer = (buffer: string): { events: ParsedSseEvent[]; rest: string } => {
  const normalized = buffer.replace(/\r\n/g, "\n")
  const events: ParsedSseEvent[] = []
  let cursor = 0

  while (true) {
    const boundary = normalized.indexOf("\n\n", cursor)
    if (boundary < 0) break

    const block = normalized.slice(cursor, boundary).trim()
    cursor = boundary + 2
    if (!block) continue

    let eventName = "message"
    const dataParts: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message"
      } else if (line.startsWith("data:")) {
        dataParts.push(line.slice(5).trim())
      }
    }

    const rawData = dataParts.join("\n")
    if (!rawData) continue
    let data: any = rawData
    try {
      data = JSON.parse(rawData)
    } catch {
      // keep raw text when payload is non-JSON
    }
    events.push({ event: eventName, data })
  }

  return {
    events,
    rest: normalized.slice(cursor),
  }
}

const readSseFinalPayload = async (
  response: Response,
  onDelta?: (text: string) => void,
): Promise<any> => {
  const reader = response.body?.getReader?.()
  if (!reader) {
    throw new Error("stream_reader_unavailable")
  }

  const decoder = new TextDecoder()
  let buffer = ""
  let finalPayload: any = null
  let streamedText = ""
  let shouldStop = false

  const ingestEvent = (event: ParsedSseEvent) => {
    if (event.event === "error") {
      const errorMessage =
        typeof event.data?.message === "string" && event.data.message.trim()
          ? event.data.message.trim()
          : "AI streaming failed."
      throw new Error(errorMessage)
    }

    if (event.event === "delta") {
      const chunk =
        typeof event.data?.text === "string"
          ? event.data.text
          : typeof event.data === "string"
            ? event.data
            : ""
      if (chunk) {
        streamedText += chunk
        onDelta?.(chunk)
      }
      return
    }

    if (event.event === "done") {
      finalPayload = event.data
      shouldStop = true
      return
    }

    if (event.event === "message") {
      const payload = event.data
      const looksLikeStructuredPayload =
        payload &&
        typeof payload === "object" &&
        (
          payload.success === true ||
          typeof payload?.data?.reply === "string" ||
          typeof payload?.data?.text === "string" ||
          Boolean(payload?.data?.rateLimit)
        )
      if (looksLikeStructuredPayload) {
        finalPayload = payload
        shouldStop = true
        return
      }
      if (typeof payload === "string" && payload.trim()) {
        streamedText += payload
        onDelta?.(payload)
      }
    }
  }

  while (!shouldStop) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseBuffer(buffer)
    buffer = parsed.rest
    for (const event of parsed.events) {
      ingestEvent(event)
      if (shouldStop) break
    }
  }

  const tail = decoder.decode()
  if (tail) {
    buffer += tail
    const parsed = parseSseBuffer(buffer)
    for (const event of parsed.events) {
      ingestEvent(event)
      if (shouldStop) break
    }
  }

  if (!finalPayload && streamedText.trim()) {
    finalPayload = {
      success: true,
      data: {
        reply: streamedText.trim(),
        source: "stream",
      },
    }
  }

  if (!finalPayload) {
    throw new Error("Stream completed without payload")
  }

  return finalPayload
}

const createSseDoneResponse = (payload: any) => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(payload)}\n\n`))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

const encodeSseEvent = (event: string, payload: any): Uint8Array => {
  const encoder = new TextEncoder()
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

const getDayWindowInOffset = (now: Date, offsetMinutes: number) => {
  const utcMs = now.getTime()
  const offsetMs = offsetMinutes * 60 * 1000
  const shifted = new Date(utcMs + offsetMs)
  const year = shifted.getUTCFullYear()
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

const ACTIVE_PRO_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "grace"])

const hasActiveProWindow = (row: any, nowMs: number): boolean => {
  if (!row || typeof row !== "object") return false
  const status = String(row?.status || "").trim().toLowerCase()
  if (!ACTIVE_PRO_SUBSCRIPTION_STATUSES.has(status)) return false
  const expiresMs = parseIsoToMs(row?.expires_at)
  return expiresMs === null || expiresMs > nowMs
}

const resolveVoicePlanTier = async (args: { serviceClient: any; userId: string; nowMs: number }) => {
  if (!args.serviceClient || !args.userId) {
    return { plan: "free", isPro: false, subscriptionId: null, billingCycle: null, paymentId: null }
  }

  try {
    const { data, error } = await args.serviceClient
      .from("user_subscriptions")
      .select("id, status, expires_at, billing_cycle, payment_id")
      .eq("user_id", args.userId)
      .eq("plan_code", "pro")
      .in("status", ["active", "trialing", "grace"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data || !hasActiveProWindow(data, args.nowMs)) {
      return { plan: "free", isPro: false, subscriptionId: null, billingCycle: null, paymentId: null }
    }

    return {
      plan: "pro",
      isPro: true,
      subscriptionId: data.id || null,
      billingCycle: data.billing_cycle || null,
      paymentId: data.payment_id || null,
    }
  } catch (tierError) {
    console.warn("[voice-chat] plan tier lookup failed, using free tier:", tierError)
    return { plan: "free", isPro: false, subscriptionId: null, billingCycle: null, paymentId: null }
  }
}


const evaluateRateLimit = async (args: { serviceClient: any; userId: string; action: string; now?: Date }) => {
  if (!args.serviceClient) {
    return {
      blocked: false,
      blockType: "none",
      used: 0,
      remaining: AI_MESSAGE_LIMIT_PER_WINDOW,
      burstUsed: 0,
      retryAfterMs: 0,
      burst: false,
      limit: AI_MESSAGE_LIMIT_PER_WINDOW,
      burstLimit: AI_BURST_LIMIT_MESSAGES,
      burstWindowMs: AI_BURST_WINDOW_MS,
      plan: "free",
      isPro: false,
      subscriptionId: null,
      billingCycle: null,
      paymentId: null,
      blockLevel: 0,
      blockHours: 0,
      blockUntil: null,
    }
  }
  const now = args.now || new Date()
  const nowMs = now.getTime()
  const dayWindow = getDayWindowInOffset(now, AI_RATE_LIMIT_TZ_OFFSET_MINUTES)
  const tier = await resolveVoicePlanTier({
    serviceClient: args.serviceClient,
    userId: args.userId,
    nowMs,
  })
  const limit = tier.isPro ? PRO_AI_MESSAGE_LIMIT_PER_WINDOW : AI_MESSAGE_LIMIT_PER_WINDOW
  const burstLimit = tier.isPro ? PRO_AI_BURST_LIMIT_MESSAGES : AI_BURST_LIMIT_MESSAGES

  const burstWindowStartIso = new Date(nowMs - AI_BURST_WINDOW_MS).toISOString()
  const { data: burstRows } = await args.serviceClient
    .from("ai_agent_actions")
    .select("created_at")
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .gte("created_at", burstWindowStartIso)
    .order("created_at", { ascending: true })
    .limit(burstLimit)
  const burstUsed = Array.isArray(burstRows) ? burstRows.length : 0
  if (burstUsed >= burstLimit) {
    const oldest = burstRows?.[0]?.created_at ? parseIsoToMs(burstRows[0].created_at) : null
    const retryAfterMs = oldest ? Math.max(1000, AI_BURST_WINDOW_MS - Math.max(0, nowMs - oldest)) : AI_BURST_WINDOW_MS
    const blockUntil = new Date(nowMs + retryAfterMs).toISOString()
    return {
      blocked: true,
      burst: true,
      blockType: "burst",
      retryAfterMs,
      used: 0,
      remaining: limit,
      burstUsed,
      limit,
      burstLimit,
      burstWindowMs: AI_BURST_WINDOW_MS,
      plan: tier.plan,
      isPro: tier.isPro,
      subscriptionId: tier.subscriptionId,
      billingCycle: tier.billingCycle,
      paymentId: tier.paymentId,
      blockLevel: 0,
      blockHours: Math.ceil(retryAfterMs / (60 * 60 * 1000)),
      blockUntil,
    }
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
  if (used >= limit) {
    const retryAfterMs = Math.max(1000, dayWindow.endMs - nowMs)
    const blockUntil = new Date(nowMs + retryAfterMs).toISOString()
    return {
      blocked: true,
      burst: false,
      blockType: "daily",
      retryAfterMs,
      used,
      remaining: 0,
      burstUsed,
      limit,
      burstLimit,
      burstWindowMs: AI_BURST_WINDOW_MS,
      plan: tier.plan,
      isPro: tier.isPro,
      subscriptionId: tier.subscriptionId,
      billingCycle: tier.billingCycle,
      paymentId: tier.paymentId,
      blockLevel: 1,
      blockHours: Math.ceil(retryAfterMs / (60 * 60 * 1000)),
      blockUntil,
    }
  }

  return {
    blocked: false,
    burst: false,
    blockType: "none",
    retryAfterMs: 0,
    used,
    remaining: Math.max(0, limit - used),
    burstUsed,
    limit,
    burstLimit,
    burstWindowMs: AI_BURST_WINDOW_MS,
    plan: tier.plan,
    isPro: tier.isPro,
    subscriptionId: tier.subscriptionId,
    billingCycle: tier.billingCycle,
    paymentId: tier.paymentId,
    blockLevel: 0,
    blockHours: 0,
    blockUntil: null,
  }
}

const bufferToBlob = (buffer: ArrayBuffer, type: string) => new Blob([buffer], { type })

const transcribeAudio = async (audioFile: File, model: string, fallbackModel: string, openAiKey: string) => {
  const form = new FormData()
  form.append("file", audioFile)
  const candidateModels = Array.from(new Set([model, fallbackModel, "whisper-1"].filter(Boolean)))
  let lastError = "Transcription failed"

  for (const candidate of candidateModels) {
    form.set("model", candidate)
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: form,
    })

    if (response.ok) {
      const data = await response.json()
      return { text: data?.text || "", model: candidate }
    }

    const err = await response.json().catch(() => ({}))
    lastError = err?.error?.message || `Transcription failed for ${candidate}`
    console.warn(`[VoiceChat] STT model failed: ${candidate}. ${lastError}`)
  }

  throw new Error(lastError)
}

const normalizeHistory = (
  history: unknown,
): Array<{
  role: "user" | "assistant"
  content: string
  doctorRecommendations?: any[]
  bookingSlotOptions?: any[]
  departmentSuggestion?: { id: string; label: string } | null
  consultRecommended?: boolean
  bookingPrompt?: string
}> => {
  if (!Array.isArray(history)) return []
  return history
    .map((item: any) => {
      const role = item?.role === "assistant" ? "assistant" : "user"
      const payload: any = {
        role,
        content: typeof item?.content === "string" ? item.content.trim().slice(0, VOICE_HISTORY_CONTENT_LIMIT) : "",
      }

      if (role === "assistant" && Array.isArray(item?.doctorRecommendations)) {
        payload.doctorRecommendations = item.doctorRecommendations
          .slice(0, 5)
          .map((doctor: any) => ({
            id: typeof doctor?.id === "string" ? doctor.id : typeof doctor?._id === "string" ? doctor._id : "",
            firstName: typeof doctor?.firstName === "string" ? doctor.firstName : "",
            lastName: typeof doctor?.lastName === "string" ? doctor.lastName : "",
            city: typeof doctor?.city === "string" ? doctor.city : "",
            specialization: typeof doctor?.specialization === "string" ? doctor.specialization : "",
          }))
          .filter((doctor: any) => Boolean(doctor.id))
      }

      if (role === "assistant" && Array.isArray(item?.bookingSlotOptions)) {
        payload.bookingSlotOptions = item.bookingSlotOptions
          .slice(0, 6)
          .map((slot: any) => ({
            id: typeof slot?.id === "string" ? slot.id : typeof slot?._id === "string" ? slot._id : "",
            label: typeof slot?.label === "string" ? slot.label : "",
            date: typeof slot?.date === "string" ? slot.date : null,
            startTime: typeof slot?.startTime === "string" ? slot.startTime : null,
            endTime: typeof slot?.endTime === "string" ? slot.endTime : null,
          }))
          .filter((slot: any) => Boolean(slot.id))
      }

      if (
        role === "assistant" &&
        item?.departmentSuggestion &&
        typeof item.departmentSuggestion?.id === "string" &&
        typeof item.departmentSuggestion?.label === "string"
      ) {
        payload.departmentSuggestion = {
          id: item.departmentSuggestion.id.trim(),
          label: item.departmentSuggestion.label.trim(),
        }
      }

      if (role === "assistant" && item?.consultRecommended === true) {
        payload.consultRecommended = true
      }

      if (role === "assistant" && typeof item?.bookingPrompt === "string" && item.bookingPrompt.trim()) {
        payload.bookingPrompt = item.bookingPrompt.trim().slice(0, VOICE_HISTORY_CONTENT_LIMIT)
      }

      return payload
    })
    .filter((item) => item.content.length > 0)
    .slice(-VOICE_HISTORY_LIMIT)
}

const cleanMarkdownForSpeech = (text: string): string => {
  return (text || "")
    .replace(/\*{1,3}/g, "") // Remove bold/italic stars
    .replace(/#{1,6}\s?/g, "") // Remove headers
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // Simplify links
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // Remove code blocks
    .replace(/(\r\n|\n|\r)/gm, " ") // Convert newlines to spaces for smoother breath
    .replace(/\s+/g, " ")
    .trim()
}

const trimVoiceReply = (text: string, ttsMode: "fast" | "premium" = "premium"): string => {
  // Use regex that preserves newlines but cleans up multiple spaces/tabs
  const normalized = (text || "").replace(/[ \t]+/g, " ").trim()
  if (ttsMode !== "fast") {
    // In premium mode, avoid aggressive trimming; keep full response unless extremely long.
    return normalized.length <= VOICE_TTS_MAX_INPUT_CHARS
      ? normalized
      : `${normalized.slice(0, VOICE_TTS_MAX_INPUT_CHARS - 1).trimEnd()}…`
  }
  const structuredDetailHint =
    /\b(slot|slots|appointment|booking|doctor|doctors|specialist|available|consult|next step|next steps)\b/i.test(
      normalized,
    ) || /\d+\.\s|###|\n/.test(text || "")
  const baseTarget = ttsMode === "fast" ? VOICE_REPLY_TARGET_CHARS_FAST : VOICE_REPLY_TARGET_CHARS
  const targetChars = structuredDetailHint
    ? Math.max(baseTarget, ttsMode === "fast" ? 520 : 260)
    : baseTarget

  if (!normalized || normalized.length <= targetChars) {
    return normalized
  }

  if (/(emergency|call (an )?ambulance|call 911|call 112|go to (the )?hospital|go to er|emergency room|seek urgent care|difficulty breathing|severe chest pain|fainting|unconscious|stroke)\b/i.test(normalized)) {
    return normalized
  }

  const sentenceMatches = normalized.match(/[^.!?]+[.!?]?/g) || []
  let candidate = ""
  for (const sentence of sentenceMatches) {
    const next = `${candidate} ${sentence}`.trim()
    if (next.length > targetChars && candidate) {
      break
    }
    if (next.length > targetChars) {
      candidate = sentence.trim().slice(0, targetChars)
      break
    }
    candidate = next
  }

  if (candidate) {
    return candidate.trim()
  }

  return `${normalized.slice(0, Math.max(0, targetChars - 1)).trimEnd()}…`
}

const callChatAI = async (payload: {
  message: string
  accessToken: string
  concern?: string
  conversationId?: string | null
  mode?: string
  history?: Array<{
    role: "user" | "assistant"
    content: string
    doctorRecommendations?: any[]
    bookingSlotOptions?: any[]
  }>
  locationCity?: string | null
  searchAreaCity?: string | null
  streamResponse?: boolean
  onDelta?: (text: string) => void
}) => {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/chat-ai`
  const baseBody = {
    message: payload.message,
    concern: payload.concern || "General",
    conversationId: payload.conversationId || null,
    mode: payload.mode || "assistant",
    history: Array.isArray(payload.history) ? payload.history : [],
    locationCity: typeof payload.locationCity === "string" ? payload.locationCity : null,
    searchAreaCity: typeof payload.searchAreaCity === "string" ? payload.searchAreaCity : null,
    // Voice replies use the short/low-latency Chat AI path.
    fastResponse: true,
    quick: true,
    replyInVoice: true,
  }

  const requestChatAi = async (stream: boolean) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort("voice_chat_timeout"), VOICE_CHAT_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: stream ? "text/event-stream" : "application/json",
          Authorization: `Bearer ${payload.accessToken}`,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
        },
        body: JSON.stringify({
          ...baseBody,
          stream,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase()
    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      let reason = errorText || `HTTP ${response.status}`
      if (errorText) {
        try {
          const parsedError = JSON.parse(errorText)
          if (typeof parsedError?.message === "string" && parsedError.message.trim()) {
            reason = parsedError.message.trim()
          }
        } catch {
          // keep raw error text
        }
      }
      throw new Error(`chat-ai call failed: ${reason}`)
    }

    if (stream && contentType.includes("text/event-stream")) {
      return await readSseFinalPayload(response, payload.onDelta)
    }

    return await response.json().catch(() => ({}))
  }

  let data: any = null
  if (payload.streamResponse) {
    try {
      data = await requestChatAi(true)
    } catch (streamError) {
      console.warn("[VoiceChat] chat-ai stream mode failed, retrying with JSON:", streamError)
      data = await requestChatAi(false)
    }
  } else {
    try {
      // For JSON callers we only need the final text, so JSON is faster and simpler.
      data = await requestChatAi(false)
    } catch (jsonError) {
      console.warn("[VoiceChat] chat-ai JSON mode failed, retrying with stream:", jsonError)
      data = await requestChatAi(true)
    }
  }

  if (!data?.success) {
    throw new Error(`chat-ai call failed: ${JSON.stringify(data)}`)
  }

  const responseData = data?.data || {}
  const reply = responseData.reply || responseData.message || ""
  const source = responseData.source || "openai"
  const model = responseData.selectedModel || responseData.model || null
  return { reply, source, model, responseData }
}

const synthesizeSpeech = async (
  text: string,
  model: string,
  fallbackModel: string,
  voice: string,
  openAiKey: string,
  styleInstruction?: string,
  ttsMode: "fast" | "premium" = "premium",
) => {
  const ttsModel = model || "gpt-4o-tts";
  const fallbackTtsModel = fallbackModel || "tts-1";
  const resolvedStyleInstruction = (styleInstruction || VOICE_TTS_STYLE || "").trim()
  const candidateModels = Array.from(
    new Set(
      (ttsMode === "fast"
        ? [ttsModel, fallbackTtsModel, "tts-1"]
        : [ttsModel, fallbackTtsModel]
      ).filter(Boolean)
    )
  )

  const buildSpeechPayload = (activeModel: string) => {
    const payload: Record<string, unknown> = {
      model: activeModel,
      input: text.slice(0, ttsMode === "fast" ? VOICE_TTS_FAST_MAX_INPUT_CHARS : VOICE_TTS_MAX_INPUT_CHARS),
      voice: voice || DEFAULT_TTS_VOICE,
      response_format: DEFAULT_AUDIO_RESPONSE_FORMAT,
      speed: ttsMode === "fast" ? 1.12 : VOICE_TTS_SPEED,
    };

    // 4o TTS supports style instructions; avoid sending to legacy fallback models.
    if (ttsMode !== "fast" && resolvedStyleInstruction && activeModel.includes("gpt-4o")) {
      payload.instructions = resolvedStyleInstruction;
    }

    return payload;
  };

  let modelUsed = ttsModel;
  let response: Response | null = null;
  let lastError = "TTS failed";

  for (const candidate of candidateModels) {
    modelUsed = candidate;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("voice_tts_timeout"), VOICE_TTS_TIMEOUT_MS);
    try {
      response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify(buildSpeechPayload(candidate)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      break;
    }

    lastError = await response.text().catch(() => `TTS failed for ${candidate}`);
    console.warn(`[VoiceChat] TTS model failed: ${candidate}. ${lastError}`);
  }

  if (!response || !response.ok) {
    throw new Error(`TTS failed: ${lastError}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return { audioBase64: btoa(binary), model: modelUsed, mimeType: DEFAULT_AUDIO_MIME_TYPE };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim()
  if (!supabaseUrl || !supabaseServiceRoleKey || !openAiApiKey) {
    return new Response(
      JSON.stringify({ success: false, message: "Environment not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  try {
    const authHeader = req.headers.get("authorization") || ""
    const accessToken = authHeader.replace("Bearer ", "").trim()
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken)

    console.log(`[Voice-Info] Request received from User ID: ${user?.id || 'Unknown'}`)
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const contentType = req.headers.get("content-type") || ""
    if (!contentType.includes("multipart/form-data")) {
      const warmupBody = await req.clone().json().catch(() => null)
      if (warmupBody?.warmup === true) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { warmed: true, timestamp: new Date().toISOString() },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
      }
    }

    // Rate limit per user
    const rateLimit = await evaluateRateLimit({
      serviceClient: supabase,
      userId: user.id,
      action: "voice_chat",
    })
    if (rateLimit.blocked) {
      const blockedMessage = rateLimit.burst
        ? "Too many rapid voice requests. Please wait and try again."
        : rateLimit.isPro
          ? "Your Pro daily voice limit is reached. Please try again later."
          : "Daily voice limit reached. Please upgrade to Pro or try again later."
      return new Response(
        JSON.stringify({
          success: false,
          message: blockedMessage,
          retryAfterMs: rateLimit.retryAfterMs,
          rateLimit,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    let transcriptText = ""
    let concernText = "General Assistant"
    let conversationId: string | null = null
    let mode: string = "assistant"
    let history: Array<{ role: "user" | "assistant"; content: string }> = []
    let locationCity: string | null = null
    let searchAreaCity: string | null = null
    let voicePersonaPreference: string | null = null
    let sttModelUsed: string | null = null
    let preferLocalPlayback = false
    let streamRequested = false
    let ttsMode: "fast" | "premium" = DEFAULT_TTS_MODE
    let warmupRequested = false

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      const file = form.get("audio") as File | null
      if (!file) {
        return new Response(JSON.stringify({ success: false, message: "audio file is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      if (file.size > MAX_AUDIO_BYTES) {
        return new Response(JSON.stringify({ success: false, message: "Audio too large" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const { text, model } = await transcribeAudio(file, DEFAULT_STT_MODEL, DEFAULT_STT_FALLBACK_MODEL, openAiApiKey)
      transcriptText = (text || "").trim()
      sttModelUsed = model
      console.log(`[VoiceChat] STT result: "${transcriptText}" using model: ${sttModelUsed}`)
      concernText = String(form.get("concern") || "General Assistant").trim() || "General Assistant"
      conversationId = String(form.get("conversationId") || "").trim() || null
      mode = String(form.get("mode") || "assistant").trim() || "assistant"
      locationCity = String(form.get("locationCity") || "").trim() || null
      searchAreaCity =
        String(form.get("searchAreaCity") || "").trim() ||
        String(form.get("preferredCity") || "").trim() ||
        null
      voicePersonaPreference = String(form.get("voicePersona") || "").trim() || null
      const requestedTtsMode = String(form.get("ttsMode") || "").trim().toLowerCase()
      ttsMode = requestedTtsMode === "premium"
        ? "premium"
        : requestedTtsMode === "fast"
          ? "fast"
          : DEFAULT_TTS_MODE
      streamRequested = String(form.get("stream") || "").trim().toLowerCase() === "true"
    } else {
      const body = await req.json().catch(() => ({}))
      warmupRequested = body?.warmup === true
      ttsMode = body?.ttsMode === "premium"
        ? "premium"
        : body?.ttsMode === "fast"
          ? "fast"
          : DEFAULT_TTS_MODE
      transcriptText = (body?.text || "").trim()
      console.log(`[VoiceChat] Received text input: "${transcriptText}"`)
      concernText = (body?.concern || "General Assistant").toString().trim() || "General Assistant"
      conversationId =
        typeof body?.conversationId === "string" && body.conversationId.trim()
          ? body.conversationId.trim()
          : null
      mode = typeof body?.mode === "string" && body.mode.trim() ? body.mode.trim() : "assistant"
      history = normalizeHistory(body?.history)
      locationCity =
        typeof body?.locationCity === "string" && body.locationCity.trim()
          ? body.locationCity.trim()
          : null
      searchAreaCity =
        typeof body?.searchAreaCity === "string" && body.searchAreaCity.trim()
          ? body.searchAreaCity.trim()
          : typeof body?.preferredCity === "string" && body.preferredCity.trim()
            ? body.preferredCity.trim()
            : null
      voicePersonaPreference =
        typeof body?.voicePersona === "string" && body.voicePersona.trim()
          ? body.voicePersona.trim()
          : null
      // Default to backend TTS so voice remains natural/consistent unless caller explicitly opts into local playback.
      preferLocalPlayback = body?.preferLocalPlayback === true
      streamRequested = body?.stream === true
    }

    if (warmupRequested) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            warmed: true,
            timestamp: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    if (!transcriptText) {
      return new Response(JSON.stringify({ success: false, message: "No speech text found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const requestStartedAt = Date.now()

    const runVoicePipeline = async (
      emitDelta?: (text: string) => void,
      emitAudioChunk?: (chunk: { index: number; text: string; audio: string; mimeType: string }) => void
    ) => {
      let chatResult:
      | { reply: string; source: string; model: string | null; responseData?: Record<string, unknown> }
      | null = null
    
    const fastScopeDecision = getFastMedicalScopeDecision(transcriptText, concernText)
    let scopeDecision:
      | { isMedical: boolean; source: string; reason: string; modelUsed: string | null }
      | null = fastScopeDecision
        ? {
            isMedical: fastScopeDecision.isMedical,
            source: fastScopeDecision.source,
            reason: fastScopeDecision.reason,
            modelUsed: fastScopeDecision.modelUsed,
          }
        : null
 
    const shouldRunAiScopeClassifier =
      Boolean(openAiApiKey) &&
      scopeDecision?.reason === "context_followup_fast_path"
 
    if (shouldRunAiScopeClassifier) {
      try {
        const aiScopeDecision = await classifyMedicalScopeByAI({
          text: transcriptText,
          concern: concernText,
          history,
          openAiKey: openAiApiKey,
          model: DEFAULT_SCOPE_MODEL,
          fallbackModel: DEFAULT_SCOPE_FALLBACK_MODEL,
        })
        scopeDecision = {
          isMedical: aiScopeDecision.isMedical,
          source: "ai_scope_classifier",
          reason: aiScopeDecision.reason || "classified_by_ai",
          modelUsed: aiScopeDecision.modelUsed,
        }
      } catch (scopeError) {
        console.warn("[VoiceChat] AI scope classifier failed:", scopeError)
      }
    }
 
    const shouldAllowMedicalAssistant = scopeDecision ? scopeDecision.isMedical === true : true
    const isMedical = scopeDecision?.isMedical === true
 
    let chatLatencyMs = 0
    let ttsLatencyMs = 0
    let ttsResult: { audioBase64: string; model: string | null; mimeType: string | null } = {
      audioBase64: "",
      model: null,
      mimeType: null,
    }
    let ttsErrorMessage: string | null = null
    let fullReplyText = ""
    let spokenReplyText = ""
    const resolvedVoicePreset = resolveVoicePreset(voicePersonaPreference)
 
    if (shouldAllowMedicalAssistant) {
      const chatStartedAt = Date.now()
      
      if (emitAudioChunk) {
        let sentenceBuffer = "";
        let sentenceIndex = 0;
        const ttsPromises: Promise<any>[] = [];

        const processChunk = (chunk: string) => {
          if (emitDelta) emitDelta(chunk);
          sentenceBuffer += chunk;
          const { sentences, rest } = extractSentences(sentenceBuffer);
          sentenceBuffer = rest;

          for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (!trimmed) continue;
            
            const currentIndex = sentenceIndex++;
            const cleanSentence = cleanMarkdownForSpeech(trimmed);
            if (!cleanSentence) continue;

            const ttsPromise = (async () => {
              const voiceStyle = buildVoiceStyleInstruction(cleanSentence);
              try {
                const synthesized = await synthesizeSpeech(
                  cleanSentence,
                  DEFAULT_TTS_MODEL,
                  DEFAULT_TTS_FALLBACK_MODEL,
                  resolvedVoicePreset.voice,
                  openAiApiKey,
                  voiceStyle,
                  ttsMode
                );
                emitAudioChunk({
                  index: currentIndex,
                  text: trimmed,
                  audio: synthesized.audioBase64,
                  mimeType: synthesized.mimeType
                });
                return { index: currentIndex, text: trimmed, audio: synthesized.audioBase64 };
              } catch (err: any) {
                console.warn(`[VoiceChat] Parallel TTS failed for index ${currentIndex}:`, err?.message);
                return null;
              }
            })();
            ttsPromises.push(ttsPromise);
          }
        };

        chatResult = await callChatAI({
          message: transcriptText,
          accessToken,
          concern: concernText,
          conversationId,
          mode,
          history,
          locationCity,
          searchAreaCity,
          streamResponse: true,
          onDelta: processChunk
        });

        if (sentenceBuffer.trim()) {
          const trimmed = sentenceBuffer.trim();
          const currentIndex = sentenceIndex++;
          const cleanSentence = cleanMarkdownForSpeech(trimmed);
          if (cleanSentence) {
            const ttsPromise = (async () => {
              const voiceStyle = buildVoiceStyleInstruction(cleanSentence);
              try {
                const synthesized = await synthesizeSpeech(
                  cleanSentence,
                  DEFAULT_TTS_MODEL,
                  DEFAULT_TTS_FALLBACK_MODEL,
                  resolvedVoicePreset.voice,
                  openAiApiKey,
                  voiceStyle,
                  ttsMode
                );
                emitAudioChunk({
                  index: currentIndex,
                  text: trimmed,
                  audio: synthesized.audioBase64,
                  mimeType: synthesized.mimeType
                });
                return { index: currentIndex, text: trimmed, audio: synthesized.audioBase64 };
              } catch (err: any) {
                console.warn(`[VoiceChat] Parallel TTS failed for final chunk:`, err?.message);
                return null;
              }
            })();
            ttsPromises.push(ttsPromise);
          }
        }

        const ttsResults = await Promise.all(ttsPromises);
        const successfulChunks = ttsResults.filter(r => r !== null) as { index: number; text: string; audio: string }[];
        successfulChunks.sort((a, b) => a.index - b.index);

        const fullAudioBase64 = concatenateBase64Audio(successfulChunks.map(c => c.audio));
        
        chatLatencyMs = Date.now() - chatStartedAt;
        ttsResult = {
          audioBase64: fullAudioBase64,
          model: DEFAULT_TTS_MODEL,
          mimeType: DEFAULT_AUDIO_MIME_TYPE
        };
      } else {
        chatResult = await callChatAI({
          message: transcriptText,
          accessToken,
          concern: concernText,
          conversationId,
          mode,
          history,
          locationCity,
          searchAreaCity,
          streamResponse: false,
        })
        chatLatencyMs = Date.now() - chatStartedAt
        fullReplyText = (chatResult.reply || "").trim()
        spokenReplyText = trimVoiceReply(fullReplyText, ttsMode)
        chatResult.reply = fullReplyText

        if (!preferLocalPlayback) {
            const speechText = cleanMarkdownForSpeech(spokenReplyText)
            const voiceStyleInstruction = buildVoiceStyleInstruction(speechText)
          console.log(`[VoiceChat] Starting TTS synthesis...`)
          const ttsStartedAt = Date.now()
          try {
            const synthesized = await synthesizeSpeech(
              speechText,
              DEFAULT_TTS_MODEL,
              DEFAULT_TTS_FALLBACK_MODEL,
              resolvedVoicePreset.voice,
              openAiApiKey,
              voiceStyleInstruction,
              ttsMode,
            )
            ttsResult = {
              audioBase64: synthesized.audioBase64,
              model: synthesized.model,
              mimeType: synthesized.mimeType,
            }
          } catch (ttsError) {
            ttsErrorMessage = ttsError?.message || String(ttsError || "tts_failed")
            console.warn(`[VoiceChat] TTS synthesis failed; returning text with client fallback. ${ttsErrorMessage}`)
          }
          ttsLatencyMs = Date.now() - ttsStartedAt
          console.log(`[VoiceChat] TTS synthesis complete. Audio length (base64): ${ttsResult.audioBase64?.length || 0} bytes`)
        } else {
          console.log(`[VoiceChat] Skipping server TTS, expecting local playback on device.`)
        }
      }
      if (!chatResult) {
        throw new Error("Voice chat returned no response")
      }
      fullReplyText = (chatResult.reply || "").trim()
      spokenReplyText = trimVoiceReply(fullReplyText, ttsMode)
      chatResult.reply = fullReplyText
      console.log(
        `[VoiceChat] AI Reply generated: "${chatResult.reply.slice(0, 50)}..." source: ${chatResult.source} scope=${scopeDecision?.source || "heuristic"}:${scopeDecision?.reason || "medical_terms"}`,
      )
    } else {
      chatResult = {
        reply: getVoiceScopeMessage(transcriptText),
        source: "voice_scope_guard",
        model: null,
        responseData: {
          scopeDecision:
            scopeDecision || {
              isMedical: false,
              source: "heuristic",
              reason: "non_medical_default",
              modelUsed: null,
            },
        },
      }
      console.log(
        `[VoiceChat] Out-of-scope reply generated: "${chatResult.reply}" scope=${scopeDecision?.source || "heuristic"}:${scopeDecision?.reason || "non_medical_default"}`,
      )
    }
    supabase.from("ai_agent_actions").insert({
      user_id: user.id,
      action: "voice_chat",
      status: chatResult.source === "fallback" ? "fallback" : "success",
      payload: {
        sttModel: sttModelUsed,
        ttsModel: ttsResult.model,
        chatModel: chatResult.model,
        ttsVoice: resolvedVoicePreset.voice,
        ttsPersona: resolvedVoicePreset.persona,
        ttsMode,
        isMedical: scopeDecision?.isMedical ?? null,
        usedChatAiScopeFallback: scopeDecision ? false : true,
        scopeSource: scopeDecision?.source || null,
        scopeReason: scopeDecision?.reason || null,
        scopeModel: scopeDecision?.modelUsed || null,
        chatLatencyMs,
        ttsLatencyMs,
        totalLatencyMs: Date.now() - requestStartedAt,
        audioMimeType: ttsResult.mimeType,
      },
    })

    const successPayload = {
      success: true,
      data: {
        text: fullReplyText,
        reply: fullReplyText,
        spokenText: spokenReplyText,
        audio: ttsResult.audioBase64,
        audioMimeType: ttsResult.mimeType,
        chatModel: chatResult.model,
        ttsModel: ttsResult.model,
        ttsVoice: resolvedVoicePreset.voice,
        ttsPersona: resolvedVoicePreset.persona,
        ttsMode,
        ttsError: ttsErrorMessage,
        sttModel: sttModelUsed,
        source: chatResult.source,
        doctorRecommendations: Array.isArray(chatResult.responseData?.doctorRecommendations) ? chatResult.responseData?.doctorRecommendations : [],
        departmentSuggestion: chatResult.responseData?.departmentSuggestion || null,
        doctorSearchMeta: chatResult.responseData?.doctorSearchMeta || null,
        bookingPrompt: typeof chatResult.responseData?.bookingPrompt === "string" ? chatResult.responseData?.bookingPrompt : null,
        consultRecommended: Boolean(chatResult.responseData?.consultRecommended),
        consultPriority: typeof chatResult.responseData?.consultPriority === "string" ? chatResult.responseData?.consultPriority : null,
        needsHumanReview: Boolean(chatResult.responseData?.needsHumanReview),
        riskScore: Number(chatResult.responseData?.riskScore || 0),
        reviewReason: typeof chatResult.responseData?.reviewReason === "string" ? chatResult.responseData?.reviewReason : null,
        bookingPreparation: chatResult.responseData?.bookingPreparation || null,
        bookingConfirmation: chatResult.responseData?.bookingConfirmation || null,
        orchestrator: chatResult.responseData?.orchestrator || null,
        transport: streamRequested ? "sse" : "json",
        perf: {
          chatLatencyMs,
          ttsLatencyMs,
          totalLatencyMs: Date.now() - requestStartedAt,
        },
        rateLimit: {
          ...rateLimit,
          blocked: false,
          blockType: "none",
          used: Math.max(0, Number(rateLimit.used || 0) + 1),
          remaining: Math.max(0, Number(rateLimit.remaining || 0) - 1),
          retryAfterMs: 0,
          blockHours: 0,
          blockUntil: null,
        },
      },
    }

      return successPayload
    }

    if (streamRequested) {
      const stream = new ReadableStream({
        start(controller) {
          ;(async () => {
            try {
              const successPayload = await runVoicePipeline(
                (text) => {
                  if (!text) return
                  controller.enqueue(encodeSseEvent("delta", { text }))
                },
                (audioChunk) => {
                  controller.enqueue(encodeSseEvent("audio-chunk", audioChunk))
                }
              )
              controller.enqueue(encodeSseEvent("done", successPayload))
            } catch (streamError) {
              const message = streamError?.message || String(streamError || "Voice chat failed")
              controller.enqueue(encodeSseEvent("error", { success: false, message: `Voice chat failed: ${message}` }))
            } finally {
              controller.close()
            }
          })()
        },
      })

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    }

    const successPayload = await runVoicePipeline()
    return new Response(JSON.stringify(successPayload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, message: `Voice chat failed: ${error?.message || error}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
