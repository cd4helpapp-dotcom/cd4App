// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"
import { briefToSummaryText, buildDoctorBrief, countPatientTurns, loadConversationForBrief, renderDoctorBriefPdf } from "../_shared/doctorBrief.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const getBearerToken = (req: Request): string => {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || ""
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
}

const getRequestIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""
  return forwarded.split(",")[0]?.trim() || null
}

const logSecurityEvent = async (
  supabase: any,
  args: {
    eventType: string
    severity: "info" | "warn" | "error" | "critical"
    userId?: string | null
    ip?: string | null
    context?: Record<string, unknown>
  },
) => {
  try {
    await supabase.from("security_audit_logs").insert({
      event_type: args.eventType,
      severity: args.severity,
      user_id: args.userId || null,
      ip: args.ip || null,
      source: "save-ai-report",
      context: args.context || {},
    })
  } catch {
    // Telemetry should never block the user flow.
  }
}

const enforceRateLimit = async (
  supabase: any,
  args: { scope: string; subject: string; maxRequests: number; windowSeconds: number },
) => {
  const { data, error } = await supabase.rpc("security_check_rate_limit", {
    p_scope: args.scope,
    p_subject: args.subject,
    p_window_seconds: Math.max(1, Math.floor(args.windowSeconds)),
    p_max_requests: Math.max(1, Math.floor(args.maxRequests)),
  })

  if (error) return { allowed: true, remaining: null, retryAfterSec: 0, currentCount: null }

  const row = Array.isArray(data) ? data[0] : data
  return {
    allowed: Boolean(row?.allowed),
    remaining: typeof row?.remaining === "number" ? row.remaining : null,
    retryAfterSec: typeof row?.retry_after_sec === "number" ? row.retry_after_sec : 0,
    currentCount: typeof row?.current_count === "number" ? row.current_count : null,
  }
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

const getGeminiModelName = (): string => {
  const fromEnv = (Deno.env.get("GEMINI_MODEL") || "").trim()
  return fromEnv || DEFAULT_GEMINI_MODEL
}

const sanitizePdfText = (value: unknown): string => {
  const raw = typeof value === "string" ? value : String(value ?? "")
  return raw
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
}

const clipText = (value: unknown, maxLength: number): string => {
  const text = sanitizePdfText(value).replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

type TriageHistoryItem = {
  role: "user" | "assistant"
  content: string
}

type TriageSnapshot = {
  chiefConcern: string
  duration: string
  severity: string
  temperature: string
  associatedSymptoms: string[]
  medicationContext: string
  riskNote: string
  captureScore: number
  missingDataPoints: string[]
}

const normalizeHistory = (value: unknown): TriageHistoryItem[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item: any): TriageHistoryItem => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: clipText(item?.content || "", 320),
    }))
    .filter((item) => item.content.length > 0)
    // Keep the complete consultation context. The PDF is generated after the
    // patient books, so dropping older turns here can remove an AI question
    // or the answer that belongs to it.
    .slice(-80)
}

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "")

const choosePreferredHistory = (
  primary: TriageHistoryItem[],
  secondary: TriageHistoryItem[],
): TriageHistoryItem[] => {
  const primaryUserTurns = primary.filter((item) => item.role === "user").length
  const secondaryUserTurns = secondary.filter((item) => item.role === "user").length
  if (secondaryUserTurns > primaryUserTurns) return secondary
  if (secondary.length > primary.length + 2) return secondary
  return primary.length > 0 ? primary : secondary
}

const fetchHistoryFromConversation = async (args: {
  supabase: any
  userId: string
  conversationId: string
}): Promise<TriageHistoryItem[]> => {
  if (!isUuid(args.conversationId)) return []

  const { data: messages } = await args.supabase
    .from("ai_chat_messages")
    .select("sender, text")
    .eq("conversation_id", args.conversationId)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: true })
    .limit(80)

  return normalizeHistory(
    (messages || []).map((row: any) => ({
      role: row?.sender === "ai" ? "assistant" : "user",
      content: clipText(typeof row?.text === "string" ? row.text : "", 320),
    })),
  )
}

const isClinicalValueMissing = (value: string): boolean => {
  const normalized = clipText(value, 160).toLowerCase()
  return (
    !normalized ||
    normalized.includes("not clearly stated") ||
    normalized.includes("not captured") ||
    normalized.includes("not mentioned")
  )
}

