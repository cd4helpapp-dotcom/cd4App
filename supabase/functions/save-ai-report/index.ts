// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"

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
  associatedSymptoms: string[]
  medicationContext: string
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
    .slice(-24)
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

const extractAssociatedSymptoms = (text: string): string[] => {
  const combined = (text || "").toLowerCase()
  if (!combined.trim()) return []
  return CLINICAL_SYMPTOM_RULES
    .filter((entry) => entry.regex.test(combined))
    .map((entry) => entry.label)
    .slice(0, 8)
}

const extractMedicationContext = (text: string): string => {
  const combined = (text || "").toLowerCase()
  if (!combined.trim()) return "Not clearly stated"

  if (/\b(no medicine[s]?|not taking any medicine[s]?|nahi koi medicine|koi medicine nahi)\b/i.test(combined)) {
    return "Patient denied current medicine use"
  }

  const medicineMatch =
    combined.match(/\b(?:taking|using|on)\s+([a-z0-9,\s-]{3,80})/i) ||
    combined.match(/\b(?:medicine|medication|tablet|dawai|dava)\s*[:\-]?\s*([a-z0-9,\s-]{3,80})/i)

  if (medicineMatch?.[1]) {
    return `Patient mentioned medication context: ${clipText(medicineMatch[1], 120)}`
  }

  if (/\b(allergy|allergic)\b/i.test(combined)) return "Patient mentioned allergy context"
  return "Not clearly stated"
}

const extractTriageSnapshot = (args: { concern: string; history: TriageHistoryItem[] }): TriageSnapshot => {
  const history = Array.isArray(args.history) ? args.history : []
  const userLines = history.filter((item) => item.role === "user").map((item) => item.content)
  const assistantLines = history.filter((item) => item.role === "assistant").map((item) => item.content)
  const combinedUser = userLines.join(" ")
  const combinedAssistant = assistantLines.join(" ").toLowerCase()

  const duration =
    matchFirstPattern(combinedUser, [
      /\b((?:for|since)\s+[a-z0-9\s]{1,30})\b/i,
      /\b(last\s+\d+\s*(?:hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years))\b/i,
      /\b(\d+\s*(?:day|days|week|weeks|month|months|year|years|din|hafte|hafta|mahina|mahine|saal))\b/i,
      /\b(\d+\s*(?:hour|hours|hr|hrs|min|mins|minute|minutes|ghanta|ghante))\b/i,
      /\b(kal se|aaj se|subah se|raat se)\b/i,
    ]) || "Not clearly stated"

  const severity =
    matchFirstPattern(combinedUser, [
      /\b(([1-9]|10)\s*\/\s*10)\b/i,
      /\b(mild|moderate|severe)\b/i,
      /\b([1-9]|10)\s*(?:out of|\/)\s*10\b/i,
      /\b(bahut zyada|zyada|high|intense)\b/i,
      /\b(light|kam|thoda)\b/i,
    ]) || "Not clearly stated"

  const associatedSymptoms = extractAssociatedSymptoms(combinedUser)
  const medicationContext = extractMedicationContext(combinedUser)
  const answeredTopics: Array<{ label: string; value: string }> = [
    { label: "Onset / Duration", value: duration },
    { label: "Severity", value: severity },
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

  return {
    chiefConcern: clipText(args.concern || userLines[userLines.length - 1] || "General consultation", 120) || "General consultation",
    duration,
    severity,
    associatedSymptoms,
    medicationContext,
    captureScore: Math.max(0, answeredTopics.length - missingDataPoints.length),
    missingDataPoints,
  }
}

const QA_PRIORITY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Onset / Duration", pattern: /\b(when did|how long|since when|duration|kab se|kitne din|kitni der)\b/i },
  { label: "Severity", pattern: /\b(severity|severe|pain scale|scale of|1-10|1\/10|10\/10|kitna severe|kitni severity)\b/i },
  { label: "Associated Symptoms", pattern: /\b(other symptom|associated symptom|aur koi symptom|fever|cough|itching|nausea|vomit)\b/i },
  { label: "Medicine / Allergy Context", pattern: /\b(medicine|medication|tablet|allergy|dawai|dava)\b/i },
]

