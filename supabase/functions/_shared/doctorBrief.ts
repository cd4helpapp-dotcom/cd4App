// @ts-nocheck
// The clinical summary a doctor receives when a patient books after an AI chat or voice conversation.
// An AI model reads the whole conversation, in any language, and writes the facts in simple English. Earlier the fields
// came from English-only regexes, so Hindi chats produced a page of "Not clearly stated".

import { completionLimits } from "./agent/openaiParams.ts"
import { embedCd4Logo } from "./pdfBranding.ts"

export type DoctorBrief = {
  source: "ai" | "basic" | "none"
  aiError?: string
  patientWords?: string[]
  mainConcern: string
  summary: string
  duration: string
  onset: string
  progression: string
  severity: string
  triggers: string
  treatmentTried: string
  symptoms: string[]
  notPresent: string[]
  medicines: string
  allergies: string
  medicalHistory: string
  redFlags: string[]
  confirmInConsult: string[]
}

type HistoryItem = { role: string; content: string }

const NOT_STATED = /^(n\/?a|none|null|unknown|not (clearly )?(stated|mentioned|available|provided|known|captured|specified)|no (information|data|details?)|-+)\.?$/i
const GENERIC_CONCERN = /^(general|general consultation|general assistant|general health|general health concern|consultation)$/i