const normalizeTranscriptNoise = (value: string): string =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[_*#`~]+/g, " ")
    .replace(/[|/]+/g, " ")
    .replace(/\b(umm+|uhh+|hmm+|matlab|like|you know)\b/gi, " ")
    .replace(/([a-z])\1{2,}/gi, "$1$1")
    .replace(/\s+/g, " ")
    .trim()

const splitClinicalClauses = (value: string): string[] =>
  normalizeTranscriptNoise(value)
    .split(/\s*(?:[,.!?;]+|\band\b|\baur\b|\blekin\b|\bbut\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)

const matchFirstPattern = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const raw = typeof match[1] === "string" && match[1].trim() ? match[1] : match[0]
    const normalized = clipText(raw, 120)
    if (normalized) return normalized
  }
  return null
}

const matchFirstPatternAcrossSegments = (text: string, patterns: RegExp[]): string | null => {
  const direct = matchFirstPattern(text, patterns)
  if (direct) return direct
  for (const segment of splitClinicalClauses(text)) {
    const match = matchFirstPattern(segment, patterns)
    if (match) return match
  }
  return null
}

const CLINICAL_SYMPTOM_RULES: Array<{ regex: RegExp; label: string }> = [
  { regex: /\b(fever|bukhar|temperature|viral)\b/i, label: "Fever" },
  { regex: /\b(cough|khansi)\b/i, label: "Cough" },
  { regex: /\b(cold|sardi|runny nose)\b/i, label: "Cold symptoms" },
  { regex: /\b(headache|migraine|sir dard)\b/i, label: "Headache" },
  { regex: /\b(chest pain)\b/i, label: "Chest pain" },
  { regex: /\b(breath|breathing|saans|wheezing)\b/i, label: "Breathing issue" },
  { regex: /\b(stomach|pet|acidity|gas|abdomen)\b/i, label: "Stomach discomfort" },
  { regex: /\b(rash|allergy|itch|itching|fungal|eczema)\b/i, label: "Skin/allergy symptoms" },
  { regex: /\b(period|pregnan|pcos|pcod)\b/i, label: "Gyne-related concern" },
  { regex: /\b(bp|blood pressure|hypertension)\b/i, label: "Blood pressure concern" },
  { regex: /\b(sugar|diabet|glucose|thyroid)\b/i, label: "Sugar/diabetes concern" },
  { regex: /\b(nausea|vomit|vomiting)\b/i, label: "Nausea/vomiting" },
  { regex: /\b(diarrhea|loose motion|constipation)\b/i, label: "Bowel-related symptoms" },
  { regex: /\b(dizziness|vertigo|faint)\b/i, label: "Dizziness" },
]