const buildQuestionFingerprint = (value: string): string =>
  sanitizePdfText(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()

const extractQuestionText = (value: string): string => {
  const compact = clipText(value, 200)
  if (!compact) return ""
  const match = compact.match(/([^?]{4,170}\?)/)
  if (match?.[1]) return clipText(match[1], 180)
  return compact.endsWith("?") ? compact : clipText(`${compact}?`, 180)
}

const findNearestUserAnswer = (history: TriageHistoryItem[], questionIndex: number, maxLookAhead = 6): string => {
  for (let index = questionIndex + 1; index < history.length && index <= questionIndex + maxLookAhead; index += 1) {
    const item = history[index]
    if (!item || typeof item.content !== "string") continue
    if (item.role === "user" && item.content.trim()) return clipText(item.content, 220)
    if (item.role === "assistant" && index > questionIndex + 1 && /\?/.test(item.content)) break
  }
  return "Answer not clearly captured before booking"
}

const buildVoiceChatQaSnapshotLines = (historyInput: TriageHistoryItem[], maxPairs = 4): string[] => {
  const history = Array.isArray(historyInput) ? historyInput : []
  if (!history.length) return ["No AI/voice chat transcript attached"]

  const lines: string[] = []
  const seen = new Set<string>()

  for (const rule of QA_PRIORITY_RULES) {
    if (lines.length >= maxPairs * 2) break
    const questionIndex = history.findIndex((item) => item.role === "assistant" && rule.pattern.test(item.content || ""))
    if (questionIndex < 0) continue

    const question = extractQuestionText(history[questionIndex].content || "")
    const fingerprint = buildQuestionFingerprint(question)
    if (!question || !fingerprint || seen.has(fingerprint)) continue
    seen.add(fingerprint)

    lines.push(`Q: ${clipText(`${rule.label}: ${question}`, 220)}`)
    lines.push(`A: ${findNearestUserAnswer(history, questionIndex)}`)
  }

  return lines.length ? lines : ["No explicit symptom triage Q&A captured from transcript"]
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

const buildGeminiSummary = async (geminiApiKey: string, history: TriageHistoryItem[]): Promise<string> => {
  if (!geminiApiKey || history.length === 0) return ""

  const historyText = history
    .map((m) => `${m.role === "assistant" ? "AI" : "Patient"}: ${sanitizePdfText(m.content || "")}`)
    .join("\n")

  const prompt = `You are a clinical documentation assistant.
Create a concise doctor-facing triage summary from the chat history.

Output format (plain text only):
1) Chief concern:
2) Onset/duration:
3) Severity and progression:
4) Associated symptoms:
5) Relevant medical context (medicines/history/allergies if mentioned):
6) Why doctor review may be needed:

Rules:
- If data is missing, write "Not clearly stated".
- Keep objective, no definitive diagnosis.
- Maximum 140 words.

Chat History:
${historyText}`

  const geminiModel = getGeminiModelName()
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 300,
      },
    }),
  })

  if (!response.ok) return ""
  const aiData = await response.json()
  return sanitizePdfText(aiData?.candidates?.[0]?.content?.parts?.[0]?.text || "")
}