// Helvetica in pdf-lib only encodes Latin text, and one unsupported character aborts the whole PDF.
export const toPdfSafeText = (value: unknown): string =>
  String(value ?? "")
    .replace(/[*_`#>]+/g, "")
    .replace(/₹/g, "Rs. ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/°/g, " deg ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const cleanText = (value: unknown, max: number): string => {
  const text = toPdfSafeText(value)
  if (!text || NOT_STATED.test(text)) return ""
  if (text.length <= max) return text
  return `${text.slice(0, max - 3).replace(/\s+\S*$/, "")}...`
}

const cleanList = (value: unknown, maxItems: number, maxChars: number): string[] => {
  const items = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const text = cleanText(item, maxChars)
    const key = text.toLowerCase()
    if (text && !seen.has(key)) {
      seen.add(key)
      out.push(text)
    }
    if (out.length === maxItems) break
  }
  return out
}

export const normalizeBrief = (raw: any, source: DoctorBrief["source"]): DoctorBrief => ({
  source,
  mainConcern: cleanText(raw?.mainConcern, 280),
  summary: cleanText(raw?.summary, 800),
  duration: cleanText(raw?.duration, 140),
  onset: cleanText(raw?.onset, 240),
  progression: cleanText(raw?.progression, 240),
  severity: cleanText(raw?.severity, 160),
  triggers: cleanText(raw?.triggers, 240),
  treatmentTried: cleanText(raw?.treatmentTried, 280),
  symptoms: cleanList(raw?.symptoms, 16, 110),
  notPresent: cleanList(raw?.notPresent, 16, 90),
  medicines: cleanText(raw?.medicines, 320),
  allergies: cleanText(raw?.allergies, 160),
  medicalHistory: cleanText(raw?.medicalHistory, 320),
  redFlags: cleanList(raw?.redFlags, 6, 140),
  confirmInConsult: cleanList(raw?.confirmInConsult, 4, 140),
})

// The doctor's summary is written from the conversation exactly as it was said. It must not go through the PDF text
// cleaner, which removes every Hindi letter because the PDF font cannot draw them: a Hindi chat used to arrive nearly empty.
const conversationRows = async (client: any, conversationId: string, userId: string): Promise<HistoryItem[]> => {
  const { data } = await client
    .from("ai_chat_messages")
    .select("sender, text")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(200)
  return (data || [])
    .map((row: any) => ({ role: row?.sender === "ai" ? "assistant" : "user", content: String(row?.text || "").trim().slice(0, 1500) }))
    .filter((row: HistoryItem) => row.content)
}

export const countPatientTurns = (history: HistoryItem[]): number =>
  history.filter((item) => item?.role === "user" && String(item?.content || "").trim()).length

// The conversation this booking came from. Booking from the Appointments tab carries no conversation id, so a chat in
// the last 24 hours is used instead; an older one may be about a different problem.
export const loadConversationForBrief = async (client: any, args: { userId: string; conversationId?: string | null }): Promise<HistoryItem[]> => {
  if (args.conversationId) {
    const rows = await conversationRows(client, args.conversationId, args.userId)
    if (countPatientTurns(rows)) return rows
  }
  const { data: recent } = await client
    .from("ai_chat_conversations")
    .select("id")
    .eq("user_id", args.userId)
    .gte("updated_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("updated_at", { ascending: false })
    .limit(5)
  for (const conversation of recent || []) {
    const rows = await conversationRows(client, conversation.id, args.userId)
    if (countPatientTurns(rows)) return rows
  }
  return []
}

const hasPatientMessage = (history: HistoryItem[]): boolean =>
  history.some((item) => item?.role === "user" && String(item?.content || "").trim())

const SYSTEM_PROMPT = `You take the patient's history for a doctor, so the doctor does not have to ask the same questions again and saves time. You receive a conversation between a patient and CD4's AI health assistant. The patient may write in Hindi, Hinglish, English or another language, with typos or voice-to-text errors.

Rules:
- Write everything in simple, plain English. Translate anything else. Short phrases, no jargon the patient did not use.
- Facts come only from what the PATIENT said. The assistant's advice and guesses are not facts.
- Read each patient reply together with the question just before it. If the assistant asked "Do you have a cough?" and the patient said "yes" or "haan", cough goes in symptoms. If the patient said "no" or "nahi", it goes in notPresent. If asked "since when?" and they said "2 din se", duration is 2 days.
- Use the whole conversation, from the first message to the last. Include every symptom, reading, medicine, allergy and condition the patient mentioned. If they changed an answer, use the latest one.
- Never invent anything. If the patient did not say it, return "" or [] for that field.
- Do not diagnose, name a likely disease as fact, or suggest treatment.
- Ignore booking chatter such as doctors, slots, fees and payments.
- A symptom the patient denied goes in notPresent, never in symptoms.

Return only JSON with exactly these keys:
{
 "mainConcern": "Chief complaint: one sentence, max 25 words, starting with 'Patient reports'. The main reason for this visit.",
 "summary": "History of the present problem in 2-3 short sentences a doctor can read in 15 seconds: what happened, in what order, and what worries the patient.",
 "duration": "Since how long, e.g. '3 days'",
 "onset": "How and when it started, e.g. 'Suddenly, after eating outside on Monday night'",
 "progression": "Whether it is getting better, worse or staying the same, e.g. 'Getting worse each day, fever comes back at night'",
 "severity": "As the patient described it, e.g. 'Moderate, 6/10' or 'High fever, 102 F'",
 "triggers": "What makes it better or worse, e.g. 'Worse after food, better after rest'",
 "treatmentTried": "What the patient already tried and whether it helped, e.g. 'Paracetamol helps for a few hours'",
 "symptoms": ["Symptoms the patient reported"],
 "notPresent": ["Symptoms the patient said they do NOT have"],
 "medicines": "Medicines the patient said they take or took",
 "allergies": "Allergies the patient stated",
 "medicalHistory": "Existing conditions, surgeries or pregnancy the patient stated",
 "redFlags": ["Only danger signs the patient actually reported, e.g. 'Chest pain with breathlessness'"],
 "confirmInConsult": ["Up to 3 specific facts missing for this concern that the doctor should ask about"]
}`

const AI_TIMEOUT_MS = 30000

const callOpenAi = async (apiKey: string, model: string, transcript: string): Promise<any> => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      ...completionLimits(model, 1100, 0.1),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: transcript }],
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || `openai_${response.status}`)
  return JSON.parse(payload?.choices?.[0]?.message?.content || "{}")
}

const callGemini = async (apiKey: string, transcript: string): Promise<any> => {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: transcript }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || `gemini_${response.status}`)
  return JSON.parse(payload?.candidates?.[0]?.content?.parts?.[0]?.text || "{}")
}

// Used only when every AI attempt fails. Keyword matching here once listed symptoms the patient had denied ("khansi nahi hai"
// became Cough), and a wrong fact is worse than none. So this states no facts at all, only the patient's own words.
const basicBriefFromConversation = (concern: string, history: HistoryItem[]): DoctorBrief => ({
  ...normalizeBrief({ mainConcern: GENERIC_CONCERN.test(concern) ? "" : `Patient selected: ${concern}` }, "basic"),
  patientWords: history
    .filter((item) => item?.role === "user")
    .map((item) => {
      const original = String(item?.content || "")
      const safe = cleanText(original, 300)
      // The PDF font cannot draw Hindi, so say that a message exists rather than dropping it unseen.
      return /[^\x00-\x7F]/.test(original.replace(/[₹‘’“”–—…°]/g, "")) && safe.length < original.length * 0.5
        ? "(Message in Hindi. Please read it in the chat.)"
        : safe
    })
    .filter(Boolean)
    .slice(-12),
})

export const buildDoctorBrief = async (args: {
  concern: string
  history: HistoryItem[]
  env: { openAiKey?: string; openAiModel?: string; geminiKey?: string }
}): Promise<DoctorBrief> => {
  const concern = String(args.concern || "").trim()
  if (!hasPatientMessage(args.history)) {
    return normalizeBrief({ mainConcern: GENERIC_CONCERN.test(concern) ? "" : `Patient selected: ${concern}` }, "none")
  }

  const transcript = [
    `Concern chosen in the app: ${concern || "not specified"}`,
    "Conversation:",
    ...args.history.slice(-120).map((item) => `${item.role === "user" ? "PATIENT" : "ASSISTANT"}: ${String(item.content || "").slice(0, 1500)}`),
  ].join("\n")

  // One retry, because a slow moment at the provider should not cost the doctor the history.
  const attempts = [
    args.env.openAiKey ? () => callOpenAi(args.env.openAiKey!, args.env.openAiModel || "gpt-4o-mini", transcript) : null,
    args.env.openAiKey ? () => callOpenAi(args.env.openAiKey!, "gpt-4o-mini", transcript) : null,
    args.env.geminiKey ? () => callGemini(args.env.geminiKey!, transcript) : null,
  ].filter(Boolean) as Array<() => Promise<any>>

  let lastError = attempts.length ? "ai_returned_no_chief_complaint" : "no_ai_keys"
  for (const attempt of attempts) {
    try {
      const brief = normalizeBrief(await attempt(), "ai")
      if (brief.mainConcern) return brief
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.warn("Doctor brief AI attempt failed:", lastError)
    }
  }
  return { ...basicBriefFromConversation(concern, args.history), aiError: lastError }
}

// Plain text version stored with the report and shown in the doctor's notification.
export const briefToSummaryText = (brief: DoctorBrief): string => {
  if (brief.source === "none") return brief.mainConcern || "Booked directly, no AI conversation before this appointment."
  if (brief.source === "basic") return `AI summary unavailable. ${brief.mainConcern || ""} Patient said: ${(brief.patientWords || []).join(" | ")}`.trim()
  return [
    brief.mainConcern,
    brief.summary,
    brief.duration && `Duration: ${brief.duration}.`,
    brief.progression && `Course: ${brief.progression}.`,
    brief.severity && `Severity: ${brief.severity}.`,
    brief.symptoms.length ? `Symptoms: ${brief.symptoms.join(", ")}.` : "",
    brief.redFlags.length ? `Red flags: ${brief.redFlags.join(", ")}.` : "",
  ].filter(Boolean).join(" ")
}

const istStamp = (date: Date): string =>
  date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })

const present = (value: unknown): string => {
  const text = toPdfSafeText(value)
  return !text || NOT_STATED.test(text) ? "" : text
}

// pdf-lib is passed in because Edge Functions and the local test script load it from different places.
export const renderDoctorBriefPdf = async (
  pdfLib: { PDFDocument: any; StandardFonts: any; rgb: any },
  args: {
    brief: DoctorBrief
    patient: { name?: string; age?: string; gender?: string; phone?: string; weight?: string; bloodPressure?: string; pulse?: string }
    doctorName?: string
    doctorSpecialization?: string
    slotLabel?: string
    reportId?: string
    generatedAt?: Date
  },
): Promise<Uint8Array> => {
  const { PDFDocument, StandardFonts, rgb } = pdfLib
  const pdf = await PDFDocument.create()
  pdf.setTitle("CD4 Pre-Consultation Clinical Summary")
  pdf.setProducer("CD4")
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const c = {
    brand: rgb(0.016, 0.373, 0.275),
    head: rgb(0.925, 0.961, 0.945),
    label: rgb(0.965, 0.973, 0.98),
    ink: rgb(0.059, 0.09, 0.165),
    muted: rgb(0.357, 0.42, 0.51),
    line: rgb(0.796, 0.835, 0.882),
    danger: rgb(0.659, 0.09, 0.09),
    dangerSoft: rgb(0.996, 0.945, 0.945),
    white: rgb(1, 1, 1),
  }
  const PAGE_W = 595
  const PAGE_H = 842
  const LEFT = 36
  const WIDTH = PAGE_W - LEFT * 2
  const FOOTER_TOP = 54
  const PAD_X = 7
  const PAD_Y = 3.5
  const FONT = 9.5
  const LINE = 12
  const { brief } = args

  const wrap = (value: string, width: number, size = FONT, font = regular): string[] => {
    const lines: string[] = []
    let line = ""
    for (const word of toPdfSafeText(value).split(" ").filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
    return lines.length ? lines : [""]
  }

  let page: any
  let y = 0
  const stamp = istStamp(args.generatedAt || new Date())
  const ref = String(args.reportId || "").slice(0, 8).toUpperCase()

  const text = (value: string, x: number, atY: number, size = FONT, font = regular, color = c.ink) =>
    page.drawText(toPdfSafeText(value), { x, y: atY, size, font, color })

  const logo = await embedCd4Logo(pdf)

  const startPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H])
    const right = LEFT + WIDTH
    if (pdf.getPageCount() === 1) {
      page.drawImage(logo, { x: LEFT, y: PAGE_H - 70, width: 44, height: 44 })
      text("Pre-Consultation Clinical Summary", LEFT + 56, PAGE_H - 44, 15, bold, c.ink)
      text(brief.source === "none" ? "Appointment details" : "Prepared by AI from the patient's conversation, for the doctor's review", LEFT + 56, PAGE_H - 59, 8.5, regular, c.muted)
      const stampText = toPdfSafeText(stamp)
      text(stampText, right - regular.widthOfTextAtSize(stampText, 8.5), PAGE_H - 44, 8.5, regular, c.muted)
      if (ref) {
        const refText = `Ref: ${ref}`
        text(refText, right - regular.widthOfTextAtSize(refText, 8.5), PAGE_H - 59, 8.5, regular, c.muted)
      }
      page.drawLine({ start: { x: LEFT, y: PAGE_H - 80 }, end: { x: right, y: PAGE_H - 80 }, thickness: 1.5, color: c.brand })
      y = PAGE_H - 96
    } else {
      page.drawImage(logo, { x: LEFT, y: PAGE_H - 46, width: 22, height: 22 })
      text(`Clinical Summary  |  ${present(args.patient.name) || "Patient"}`, LEFT + 30, PAGE_H - 39, 9.5, bold, c.ink)
      page.drawLine({ start: { x: LEFT, y: PAGE_H - 54 }, end: { x: right, y: PAGE_H - 54 }, thickness: 1, color: c.brand })
      y = PAGE_H - 70
    }
  }

  // Moves to a new page rather than dropping anything a doctor should read.
  const ensureSpace = (height: number) => {
    if (y - height < FOOTER_TOP + 8) startPage()
  }

  const heading = (label: string, color = c.brand) => {
    ensureSpace(16 + 24)
    text(label, LEFT, y - 9, 9.5, bold, color)
    y -= 15
  }

  const cell = (x: number, width: number, height: number, fill: any = null) => {
    page.drawRectangle({ x, y: y - height, width, height, color: fill || c.white, borderColor: c.line, borderWidth: 0.6 })
  }

  const cellText = (lines: string[], x: number, font = regular, color = c.ink) => {
    lines.forEach((line, index) => text(line, x + PAD_X, y - PAD_Y - 8.5 - index * LINE, FONT, font, color))
  }

  const rowHeight = (lineCount: number) => PAD_Y * 2 + 4 + lineCount * LINE - 2

  // Label on the left, value on the right. A long value keeps wrapping, across pages if it has to.
  const labelledTable = (rows: Array<[string, string]>, labelWidth = 128) => {
    const valueWidth = WIDTH - labelWidth
    rows.forEach(([label, value]) => {
      const missing = !value
      const lines = wrap(missing ? "Not mentioned" : value, valueWidth - PAD_X * 2)
      const labelLines = wrap(label, labelWidth - PAD_X * 2, FONT, bold)
      const height = rowHeight(Math.max(lines.length, labelLines.length))
      ensureSpace(height)
      cell(LEFT, labelWidth, height, c.label)
      cell(LEFT + labelWidth, valueWidth, height)
      cellText(labelLines, LEFT, bold, c.muted)
      cellText(lines, LEFT + labelWidth, regular, missing ? c.muted : c.ink)
      y -= height
    })
    y -= 10
  }

  // Patient and appointment details side by side.
  const fourColumnTable = (rows: Array<[string, string, string, string]>) => {
    const labelWidth = 76
    const valueWidth = WIDTH / 2 - labelWidth
    rows.forEach(([labelA, valueA, labelB, valueB]) => {
      const linesA = wrap(valueA || "-", valueWidth - PAD_X * 2)
      const linesB = wrap(valueB || "-", valueWidth - PAD_X * 2)
      const height = rowHeight(Math.max(linesA.length, linesB.length))
      ensureSpace(height)
      const middle = LEFT + WIDTH / 2
      cell(LEFT, labelWidth, height, c.label)
      cell(LEFT + labelWidth, valueWidth, height)
      cell(middle, labelWidth, height, c.label)
      cell(middle + labelWidth, valueWidth, height)
      cellText([labelA], LEFT, bold, c.muted)
      cellText(linesA, LEFT + labelWidth, regular, valueA ? c.ink : c.muted)
      cellText([labelB], middle, bold, c.muted)
      cellText(linesB, middle + labelWidth, regular, valueB ? c.ink : c.muted)
      y -= height
    })
    y -= 10
  }

  // Full-width shaded box, used for the chief complaint and danger signs.
  const box = (lines: string[], fill: any, font = bold, color = c.ink) => {
    const height = rowHeight(lines.length) + 2
    ensureSpace(height)
    cell(LEFT, WIDTH, height, fill)
    cellText(lines, LEFT, font, color)
    y -= height + 10
  }

  const ageSex = [present(args.patient.age), present(args.patient.gender)].filter(Boolean).join(" / ")
  const vitals = [
    present(args.patient.bloodPressure) && `BP ${present(args.patient.bloodPressure)}`,
    present(args.patient.pulse) && `Pulse ${present(args.patient.pulse)}`,
    present(args.patient.weight) && `Wt ${present(args.patient.weight)}`,
  ].filter(Boolean).join(", ")

  startPage()

  heading("PATIENT AND APPOINTMENT")
  fourColumnTable([
    ["Patient", present(args.patient.name) || "Patient", "Doctor", present(args.doctorName)],
    ["Age / Sex", ageSex, "Speciality", present(args.doctorSpecialization)],
    ["Phone", present(args.patient.phone), "Appointment", present(args.slotLabel)],
    ["Vitals", vitals ? `${vitals} (patient profile)` : "", "Summary from", brief.source === "ai" ? "AI chat or voice history" : brief.source === "basic" ? "Patient's own words" : "No AI conversation"],
  ])

  heading("CHIEF COMPLAINT")
  box(wrap(brief.mainConcern || "The patient did not state a clear concern.", WIDTH - PAD_X * 2, FONT, bold), c.head)

  if (brief.source === "none") {
    box(["The patient booked directly, without an AI conversation. Please take the full history during the consultation."], c.white, regular, c.muted)
  } else if (brief.source === "basic") {
    box(wrap("The AI summary could not be prepared for this booking. Below is what the patient typed, unprocessed. Please take the history during the consultation.", WIDTH - PAD_X * 2), c.dangerSoft, regular, c.danger)
    heading("PATIENT'S OWN WORDS")
    labelledTable((brief.patientWords?.length ? brief.patientWords : ["No messages available."]).map((line, index) => [String(index + 1), line]), 28)
  } else {
    if (brief.redFlags.length || brief.allergies) {
      heading("ALERTS", c.danger)
      const alertLines = [
        ...(brief.allergies ? wrap(`Allergy: ${brief.allergies}`, WIDTH - PAD_X * 2, FONT, bold) : []),
        ...brief.redFlags.flatMap((flag) => wrap(`Danger sign reported: ${flag}`, WIDTH - PAD_X * 2, FONT, bold)),
      ]
      box(alertLines, c.dangerSoft, bold, c.danger)
    }

    heading("HISTORY OF PRESENT ILLNESS")
    labelledTable([
      ["Summary", brief.summary],
      ["Onset", brief.onset],
      ["Duration", brief.duration],
      ["Course", brief.progression],
      ["Severity", brief.severity],
      ["Better / worse with", brief.triggers],
      ["Treatment tried", brief.treatmentTried],
    ])

    heading("SYMPTOM REVIEW")
    const half = WIDTH / 2
    const headerHeight = rowHeight(1)
    ensureSpace(headerHeight * 2)
    cell(LEFT, half, headerHeight, c.head)
    cell(LEFT + half, half, headerHeight, c.head)
    cellText(["Reported by patient"], LEFT, bold)
    cellText(["Denied by patient"], LEFT + half, bold)
    y -= headerHeight
    const reported = wrap(brief.symptoms.join(", ") || "None stated", half - PAD_X * 2)
    const denied = wrap(brief.notPresent.join(", ") || "None stated", half - PAD_X * 2)
    const height = rowHeight(Math.max(reported.length, denied.length))
    ensureSpace(height)
    cell(LEFT, half, height)
    cell(LEFT + half, half, height)
    cellText(reported, LEFT, regular, brief.symptoms.length ? c.ink : c.muted)
    cellText(denied, LEFT + half, regular, brief.notPresent.length ? c.ink : c.muted)
    y -= height + 10

    heading("MEDICAL BACKGROUND")
    labelledTable([
      ["Current medicines", brief.medicines],
      ["Allergies", brief.allergies],
      ["Past medical history", brief.medicalHistory],
    ])

    if (brief.confirmInConsult.length) {
      heading("TO CONFIRM DURING THE CONSULTATION")
      labelledTable(brief.confirmInConsult.map((item, index) => [String(index + 1), item]), 28)
    }
  }

  // Footer on every page, drawn last so it can say how many pages there are.
  const pages = pdf.getPages()
  const notice = brief.source === "basic"
    ? "AI summary unavailable. These are the patient's unprocessed words. Not a diagnosis. Take the history with the patient."
    : brief.source === "none"
      ? "No AI conversation took place before this booking."
      : "AI-generated from what the patient said, translated to simple English. Not a diagnosis. Verify with the patient."
  pages.forEach((current: any, index: number) => {
    current.drawLine({ start: { x: LEFT, y: FOOTER_TOP - 6 }, end: { x: LEFT + WIDTH, y: FOOTER_TOP - 6 }, thickness: 0.8, color: c.line })
    current.drawText(notice, { x: LEFT, y: FOOTER_TOP - 20, size: 8, font: regular, color: c.muted })
    const pageLabel = `Page ${index + 1} of ${pages.length}`
    current.drawText(`CD4${ref ? `  |  Ref ${ref}` : ""}  |  Confidential patient information`, { x: LEFT, y: FOOTER_TOP - 32, size: 8, font: regular, color: c.muted })
    current.drawText(pageLabel, { x: LEFT + WIDTH - regular.widthOfTextAtSize(pageLabel, 8), y: FOOTER_TOP - 32, size: 8, font: regular, color: c.muted })
  })

  return await pdf.save()
}

// Last resort if the designed page fails to draw: plain text, so a booking never reaches the doctor without its summary.
export const renderPlainBriefPdf = async (
  pdfLib: { PDFDocument: any; StandardFonts: any; rgb: any },
  args: { patientName?: string; concern?: string; summary?: string; doctorName?: string; slotLabel?: string },
): Promise<Uint8Array> => {
  const { PDFDocument, StandardFonts, rgb } = pdfLib
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const ink = rgb(0.059, 0.09, 0.165)
  const lines = [
    "CD4 Pre-consultation Brief",
    "",
    `Patient: ${present(args.patientName) || "Patient"}`,
    `Appointment: ${[present(args.doctorName), present(args.slotLabel)].filter(Boolean).join(", ") || "Not available"}`,
    `Concern: ${present(args.concern) || "Not specified"}`,
    "",
    ...(toPdfSafeText(args.summary).match(/.{1,92}(\s|$)/g) || []).slice(0, 30).map((line) => line.trim()),
    "",
    "AI-generated from what the patient said. Not a diagnosis. Please verify with the patient.",
  ]
  lines.forEach((line, index) => page.drawText(line, { x: 40, y: 790 - index * 16, size: 11, font, color: ink }))
  return await pdf.save()
}