const NEGATION_PATTERN = /\b(no|not|denies?|without|never|nahin|nahi|na|mat|none|dont|don't|doesnt|doesn't|didnt|didn't)\b/i

const hasNegatedMatch = (text: string, regex: RegExp): boolean => {
  const source = String(text || "")
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`
  const matcher = new RegExp(regex.source, flags)
  let match: RegExpExecArray | null = null

  while ((match = matcher.exec(source)) !== null) {
    const start = Math.max(0, match.index - 28)
    const context = source.slice(start, match.index)
    if (NEGATION_PATTERN.test(context)) return true
  }

  return false
}

const extractAssociatedSymptoms = (text: string): string[] => {
  const combined = normalizeTranscriptNoise(text).toLowerCase()
  if (!combined.trim()) return []

  const labels = CLINICAL_SYMPTOM_RULES
    .filter((entry) => entry.regex.test(combined) && !hasNegatedMatch(combined, entry.regex))
    .map((entry) => entry.label)
    .slice(0, 8)

  return Array.from(new Set(labels))
}

const extractTemperature = (text: string): string => {
  const normalized = normalizeTranscriptNoise(text)
  const match = normalized.match(/\b(\d{2,3}(?:\.\d+)?)\s*(?:degrees?\s*)?(fahrenheit|f|celsius|c)\b/i)
  if (!match) return "Not clearly stated"
  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 80 || value > 115) return "Not clearly stated"
  return `${value}${/^c/i.test(match[2]) ? "°C" : "°F"}`
}

const extractMedicationMentions = (text: string): string[] => {
  const combined = normalizeTranscriptNoise(text).toLowerCase()
  const patterns = [
    /\b(?:tab|tablet|cap|capsule|syrup|drops|spray|inhaler|insulin|injection)\s+([a-z][a-z0-9+\/ -]{2,60})\b/gi,
    /\b([a-z][a-z0-9-]{2,40}(?:\s+[a-z0-9-]{1,20}){0,2})\s+(?:\d{2,4}\s*(?:mg|mcg|ml)|dose|tablet|tab|capsule|cap|syrup)\b/gi,
    /\b([a-z][a-z0-9-]{2,40})\s+(?:li hai|liya hai|le raha|le rahi|use kiya|use ki hai|started|continue kar raha)\b/gi,
  ]

  const found: string[] = []
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null
    while ((match = pattern.exec(combined)) !== null) {
      const candidate = clipText(match[1] || "", 80)
      if (!candidate) continue
      if (/\b(no|not|nahi|nahin|none)\b/i.test(candidate)) continue
      found.push(candidate)
    }
  }

  return Array.from(new Set(found)).slice(0, 3)
}

const extractMedicationContext = (text: string): string => {
  const combined = normalizeTranscriptNoise(text).toLowerCase()
  if (!combined.trim()) return "Not clearly stated"

  if (/\b(no medicine[s]?|not taking any medicine[s]?|nahi koi medicine|koi medicine nahi)\b/i.test(combined)) {
    return "Patient denied current medicine use"
  }

  const medicineMatch =
    combined.match(/\b(?:taking|using|on)\s+([a-z0-9,\s-]{3,80})/i) ||
    combined.match(/\b(?:medicine|medication|tablet|dawai|dava)\s*[:\-]?\s*([a-z0-9,\s-]{3,80})/i)

  const deniedAllergy =
    /\b(no allergy|not allergic|allergy nahi|allergy nahin|koi allergy nahi|drug allergy nahi)\b/i.test(combined)

  const medicationMentions = extractMedicationMentions(combined)

  if (medicineMatch?.[1] || medicationMentions.length > 0) {
    const medText = medicineMatch?.[1]
      ? clipText(medicineMatch[1], 120)
      : medicationMentions.join(", ")
    return deniedAllergy
      ? `Patient reported medicine use (${medText}) and denied drug allergy`
      : `Patient reported medicine use (${medText})`
  }

  if (deniedAllergy) return "Patient denied known drug allergy"
  if (/\b(allergy|allergic)\b/i.test(combined) && !hasNegatedMatch(combined, /\b(allergy|allergic)\b/i)) {
    return "Patient mentioned allergy context"
  }
  return "Not clearly stated"
}

const extractTriageSnapshot = (args: { concern: string; history: TriageHistoryItem[] }): TriageSnapshot => {
  const history = Array.isArray(args.history) ? args.history : []
  const userLines = history.filter((item) => item.role === "user").map((item) => item.content)
  const assistantLines = history.filter((item) => item.role === "assistant").map((item) => item.content)
  const combinedUser = normalizeTranscriptNoise(userLines.join(" "))
  const combinedAssistant = assistantLines.join(" ").toLowerCase()
  const combinedLower = combinedUser.toLowerCase()

  const duration =
    matchFirstPatternAcrossSegments(combinedUser, [
      /\b((?:for|since)\s+[a-z0-9\s]{1,30})\b/i,
      /\b(last\s+\d+\s*(?:hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years))\b/i,
      /\b(\d+\s*(?:day|days|week|weeks|month|months|year|years|din|hafte|hafta|mahina|mahine|saal))\b/i,
      /\b(\d+\s*(?:hour|hours|hr|hrs|min|mins|minute|minutes|ghanta|ghante))\b/i,
      /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks|month|months|year|years)\b/i,
      /\b(kal se|aaj se|subah se|raat se)\b/i,
    ]) || "Not clearly stated"

  const severity =
    matchFirstPatternAcrossSegments(combinedUser, [
      /\b(([1-9]|10)\s*\/\s*10)\b/i,
      /\b(mild|moderate|severe)\b/i,
      /\b([1-9]|10)\s*(?:out of|\/)\s*10\b/i,
      /\b(bahut zyada|zyada|high|intense)\b/i,
      /\b(light|kam|thoda)\b/i,
      /\b(unbearable|worst|getting worse|bohot zyada)\b/i,
    ]) || "Not clearly stated"

  const associatedSymptoms = extractAssociatedSymptoms(combinedUser)
  const temperature = extractTemperature(combinedUser)
  const medicationContext = extractMedicationContext(combinedUser)
  const riskNote = /\b(chest pain|difficulty breathing|shortness of breath|faint|unconscious|severe bleeding|stroke)\b/i.test(combinedLower)
    ? "Emergency red-flag language was detected in the captured chat."
    : "No explicit emergency red-flag language was detected in the captured chat."
  const answeredTopics: Array<{ label: string; value: string }> = [
    { label: "Onset / Duration", value: duration },
    { label: "Severity", value: severity },
    { label: "Temperature / Vitals", value: temperature },
    {
      label: "Associated Symptoms",
      value: associatedSymptoms.length ? associatedSymptoms.join(", ") : "Not clearly stated",
    },
    { label: "Medicine / Allergy Context", value: medicationContext },
  ]

  if (/when did|how long|kab se/.test(combinedAssistant) && duration === "Not clearly stated") {
    answeredTopics[0].value = "Question asked, answer not clearly captured"
  }
  if (/(severity|1-10|pain scale|kitna severe|kitni severity)/.test(combinedAssistant) && severity === "Not clearly stated") {
    answeredTopics[1].value = "Question asked, answer not clearly captured"
  }
  if (/(associated symptom|any other symptom|fever|cough|itching|aur koi symptom)/.test(combinedAssistant) && answeredTopics[2].value === "Not clearly stated") {
    answeredTopics[2].value = "Question asked, answer not clearly captured"
  }
  if (/(medicine|medication|tablet|allergy|dawai|dava)/.test(combinedAssistant) && medicationContext === "Not clearly stated") {
    answeredTopics[3].value = "Question asked, answer not clearly captured"
  }

  const missingDataPoints = answeredTopics
    .filter((item) => isClinicalValueMissing(item.value))
    .map((item) => item.label)

  const requestedConcern = clipText(args.concern || "", 120)
  const chiefConcern = /^(general assistant|general consultation|general)$/i.test(requestedConcern)
    ? (associatedSymptoms[0] || "General consultation")
    : (requestedConcern || userLines[userLines.length - 1] || "General consultation")

  return {
    chiefConcern: clipText(chiefConcern, 120) || "General consultation",
    duration,
    severity,
    temperature,
    associatedSymptoms,
    medicationContext,
    riskNote,
    captureScore: Math.max(0, answeredTopics.length - missingDataPoints.length),
    missingDataPoints,
  }
}

type PdfTriageSlot = "onset" | "severity" | "associated" | "trigger" | "impact" | "medicationContext"

const TRIAGE_SLOT_LABELS: Record<PdfTriageSlot, string> = {
  onset: "Onset / Duration",
  severity: "Severity",
  associated: "Associated Symptoms",
  trigger: "Pattern / Triggers",
  impact: "Functional Impact",
  medicationContext: "Medicine / Allergy Context",
}

const buildQuestionFingerprint = (value: string): string =>
  sanitizePdfText(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()

const normalizeInlineText = (value: string, maxLength: number = 160): string =>
  sanitizePdfText((value || "").replace(/\s+/g, " ").trim()).slice(0, maxLength)

const ENGLISH_TRIAGE_SLOT_QUESTIONS: Record<PdfTriageSlot, string> = {
  onset: "When did the main symptom begin, and is it still ongoing?",
  severity: "How severe is the problem right now?",
  associated: "What other symptoms are happening along with this?",
  trigger: "What pattern or trigger makes the problem better or worse?",
  impact: "How is the problem affecting normal daily activities, work, or sleep?",
  medicationContext: "What medicines have been taken already, and are there any allergies or relevant conditions?",
}

const toProfessionalEnglishAnswer = (value: string): string => {
  let text = normalizeInlineText(normalizeTranscriptNoise(value), 220)
  if (!text) return "Answer not clearly captured before booking"

  const replacements: Array<[RegExp, string]> = [
    [/\bhaan\b/gi, "yes"],
    [/\bhan\b/gi, "yes"],
    [/\bnahi\b/gi, "no"],
    [/\bnahin\b/gi, "no"],
    [/\bbukhar\b/gi, "fever"],
    [/\bkhansi\b/gi, "cough"],
    [/\bsaans\b/gi, "breathing"],
    [/\bpet dard\b/gi, "stomach pain"],
    [/\bpait dard\b/gi, "stomach pain"],
    [/\bdard\b/gi, "pain"],
    [/\bulti\b/gi, "vomiting"],
    [/\bsubah se\b/gi, "since morning"],
    [/\bkal raat se\b/gi, "since last night"],
    [/\baaj se\b/gi, "since today"],
    [/\bzyada\b/gi, "more"],
    [/\bthoda\b/gi, "mild"],
    [/\bbaar baar urine\b/gi, "frequent urination"],
    [/\bpyaas\b/gi, "thirst"],
    [/\bpet\b/gi, "stomach"],
    [/\bsaath me\b/gi, "along with"],
    [/\bchal raha hai\b/gi, "has been continuing"],
    [/\bho raha hai\b/gi, "is happening"],
  ]

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement)
  }

  text = text.replace(/\s+/g, " ").trim()
  if (!/[.?!]$/.test(text)) text = `${text}.`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const toProfessionalEnglishQuestion = (value: string): string => {
  let text = cleanQuestionCandidate(normalizeTranscriptNoise(value), 220)
  const replacements: Array<[RegExp, string]> = [
    [/\bkab se\b/gi, "Since when"],
    [/\bkitne din se\b/gi, "For how many days"],
    [/\bkitna severe\b/gi, "How severe"],
    [/\bkitni severity\b/gi, "How severe"],
    [/\bkitna dard\b/gi, "How much pain"],
    [/\baur koi symptom\b/gi, "Any other symptom"],
    [/\bsaath me\b/gi, "along with"],
    [/\bkya\b/gi, "Is there"],
    [/\bbukhar\b/gi, "fever"],
    [/\bkhansi\b/gi, "cough"],
    [/\bsaans\b/gi, "breathing"],
    [/\bdard\b/gi, "pain"],
    [/\bdawai|dava\b/gi, "medicine"],
    [/\ballergy hai\b/gi, "any allergy"],
  ]
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement)
  text = text.replace(/\s+/g, " ").trim()
  if (!text) return "AI clinical question not clearly captured"
  if (!/[?]$/.test(text)) text = `${text}?`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const QUESTION_PROMPT_PATTERNS = [
  /\?/,
  /\b(please tell|tell me|which|what|when|how|can you share|can you tell|would you|do you|kya|kaun|kaunsa|kab|kitna|kitni|batao|bataye|batayein)\b/i,
]

const BOOKING_OR_SELECTION_PATTERN =
  /\b(doctor|dr\.?|physician|consult|consultation|slot|appointment|book|booking|available slots?|choose a doctor|select a doctor|which doctor|doctor you want|choose a slot|select a slot|kaun se doctor|kaunsa slot|clinic|hospital|fee|experience)\b/i

const HEALTH_QA_PATTERN =
  /\b(symptom|pain|ache|fever|temperature|cough|cold|breath|breathing|chest|headache|migraine|stomach|abdomen|vomit|nausea|loose motion|diarrhea|urine|burning|period|pregnan|bp|blood pressure|pulse|sugar|diabetes|rash|itch|swelling|injury|fracture|bleeding|wound|medicine|medication|tablet|allergy|severity|duration|onset|red flag|bukhar|khansi|dard|saans|ulti|dawai|dava|kab se|kitne din|kitni der)\b/i

const isBookingOrSelectionText = (value: string): boolean =>
  BOOKING_OR_SELECTION_PATTERN.test(value || "")

const isAssistantQuestionLike = (value: string): boolean =>
  QUESTION_PROMPT_PATTERNS.some((pattern) => pattern.test(value || ""))

const isHealthQaPair = (question: string, answer: string): boolean => {
  const combined = `${question} ${answer}`
  if (isBookingOrSelectionText(question)) return false
  if (isBookingOrSelectionText(answer) && !HEALTH_QA_PATTERN.test(answer)) return false
  return HEALTH_QA_PATTERN.test(combined)
}

const cleanQuestionCandidate = (value: string, maxLength: number = 180): string =>
  normalizeInlineText(
    (value || "")
      .replace(/[#*_`>]+/g, " ")
      .replace(/^\s*(?:[-]|\d+[.)])\s*/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    maxLength,
  )