const buildReportPdfBytes = async (args: {
  concern: string
  summary: string
  triageSnapshot: TriageSnapshot
  qaSnapshotLines: string[]
  aiChatTimelineLines: string[]
  patientName?: string
  patientEmail?: string
}): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const page = pdfDoc.addPage([595, 842])

  const green = rgb(0.04, 0.47, 0.37)
  const border = rgb(0.86, 0.9, 0.9)
  const dark = rgb(0.12, 0.16, 0.18)
  const muted = rgb(0.36, 0.43, 0.46)
  const white = rgb(1, 1, 1)

  const generatedAt = new Date()
  const generatedDate = generatedAt.toLocaleDateString("en-IN")
  const generatedTime = generatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })

  const drawTextOnPage = (
    targetPage: any,
    text: string,
    x: number,
    textY: number,
    size = 10,
    useBold = false,
    color = dark,
  ) => {
    targetPage.drawText(sanitizePdfText(text), {
      x,
      y: textY,
      size,
      font: useBold ? boldFont : font,
      color,
    })
  }

  const drawText = (text: string, x: number, textY: number, size = 10, useBold = false, color = dark) =>
    drawTextOnPage(page, text, x, textY, size, useBold, color)

  const wrap = (value: string, maxWidth: number, textSize = 10, useBold = false): string[] => {
    const words = sanitizePdfText(value).split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let current = ""
    const activeFont = useBold ? boldFont : font

    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (activeFont.widthOfTextAtSize(next, textSize) > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = next
      }
    }

    if (current) lines.push(current)
    return lines.length ? lines : [""]
  }

  const fitText = (value: string, maxWidth: number, size = 9.5, useBold = false): string => {
    const clean = sanitizePdfText(value || "")
    if (!clean) return ""
    const activeFont = useBold ? boldFont : font
    if (activeFont.widthOfTextAtSize(clean, size) <= maxWidth) return clean

    let output = clean
    while (output.length > 2 && activeFont.widthOfTextAtSize(`${output}...`, size) > maxWidth) {
      output = output.slice(0, -1)
    }
    return `${output}...`
  }

  const drawBox = (x: number, boxY: number, width: number, height: number, fill = white, stroke = border) => {
    page.drawRectangle({ x, y: boxY, width, height, color: fill, borderColor: stroke, borderWidth: 1 })
  }

  const drawBullets = (
    x: number,
    startY: number,
    width: number,
    items: string[],
    maxItems = 4,
    size = 9,
    color = dark,
    minY = 0,
  ) => {
    let cursorY = startY
    const rows = items.length ? items : ["Not clearly captured"]
    for (const item of rows.slice(0, maxItems)) {
      const wrapped = wrap(item, width - 10, size).slice(0, 2)
      drawText(`- ${wrapped[0] || "Not clearly captured"}`, x, cursorY, size, false, color)
      cursorY -= 13
      if (wrapped[1] && cursorY > minY) {
        drawText(`  ${wrapped[1]}`, x, cursorY, size, false, color)
        cursorY -= 13
      }
      if (cursorY <= minY) break
    }
  }

  const buildSnapshotSummaryLines = (value: string, maxLines = 4): string[] => {
    const normalized = sanitizePdfText(value).replace(/\s+/g, " ").trim()
    if (!normalized) return ["AI clinical summary could not be generated from the attached transcript."]

    const chunks = normalized
      .split(/[.!?]+\s+/)
      .map((chunk) => clipText(chunk, 220))
      .filter(Boolean)

    return (chunks.length ? chunks : [clipText(normalized, 240)]).slice(0, maxLines)
  }

  const associatedSymptoms = args.triageSnapshot.associatedSymptoms.length
    ? args.triageSnapshot.associatedSymptoms.join(", ")
    : "Not clearly stated"
  const missingPoints = args.triageSnapshot.missingDataPoints.length
    ? args.triageSnapshot.missingDataPoints.join(", ")
    : "None"
  const reportId = `AI-${Date.now()}`

  // One-page A4 layout matched to the prescription PDF visual language.
  drawText("CD4", 34, 807, 24, true, green)
  drawText("Teleconsultation", 34, 792, 11, false, dark)
  page.drawRectangle({ x: 202, y: 790, width: 190, height: 28, color: green })
  drawText("AI SNAPSHOT", 257, 799, 13, true, white)
  drawText(`Date: ${generatedDate}`, 410, 807, 10, false, dark)
  drawText(`Time: ${generatedTime}`, 410, 793, 10, false, dark)
  drawText(`Report ID: ${fitText(reportId, 110, 10)}`, 410, 779, 10, false, dark)

  drawBox(28, 675, 539, 104, white, border)
  drawText("PATIENT DETAILS", 40, 760, 11, true, green)
  drawText(`Name: ${fitText(args.patientName || "Patient", 210, 11, true)}`, 40, 742, 11, true, dark)
  drawText(`Email: ${fitText(args.patientEmail || "Not available", 210, 9.4)}`, 40, 726, 9.4, false, muted)
  drawText("Source: AI chat / voice-guided triage", 40, 712, 9.4, false, muted)

  drawText("SNAPSHOT DETAILS", 290, 760, 11, true, green)
  drawText(`Concern: ${fitText(args.concern, 220, 10, true)}`, 290, 742, 10, true, dark)
  drawText(`Capture: ${args.triageSnapshot.captureScore}/4 core items`, 290, 726, 9.4, false, muted)
  drawText(`Generated: ${generatedDate} ${generatedTime}`, 290, 712, 9.4, false, muted)

  drawBox(28, 535, 539, 128, white, border)
  drawText("CHIEF CONCERN", 40, 645, 11, true, green)
  drawBullets(
    40,
    627,
    165,
    [
      args.triageSnapshot.chiefConcern,
      `Duration: ${args.triageSnapshot.duration}`,
      `Severity: ${args.triageSnapshot.severity}`,
    ],
    4,
    9,
    dark,
    548,
  )
  drawText("AI SUMMARY", 230, 645, 11, true, green)
  drawBullets(230, 627, 175, buildSnapshotSummaryLines(args.summary, 4), 4, 9, dark, 548)
  drawText("RISK / CONTEXT", 430, 645, 11, true, green)
  drawBullets(
    430,
    627,
    128,
    [
      "Doctor review required before diagnosis or treatment.",
      `Missing: ${missingPoints}`,
      `Data: ${args.triageSnapshot.captureScore}/4`,
    ],
    3,
    8.4,
    dark,
    548,
  )
  drawText(`Concern: ${fitText(args.concern, 500, 9)}`, 40, 560, 9, true, dark)
  drawText(`Symptoms: ${fitText(associatedSymptoms, 480, 9)}`, 40, 546, 9, false, dark)

  drawText("DOCTOR QUICK REVIEW", 28, 515, 12, true, green)
  drawBox(28, 350, 539, 156, white, border)
  page.drawRectangle({ x: 29, y: 485, width: 537, height: 20, color: green })
  drawText("Field", 38, 491, 9, true, white)
  drawText("Captured Detail", 146, 491, 9, true, white)
  drawText("Doctor Action", 382, 491, 9, true, white)

  const reviewRows = [
    ["Concern", args.triageSnapshot.chiefConcern, "Confirm history"],
    ["Duration", args.triageSnapshot.duration, "Clarify onset"],
    ["Severity", args.triageSnapshot.severity, "Assess vitals"],
    ["Symptoms", associatedSymptoms, "Screen red flags"],
    ["Medicine / Allergy", args.triageSnapshot.medicationContext, "Verify before Rx"],
    ["Missing", missingPoints, "Ask follow-up"],
  ]
  let reviewRowY = 468
  reviewRows.forEach((row, index) => {
    if (index % 2 === 0) {
      page.drawRectangle({ x: 29, y: reviewRowY - 13, width: 537, height: 22, color: rgb(0.98, 0.99, 0.99) })
    }
    drawText(fitText(row[0], 96, 8.8, true), 38, reviewRowY, 8.8, index === 0, dark)
    drawText(fitText(row[1], 220, 8.8), 146, reviewRowY, 8.8, false, dark)
    drawText(fitText(row[2], 150, 8.8), 382, reviewRowY, 8.8, false, dark)
    reviewRowY -= 22
  })
  drawText("This AI snapshot supports clinical review and should be verified by the treating doctor.", 36, 357, 8.5, false, muted)

  drawBox(28, 234, 539, 106, white, border)
  drawText("VOICE / AI Q&A", 40, 322, 11, true, green)
  drawBullets(40, 304, 240, args.qaSnapshotLines, 4, 8.5, dark, 246)
  drawText("RECENT CHAT CONTEXT", 318, 322, 11, true, green)
  drawBullets(318, 304, 230, args.aiChatTimelineLines, 4, 8.5, dark, 246)

  drawText("AI-assisted summary for doctor review only. Not a diagnosis or prescription.", 28, 208, 9, false, muted)
  drawText("Reviewing Doctor", 430, 194, 11, true, dark)
  drawText("Clinical verification required", 430, 182, 9, false, muted)

  drawBox(28, 78, 539, 96, white, border)
  drawText("DOCTOR HANDOFF NOTES", 40, 158, 10, true, green)
  drawBullets(
    40,
    142,
    500,
    [
      "Verify patient-reported symptoms, duration, vitals, medicines, allergies, and red flags directly.",
      "Use this snapshot as a consultation aid before diagnosis, prescription, or referral.",
      "If red flags are present, advise urgent in-person or emergency care as clinically appropriate.",
    ],
    4,
    8.8,
    dark,
    88,
  )

  page.drawRectangle({ x: 0, y: 0, width: 595, height: 24, color: green })
  drawText("Your health. Our priority.", 244, 8, 9, true, white)

  return await pdfDoc.save()
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

    const { concern, history } = await req.json()
    const safeConcern = clipText(concern || "General", 120) || "General"
    const compactHistory = normalizeHistory(history)
    const triageSnapshot = extractTriageSnapshot({ concern: safeConcern, history: compactHistory })
    const qaSnapshotLines = buildVoiceChatQaSnapshotLines(compactHistory, 4)
    const aiChatTimelineLines = buildAiChatTimelineLines(compactHistory, 4)

    let summary = ""
    try {
      summary = await buildGeminiSummary(geminiApiKey, compactHistory)
    } catch (err) {
      console.error("Summary generation failed:", err)
    }

    const fallbackSummary = [
      `Chief concern: ${triageSnapshot.chiefConcern}.`,
      `Onset/duration: ${triageSnapshot.duration}.`,
      `Severity: ${triageSnapshot.severity}.`,
      `Associated symptoms: ${triageSnapshot.associatedSymptoms.length ? triageSnapshot.associatedSymptoms.join(", ") : "Not clearly stated"}.`,
      `Medicine/allergy context: ${triageSnapshot.medicationContext}.`,
    ].join(" ")
    const safeSummary = clipText(summary || fallbackSummary || "No summary generated.", 1400) || "No summary generated."
    const userMeta = user.user_metadata || user.raw_user_meta_data || {}
    const patientFirstName = clipText(userMeta.first_name || userMeta.firstName || "", 60)
    const patientLastName = clipText(userMeta.last_name || userMeta.lastName || "", 60)
    const patientName = [patientFirstName, patientLastName].filter(Boolean).join(" ").trim() || clipText(user.email || "Patient", 100) || "Patient"
    const patientEmail = clipText(user.email || userMeta.email || "", 120)

    const pdfBytes = await buildReportPdfBytes({
      concern: safeConcern,
      summary: safeSummary,
      triageSnapshot,
      qaSnapshotLines,
      aiChatTimelineLines,
      patientName,
      patientEmail,
    })
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