const extractQuestionText = (value: string): string => {
  const originalLines = sanitizePdfText(value || "")
    .split(/\n+/)
    .map((line) => cleanQuestionCandidate(line, 220))
    .filter(Boolean)

  const promptLine = originalLines.find((line) =>
    QUESTION_PROMPT_PATTERNS.slice(1).some((pattern) => pattern.test(line)),
  )
  if (promptLine) {
    return cleanQuestionCandidate(promptLine, 180)
  }

  const compact = cleanQuestionCandidate((value || "").replace(/\s+/g, " "), 220)
  if (!compact) return ""
  const questionMatches = compact.match(/[^?]{4,160}\?/g) || []
  if (questionMatches.length > 0) {
    return cleanQuestionCandidate(questionMatches.slice(0, 3).join(" "), 190)
  }
  return cleanQuestionCandidate(compact, 180)
}

const findNearestUserAnswer = (history: TriageHistoryItem[], questionIndex: number, maxLookAhead = 6): string => {
  const fragments: string[] = []

  for (let index = questionIndex + 1; index < history.length && index <= questionIndex + maxLookAhead; index += 1) {
    const item = history[index]
    if (!item || typeof item.content !== "string") continue
    if (item.role === "user" && item.content.trim()) {
      fragments.push(normalizeInlineText(item.content, 120))
      const joined = fragments.join(" ")
      if (joined.split(/\s+/).length >= 5 || /[.?!]|\/10\b|\b(no|yes|nahi|haan)\b/i.test(joined)) {
        return toProfessionalEnglishAnswer(joined)
      }
      continue
    }
    if (item.role === "assistant" && index > questionIndex + 1 && /\?/.test(item.content)) break
  }

  return fragments.length
    ? toProfessionalEnglishAnswer(fragments.join(" "))
    : "Answer not clearly captured before booking"
}

const buildVoiceChatQaSnapshotLines = (historyInput: TriageHistoryItem[], concernText: string, maxPairs = 4): string[] => {
  const history = Array.isArray(historyInput) ? historyInput : []
  if (!history.length) return ["No AI/voice chat transcript attached"]

  const lines: string[] = []
  const seen = new Set<string>()
  const seenSlots = new Set<string>()

  for (let questionIndex = 0; questionIndex < history.length && lines.length < maxPairs * 2; questionIndex += 1) {
    const item = history[questionIndex]
    if (item.role !== "assistant" || typeof item.content !== "string" || !item.content.includes("?")) continue

    const normalizedQuestion = normalizeInlineText(item.content || "", 400).toLowerCase()
    const slot = (Object.keys(ENGLISH_TRIAGE_SLOT_QUESTIONS) as PdfTriageSlot[]).find((candidate) => {
      const keywords: Record<PdfTriageSlot, string[]> = {
        onset: ["when did", "since when", "started", "how long"],
        severity: ["how severe", "1 to 10", "intensity", "severity"],
        associated: ["other symptoms", "along with", "associated"],
        trigger: ["worse or better", "trigger", "make it worse"],
        impact: ["affecting your", "daily", "sleep", "work"],
        medicationContext: ["medicines", "allergies", "ongoing conditions"],
      }
      return keywords[candidate].some((keyword) => normalizedQuestion.includes(keyword))
    }) || null
    if (!slot || seenSlots.has(slot)) continue

    const question = ENGLISH_TRIAGE_SLOT_QUESTIONS[slot] || extractQuestionText(item.content || "")
    const fingerprint = buildQuestionFingerprint(`${slot}:${question}`)
    const answer = findNearestUserAnswer(history, questionIndex)
    if (!question || !fingerprint || seen.has(fingerprint) || !isHealthQaPair(question, answer)) continue
    seen.add(fingerprint)
    seenSlots.add(slot)

    lines.push(`Q: ${clipText(`${TRIAGE_SLOT_LABELS[slot]}: ${question}`, 220)}`)
    lines.push(`A: ${answer}`)
  }

  for (let index = 0; index < history.length && lines.length < maxPairs * 2; index += 1) {
    const item = history[index]
    if (item.role !== "assistant" || !isAssistantQuestionLike(item.content || "")) continue

    const question = toProfessionalEnglishQuestion(extractQuestionText(item.content || ""))
    if (!question) continue
    const answer = findNearestUserAnswer(history, index)
    if (!isHealthQaPair(question, answer)) continue
    const fingerprint = buildQuestionFingerprint(question)
    if (!fingerprint || seen.has(fingerprint)) continue
    seen.add(fingerprint)

    lines.push(`Q: ${clipText(question, 220)}`)
    lines.push(`A: ${toProfessionalEnglishAnswer(answer)}`)
  }

  if (lines.length) return lines

  const patientNotes = history
    .filter((item) => item.role === "user" && HEALTH_QA_PATTERN.test(item.content || "") && !isBookingOrSelectionText(item.content || ""))
    .slice(-4)
    .map((item, idx) => `Patient note ${idx + 1}: ${toProfessionalEnglishAnswer(item.content)}`)

  return patientNotes.length ? patientNotes : ["No explicit symptom triage Q&A captured from transcript"]
}

const buildAiChatTimelineLines = (historyInput: TriageHistoryItem[], maxLines = 4): string[] => {
  const history = Array.isArray(historyInput) ? historyInput : []
  if (!history.length) return ["No transcript attached"]
  return history
    .slice(-Math.max(2, maxLines))
    .map((item) => `${item.role === "assistant" ? "AI" : "Patient"}: ${clipText(item.content, 180)}`)
    .filter((line) => line.trim().length > 0)
    .slice(0, maxLines)
}

const buildHeuristicSummary = (snapshot: TriageSnapshot): string => {
  const lines = [
    `Chief concern: ${toProfessionalEnglishAnswer(snapshot.chiefConcern)}`,
    `Onset/duration: ${toProfessionalEnglishAnswer(snapshot.duration)}`,
    `Severity: ${toProfessionalEnglishAnswer(snapshot.severity)}`,
    `Temperature/vitals: ${toProfessionalEnglishAnswer(snapshot.temperature)}`,
    `Associated symptoms: ${toProfessionalEnglishAnswer(snapshot.associatedSymptoms.length ? snapshot.associatedSymptoms.join(", ") : "Not clearly stated")}`,
    `Medicine/allergy context: ${toProfessionalEnglishAnswer(snapshot.medicationContext)}`,
    `Risk note: ${snapshot.riskNote}.`,
  ]

  if (snapshot.missingDataPoints.length) {
    lines.push(`Still unclear for doctor follow-up: ${snapshot.missingDataPoints.join(", ")}.`)
  }

  return lines.join(" ")
}

const extractPatientReportedFacts = (historyInput: TriageHistoryItem[]): string[] => {
  const history = Array.isArray(historyInput) ? historyInput : []
  const seen = new Set<string>()
  const facts: string[] = []
  for (const item of history) {
    if (item.role !== "user") continue
    const text = normalizeTranscriptNoise(item.content || "")
      .replace(/\b(?:can you|could you|please recommend|recommend me|i want to|i wanted to|would you like|book(?: me)?|make an appointment)[\s\S]*$/i, "")
      .trim()
    if (!text || text.length < 4 || !HEALTH_QA_PATTERN.test(text)) continue
    const key = text.toLowerCase().replace(/\s+/g, " ").trim()
    if (seen.has(key)) continue
    seen.add(key)
    facts.push(toProfessionalEnglishAnswer(text))
    if (facts.length >= 5) break
  }
  return facts
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const accessToken = getBearerToken(req)
    const requestIp = getRequestIp(req)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || ""

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Supabase environment not configured")
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken)

    if (authError || !user) {
      await logSecurityEvent(supabase, {
        eventType: "save_ai_report_unauthorized",
        severity: "warn",
        ip: requestIp,
        context: { hasToken: Boolean(accessToken) },
      })
      return jsonResponse({ error: "Unauthorized" }, 401)
    }

    const rateLimit = await enforceRateLimit(supabase, {
      scope: "save-ai-report",
      subject: user.id,
      maxRequests: 8,
      windowSeconds: 60,
    })

    if (!rateLimit.allowed) {
      await logSecurityEvent(supabase, {
        eventType: "save_ai_report_rate_limited",
        severity: "warn",
        userId: user.id,
        ip: requestIp,
        context: {
          retryAfterSec: rateLimit.retryAfterSec,
          currentCount: rateLimit.currentCount,
          remaining: rateLimit.remaining,
        },
      })
      return jsonResponse({
        success: false,
        error: "rate_limit_exceeded",
        retryAfterSec: rateLimit.retryAfterSec,
      }, 429)
    }

    const { concern, history, conversationId } = await req.json()
    const safeConcern = clipText(concern || "General", 120) || "General"
    const payloadHistory = normalizeHistory(history)
    const conversationHistory =
      typeof conversationId === "string" && isUuid(conversationId.trim())
        ? await fetchHistoryFromConversation({ supabase, userId: user.id, conversationId: conversationId.trim() })
        : []
    const compactHistory = choosePreferredHistory(payloadHistory, conversationHistory)
    // Without a conversation there is nothing to summarise; an empty call used to store a blank report + PDF.
    if (!compactHistory.some((item: any) => item?.role === "user" && String(item?.content || "").trim())) {
      return jsonResponse({ success: false, error: "empty_conversation", message: "Chat with the AI first, then save the report." }, 400)
    }
    const triageSnapshot = extractTriageSnapshot({ concern: safeConcern, history: compactHistory })
    // The AI reads the original words; compactHistory is cleaned for PDF text and has lost any Hindi.
    const originalConversation = await loadConversationForBrief(supabase, {
      userId: user.id,
      conversationId: typeof conversationId === "string" && isUuid(conversationId.trim()) ? conversationId.trim() : null,
    })
    const payloadOriginal = (Array.isArray(history) ? history : [])
      .map((item: any) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: String(item?.content || "").trim() }))
      .filter((item: any) => item.content)
    const briefHistory = [originalConversation, payloadOriginal, compactHistory]
      .reduce((best: any[], candidate: any[]) => (countPatientTurns(candidate) > countPatientTurns(best) ? candidate : best), [])
    const brief = await buildDoctorBrief({
      concern: safeConcern,
      history: briefHistory,
      env: {
        openAiKey: Deno.env.get("OPENAI_API_KEY") || "",
        openAiModel: Deno.env.get("CHAT_AI_OPENAI_MODEL")?.trim() || "gpt-4o-mini",
        geminiKey: geminiApiKey,
      },
    })
    const safeSummary = briefToSummaryText(brief)
    const userMeta = user.user_metadata || user.raw_user_meta_data || {}
    const patientName = [clipText(userMeta.first_name || userMeta.firstName || "", 60), clipText(userMeta.last_name || userMeta.lastName || "", 60)]
      .filter(Boolean)
      .join(" ")
      .trim() || "Patient"

    const pdfBytes = await renderDoctorBriefPdf({ PDFDocument, StandardFonts, rgb }, { brief, patient: { name: patientName } })
    const filePath = `${user.id}/report_${Date.now()}.pdf`

    const { error: uploadError } = await supabase.storage
      .from("ai-reports")
      .upload(filePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      throw new Error(`report_upload_failed:${uploadError.message || "unknown"}`)
    }

    const { data: signedData } = await supabase.storage
      .from("ai-reports")
      .createSignedUrl(filePath, 60 * 10)
    const signedUrl = signedData?.signedUrl || null

    const { data, error: dbError } = await supabase
      .from("ai_triage_reports")
      .insert({
        patient_id: user.id,
        concern: safeConcern,
        chat_history: compactHistory,
        summary: safeSummary,
        pdf_url: filePath,
      })
      .select("id")
      .single()

    if (dbError) throw dbError

    await logSecurityEvent(supabase, {
      eventType: "save_ai_report_success",
      severity: "info",
      userId: user.id,
      ip: requestIp,
      context: {
        reportId: data?.id || null,
        hasSignedUrl: Boolean(signedUrl),
      },
    })

    return jsonResponse({
      success: true,
      reportId: data?.id,
      summary: safeSummary,
      pdfPath: filePath,
      pdfSignedUrl: signedUrl,
    })
  } catch (error) {
    const message = error?.message || "Failed to save AI report."
    console.error("Function execution error:", message)
    return jsonResponse({ error: message }, 500)
  }
})
