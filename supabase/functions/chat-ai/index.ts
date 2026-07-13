// @ts-nocheck
// Fresh medical chat foundation for the CD4 AI Guidance screen.
/// <reference lib="deno.window" />
// The client contract is intentionally compatible with app/ai-guidance.tsx.

import { createClient } from "npm:@supabase/supabase-js@2"
import { CLINICAL_BRAIN_RULES } from "../_shared/clinicalBrain.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const OPENAI_MODEL = Deno.env.get("CHAT_AI_OPENAI_MODEL")?.trim() || "gpt-4o-mini"
const OPENAI_FALLBACK_MODEL = Deno.env.get("CHAT_AI_OPENAI_FALLBACK_MODEL")?.trim() || "gpt-4o-mini"
const GEMINI_MODEL = Deno.env.get("CHAT_AI_GEMINI_MODEL")?.trim() || "gemini-2.5-flash"
const MAX_HISTORY_ITEMS = 5
const MAX_MESSAGE_CHARS = 4000
const MAX_HISTORY_CHARS = 1400
// The model must return both structured JSON and a readable clinical reply.
// 520 tokens can truncate the JSON/reply mid-sentence on otherwise normal turns.
const MAX_OUTPUT_TOKENS = 900

const normalize = (value: unknown): string =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")

const clip = (value: unknown, max: number): string => {
  const text = String(value || "").trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const hasDevanagari = (value: string): boolean => /[\u0900-\u097F]/.test(value)

const hasRomanHindiSignal = (value: string): boolean =>
  /\b(kya|kyun|kyu|kaise|kab|kahan|mujhe|mera|meri|mere|main|mai|aap|aapko|hai|hain|nahi|nahin|haan|han|dard|bukhar|khansi|dawai|ilaaj|takleef|doctor|batao|chahiye|sehat|pet|saans)\b/i.test(value)

type LanguageStyle = "english" | "roman_hindi" | "devanagari_hindi"
type ConversationIntent = "educational" | "symptom_report" | "follow_up" | "consult_request"

const detectLanguage = (message: string, history: Array<{ role: string; content: string }>): LanguageStyle => {
  if (hasDevanagari(message)) return "devanagari_hindi"
  if (hasRomanHindiSignal(message)) return "roman_hindi"
  const recent = history.filter((item) => item.role === "user").slice(-3).reverse()
  if (recent.some((item) => hasDevanagari(item.content))) return "devanagari_hindi"
  if (recent.some((item) => hasRomanHindiSignal(item.content))) return "roman_hindi"
  return "english"
}

const languageInstruction = (style: LanguageStyle): string => {
  if (style === "devanagari_hindi") {
    return "Reply entirely in natural Devanagari Hindi. Do not switch to English or Roman Hindi except unavoidable medical abbreviations."
  }
  if (style === "roman_hindi") {
    return "Reply entirely in natural Roman Hindi/Hinglish using English letters. Do not use Devanagari and do not switch to full English."
  }
  return "Reply entirely in clear, natural English. Do not switch to Hindi or Hinglish."
}

const nonMedicalReply = (style: LanguageStyle): string => {
  if (style === "devanagari_hindi") {
    return "मैं केवल आपके चुने हुए स्वास्थ्य संबंधी concern और medical questions में मदद कर सकता हूँ। कृपया अपने symptoms, report, medicine या health concern के बारे में बताइए।"
  }
  if (style === "roman_hindi") {
    return "Main sirf aapke selected health concern aur medical questions me madad kar sakta hoon. Kripya apne symptoms, report, medicine ya health concern ke baare me batayein."
  }
  return "I can help only with your selected health concern and medical questions. Please tell me about your symptoms, report, medicine, or health concern."
}

const cleanHistory = (value: unknown): Array<{ role: "user" | "assistant"; content: string }> => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => (item?.role === "user" || item?.role === "assistant") && typeof item?.content === "string")
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => ({ role: item.role, content: clip(item.content, MAX_HISTORY_CHARS) }))
    .filter((item) => item.content.length > 0)
}

const buildSystemPrompt = (
  concern: string,
  style: LanguageStyle,
  context: { intent: ConversationIntent; activeTopic: string; clinicalSummary: string },
): string => `
You are CD4 Health Assistant, a warm and clinically careful medical conversation assistant.

The patient selected this concern: "${clip(concern || "General health", 120)}".
Your job is to understand the patient's concern and collect a useful clinical history for a doctor.
Current conversation intent: ${context.intent}
Current active topic: ${clip(context.activeTopic || concern || "general health", 120)}
Compact clinical context from recent turns: ${clip(context.clinicalSummary || "No previous clinical details captured yet.", 700)}

${CLINICAL_BRAIN_RULES}

Conversation behavior:
- Sound like a real, attentive junior doctor: acknowledge what the patient said briefly, then choose the correct response mode.
- Use calibrated clinical empathy, not a repeated scripted apology. If the patient sounds uncomfortable or worried, briefly acknowledge the experience (for example, "That sounds uncomfortable" or "Mujhe afsos hai ki aapko aisa feel ho raha hai") and then be useful. If the message is neutral or educational, answer directly without forced sympathy.
- For a first personal symptom message, use this order: acknowledge/validate → check urgent danger when relevant → one focused question → explain what the answer will help clarify. Do not open with a long checklist.
- Do not claim to feel the patient's pain, do not say "everything will be fine," and do not imply that you are a licensed doctor. Say "I can help you understand this and prepare the right information for a doctor" when reassurance is needed.
- Keep empathy specific to the patient's words. Vary natural wording across turns, avoid excessive emojis, and do not repeat the same reassurance unless the patient remains distressed.
- When giving self-care, use low-risk supportive steps only (rest, fluids when appropriate, monitoring, avoiding known triggers) and explain when professional care is needed. Never let warmth replace a red-flag check.
- Treat the selected concern as background context, but always prioritize the patient's latest clear medical question. If the latest message names another medical symptom or condition, answer that current question naturally; do not force the old concern into the answer. Connect it to the selected concern only when clinically relevant.
- When the patient reports a personal symptom or asks what to do, conduct clinical history-taking: ask specific questions about onset, severity, associated symptoms, triggers, impact, medicines, allergies, and relevant history. Ask only one question at a time while information is incomplete.
- When the patient asks a direct educational question such as "what are the basic symptoms?", "symptoms of cough", or "symptoms of fever", you MUST answer the latest named condition first with a short Markdown bullet list. Add warning signs when relevant, then optionally ask one personal follow-up question. Never answer an educational question with only a request for the patient's own symptoms, and never say you are focusing on the old selected concern when the latest question is clear.
- Understand ordinary spelling mistakes, missing words, phonetic typing, speech-to-text errors, Roman Hindi, and mixed language from context. Silently infer the most likely meaning; do not criticize or mention the typo. If two meanings are genuinely possible, state your best interpretation briefly and ask a gentle clarification.
- Do not claim a confirmed diagnosis. Give general safety guidance only when appropriate.
- Never prescribe a medicine or give a dose as if you are the patient's doctor.
- Clearly recommend urgent/emergency care for red flags such as severe breathing difficulty, chest pressure, fainting, stroke-like symptoms, severe bleeding, confusion, or rapidly worsening condition.
- Do not discuss entertainment, coding, politics, finance, shopping, weather, or other non-medical topics. Politely redirect to health.
- Do not invent doctors, appointments, reports, test results, or actions taken.
- Decide whether the patient should be encouraged to consult a doctor. Set consultRecommended=true for red flags, severe or rapidly worsening symptoms, concerning persistent symptoms, a likely need for examination/testing, or when the patient explicitly asks to see a doctor. Keep it false for routine low-risk education or simple history questions.
- Set consultPriority to "immediate" for emergency warning signs, "soon" when timely doctor review is appropriate, or null when no consultation recommendation is needed. Set needsHumanReview=true only for urgent/high-risk situations.

${languageInstruction(style)}
Make the reply rich but easy to read in mobile chat: use short paragraphs, **bold** important terms, a small Markdown bullet list when useful, and at most one or two natural, gentle emojis. Do not use emojis in emergency warnings. Keep it clinically organized and directly related to the latest active topic. Keep the reply concise enough for a mobile message, but never end mid-word, mid-sentence, or with a dangling phrase such as "and", "when", or "because"; finish the final sentence before returning JSON.

Return only valid JSON in this exact shape (the reply value may contain Markdown):
{"isMedical":true,"intent":"symptom_report","activeTopic":"cough","clinicalSummary":"Short factual summary under 700 characters","reply":"...","consultRecommended":false,"consultPriority":null,"needsHumanReview":false,"riskScore":0.1,"reviewReason":null}
`

const extractOpenAiText = (payload: any): string =>
  String(payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || "").trim()

const callOpenAI = async (apiKey: string, messages: Array<{ role: string; content: string }>): Promise<{ text: string; model: string }> => {
  // Keep deployed functions resilient if an old project secret contains a retired
  // or misspelled model name. The last candidates are known-compatible fallbacks.
  const models = Array.from(new Set([
    OPENAI_MODEL,
    OPENAI_FALLBACK_MODEL,
    "gpt-4o-mini",
    "gpt-4o",
  ].filter(Boolean)))
  let lastError = "OpenAI request failed"
  for (const model of models) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.25, max_tokens: MAX_OUTPUT_TOKENS, response_format: { type: "json_object" } }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      const text = extractOpenAiText(payload)
      if (text) return { text, model }
    }
    lastError = payload?.error?.message || `${response.status} ${response.statusText}`
  }
  throw new Error(lastError)
}

const callGemini = async (apiKey: string, messages: Array<{ role: string; content: string }>): Promise<{ text: string; model: string }> => {
  const prompt = messages
    .map((item) => `${item.role === "system" ? "SYSTEM" : item.role === "assistant" ? "ASSISTANT" : "PATIENT"}: ${item.content}`)
    .join("\n\n")
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" } }),
  })
  const payload = await response.json().catch(() => ({}))
  const text = String(payload?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim()
  if (!response.ok || !text) throw new Error(payload?.error?.message || "Gemini request failed")
  return { text, model: GEMINI_MODEL }
}

const parseConversationDecision = (value: string, concern: string): {
  isMedical: boolean
  intent: ConversationIntent
  activeTopic: string
  clinicalSummary: string
} | null => {
  const normalized = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  try {
    const parsed = JSON.parse(normalized)
    if (typeof parsed?.isMedical === "boolean") {
      const validIntents: ConversationIntent[] = ["educational", "symptom_report", "follow_up", "consult_request"]
      return {
        isMedical: parsed.isMedical,
        intent: validIntents.includes(parsed.intent) ? parsed.intent : "symptom_report",
        activeTopic: typeof parsed.activeTopic === "string" && parsed.activeTopic.trim() ? parsed.activeTopic.trim() : concern,
        clinicalSummary: typeof parsed.clinicalSummary === "string" ? clip(parsed.clinicalSummary, 700) : "",
      }
    }
  } catch {
    const objectMatch = normalized.match(/\{[\s\S]*?\}/)
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0])
        if (typeof parsed?.isMedical === "boolean") {
          const validIntents: ConversationIntent[] = ["educational", "symptom_report", "follow_up", "consult_request"]
          return {
            isMedical: parsed.isMedical,
            intent: validIntents.includes(parsed.intent) ? parsed.intent : "symptom_report",
            activeTopic: typeof parsed.activeTopic === "string" && parsed.activeTopic.trim() ? parsed.activeTopic.trim() : concern,
            clinicalSummary: typeof parsed.clinicalSummary === "string" ? clip(parsed.clinicalSummary, 700) : "",
          }
        }
      } catch {
        // Treat an unparseable classifier response as ambiguous.
      }
    }
  }
  return null
}

type AssistantDecision = {
  isMedical: boolean
  intent: ConversationIntent
  activeTopic: string
  clinicalSummary: string
  reply: string
  consultRecommended: boolean
  consultPriority: "immediate" | "soon" | null
  needsHumanReview: boolean
  riskScore: number
  reviewReason: string | null
}

const parseAssistantDecision = (value: string): AssistantDecision => {
  const fallback: AssistantDecision = {
    isMedical: true,
    intent: "symptom_report",
    activeTopic: "",
    clinicalSummary: "",
    reply: value.trim(),
    consultRecommended: false,
    consultPriority: null,
    needsHumanReview: false,
    riskScore: 0.1,
    reviewReason: null,
  }
  const normalized = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  try {
    const parsed = JSON.parse(normalized)
    if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) return fallback
    const validIntents: ConversationIntent[] = ["educational", "symptom_report", "follow_up", "consult_request"]
    const priority = parsed.consultPriority === "immediate" || parsed.consultPriority === "soon"
      ? parsed.consultPriority
      : null
    return {
      isMedical: parsed.isMedical !== false,
      intent: validIntents.includes(parsed.intent) ? parsed.intent : "symptom_report",
      activeTopic: typeof parsed.activeTopic === "string" ? parsed.activeTopic.trim() : "",
      clinicalSummary: typeof parsed.clinicalSummary === "string" ? clip(parsed.clinicalSummary, 700) : "",
      reply: parsed.reply.trim(),
      consultRecommended: Boolean(parsed.consultRecommended),
      consultPriority: priority,
      needsHumanReview: Boolean(parsed.needsHumanReview),
      riskScore: Math.max(0, Math.min(1, Number(parsed.riskScore) || 0.1)),
      reviewReason: typeof parsed.reviewReason === "string" && parsed.reviewReason.trim() ? parsed.reviewReason.trim() : null,
    }
  } catch {
    const replyMatch = normalized.match(/\"reply\"\s*:\s*\"((?:\\\\.|[^\"\\\\])*)\"/s)
    if (replyMatch) {
      try {
        return { ...fallback, reply: JSON.parse(`\"${replyMatch[1]}\"`) }
      } catch {
        // Keep the raw model output as the final fallback.
      }
    }
    const objectMatch = normalized.match(/\{[\s\S]*\}/)
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0])
        if (typeof parsed?.reply === "string" && parsed.reply.trim()) {
          return {
            ...fallback,
            isMedical: parsed.isMedical !== false,
            intent: ["educational", "symptom_report", "follow_up", "consult_request"].includes(parsed.intent) ? parsed.intent : "symptom_report",
            activeTopic: typeof parsed.activeTopic === "string" ? parsed.activeTopic.trim() : "",
            clinicalSummary: typeof parsed.clinicalSummary === "string" ? clip(parsed.clinicalSummary, 700) : "",
            reply: parsed.reply.trim(),
            consultRecommended: Boolean(parsed.consultRecommended),
            consultPriority: parsed.consultPriority === "immediate" || parsed.consultPriority === "soon" ? parsed.consultPriority : null,
            needsHumanReview: Boolean(parsed.needsHumanReview),
            riskScore: Math.max(0, Math.min(1, Number(parsed.riskScore) || 0.1)),
            reviewReason: typeof parsed.reviewReason === "string" ? parsed.reviewReason : null,
          }
        }
      } catch {
        // Keep the raw model output as the final fallback.
      }
    }
    return fallback
  }
}

const classifyConversation = async (
  concern: string,
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  previousSummary: string,
  openAiKey: string,
  geminiKey: string,
): Promise<{ isMedical: boolean; intent: ConversationIntent; activeTopic: string; clinicalSummary: string }> => {
  const scopeMessages = [
    {
      role: "system",
      content: "You are a medical conversation router. Decide whether the latest message belongs in healthcare and classify its intent. Always prioritize the latest clear medical question over the old selected concern. Understand spelling mistakes, missing words, speech-to-text errors, Roman Hindi, Hindi, Hinglish, and mixed language. Classify intent as exactly one of: educational, symptom_report, follow_up, consult_request. Return only valid JSON in this exact shape: {\"isMedical\":true,\"intent\":\"educational\",\"activeTopic\":\"fever\",\"clinicalSummary\":\"Short factual summary of known symptoms and important context\"}. Mark isMedical=false only when clearly unrelated to healthcare. Keep clinicalSummary under 700 characters and never invent facts.",
    },
    {
      role: "user",
      content: JSON.stringify({ selectedConcern: concern, previousSummary, recentConversation: history.slice(-5), latestMessage: message }),
    },
  ]

  try {
    const result = openAiKey ? await callOpenAI(openAiKey, scopeMessages) : await callGemini(geminiKey, scopeMessages)
    return parseConversationDecision(result.text, concern) ?? { isMedical: true, intent: "symptom_report", activeTopic: concern, clinicalSummary: previousSummary }
  } catch (primaryError) {
    if (openAiKey && geminiKey) {
      try {
        const result = await callGemini(geminiKey, scopeMessages)
        return parseConversationDecision(result.text, concern) ?? { isMedical: true, intent: "symptom_report", activeTopic: concern, clinicalSummary: previousSummary }
      } catch {
        console.warn("[chat-ai] AI scope fallback failed", primaryError)
      }
    } else {
      console.warn("[chat-ai] AI scope classification failed", primaryError)
    }
    // Do not block a potentially important medical message if routing times out.
    return { isMedical: true, intent: "symptom_report", activeTopic: concern, clinicalSummary: previousSummary }
  }
}

const detectEmergencySignal = (message: string, history: Array<{ role: string; content: string }>): boolean => {
  const text = `${message} ${history.slice(-3).map((item) => item.content).join(" ")}`.toLowerCase()
  return /\b(chest pain|pressure in chest|severe breathing|difficulty breathing|shortness of breath|can't breathe|cannot breathe|fainted|unconscious|confusion|confused|stroke|face drooping|slurred speech|severe bleeding|bleeding heavily|bahut khoon|saans nahi|saans lene mein dikkat|behosh|hosh nahi|seene mein tez dard)\b/i.test(text)
}

const wantsDoctorOrBooking = (message: string): boolean =>
  /\b(doctor|dr\.?|specialist|consult|appointment|book|slot|clinic|hospital|dikhao|dikhaiye|milao|bulao|doctor se|इलाज|डॉक्टर|अपॉइंटमेंट)\b/i.test(message)

const hasExplicitBookingConfirmation = (message: string, history: Array<{ role: string; content: string }>): boolean => {
  const recentUserText = history
    .filter((item) => item.role === "user")
    .slice(-2)
    .map((item) => item.content)
    .join(" ")
  const text = `${recentUserText} ${message}`.toLowerCase().trim()
  if (/\b(no|not|don't|do not|cancel|nahi|nahin|mat)\b/.test(text)) return false
  return /(^|\s)(yes|yeah|yep|confirm|confirmed|book it|go ahead|okay|ok|haan|han|ji haan|theek hai|thik hai|kar do|book kar do)(\s|$)/i.test(text)
}

const resolveSpecialtySearchTerms = (value: string): string[] => {
  const text = normalize(value)
  if (/diabet|sugar|thyroid|hormone|insulin/.test(text)) return ["endocrin", "diabet", "metabolic"]
  if (/typhoid|malaria|dengue|infection|infectious|prolonged fever|high fever/.test(text)) return ["infectious", "internal medicine", "general medicine", "physician"]
  if (/heart|cardiac|chest|bp|blood pressure|palpitation/.test(text)) return ["cardio", "heart", "internal medicine"]
  if (/cough|breath|lung|asthma|copd|saans/.test(text)) return ["pulmon", "respiratory", "chest physician"]
  if (/skin|rash|acne|allerg|eczema|itch/.test(text)) return ["dermat", "skin", "allerg"]
  if (/bone|joint|back|knee|fracture|muscle|arthritis/.test(text)) return ["ortho", "orthopedic", "rheumat"]
  if (/pregnan|period|women|gynec|menstrual|pcos/.test(text)) return ["gynec", "obstetric", "women"]
  if (/stomach| पेट |gastric|liver|digestion|diarr|constipation|vomit/.test(text)) return ["gastro", "gastroenter", "hepat"]
  if (/brain|headache|migraine|seizure|nerve|numbness|stroke/.test(text)) return ["neurolog", "neuro"]
  if (/kidney|urine|urinary|bladder|prostate|burning urine/.test(text)) return ["nephro", "urolog", "renal"]
  if (/ear|nose|throat|sinus|hearing|ent/.test(text)) return ["ent", "otolaryng"]
  if (/eye|vision|sight/.test(text)) return ["ophthalm", "eye"]
  if (/child|baby|infant|pediatric/.test(text)) return ["pediatric", "paediatric", "child"]
  if (/mental|anxiety|depress|panic|sleep|stress|suicid/.test(text)) return ["psychiatr", "psycholog", "mental"]
  return []
}

const formatSlotLabel = (slot: any): string => {
  const date = typeof slot?.date === "string" ? slot.date : ""
  const start = typeof slot?.start_time === "string" ? slot.start_time.slice(0, 5) : ""
  const end = typeof slot?.end_time === "string" ? slot.end_time.slice(0, 5) : ""
  return `${date}${start ? ` • ${start}${end ? `–${end}` : ""}` : ""}`.trim()
}

const loadDoctorRecommendations = async (admin: any, topic: string, requestedCity: string): Promise<any> => {
  const city = clip(requestedCity, 80)
  const specialtyTerms = resolveSpecialtySearchTerms(topic)
  const fields = "id,city,specialization,experience,fee,rating,first_name,last_name,profile_picture"
  let query = admin.from("doctors_public").select(fields).limit(6)
  if (city) query = query.ilike("city", `%${city}%`)
  if (specialtyTerms.length) {
    query = query.or(specialtyTerms.map((term) => `specialization.ilike.%${term}%`).join(","))
  }
  let { data: doctors } = await query
  let mode = city ? "local" : "app"

  // Location is first priority, but do not leave the patient without an app doctor.
  if ((!doctors || doctors.length === 0) && city && specialtyTerms.length) {
    const fallback = await admin.from("doctors_public").select(fields)
      .or(specialtyTerms.map((term) => `specialization.ilike.%${term}%`).join(","))
      .limit(6)
    doctors = fallback.data || []
    mode = "app_specialty_fallback"
  }
  if ((!doctors || doctors.length === 0) && city) {
    const fallback = await admin.from("doctors_public").select(fields).limit(6)
    doctors = fallback.data || []
    mode = "app_fallback"
  }
  doctors = Array.isArray(doctors) ? doctors : []
  const normalizedDoctors = doctors.map((doctor: any) => ({
    id: doctor.id,
    firstName: doctor.first_name || "",
    lastName: doctor.last_name || "",
    city: doctor.city || "",
    specialization: doctor.specialization || "",
    experience: doctor.experience || "",
    fee: doctor.fee || "",
    rating: Number(doctor.rating || 0),
    image: doctor.profile_picture || "",
  }))

  let slotOptions: any[] = []
  const firstDoctor = normalizedDoctors[0]
  if (firstDoctor?.id) {
    const today = new Date().toISOString().slice(0, 10)
    const slotsResult = await admin.from("slots")
      .select("id,doctor_id,date,start_time,end_time")
      .eq("doctor_id", firstDoctor.id)
      .eq("is_booked", false)
      .gte("date", today)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(6)
    slotOptions = (slotsResult.data || []).map((slot: any) => ({
      id: slot.id,
      doctorId: slot.doctor_id,
      date: slot.date,
      startTime: slot.start_time,
      endTime: slot.end_time,
      label: formatSlotLabel(slot),
    }))
  }
  return { doctors: normalizedDoctors, slotOptions, mode, city: city || null }
}

const bookSlotWithoutPayment = async (admin: any, userId: string, doctorId: string, slotId: string): Promise<any> => {
  if (!doctorId || !slotId) return null
  const { data: claimedSlot, error: claimError } = await admin.from("slots")
    .update({ is_booked: true })
    .eq("id", slotId).eq("doctor_id", doctorId).eq("is_booked", false)
    .select("id,doctor_id,date,start_time,end_time").maybeSingle()
  if (claimError || !claimedSlot) return { status: "conflict", message: "That slot is no longer available. Please choose another slot." }
  const { data: appointment, error } = await admin.from("appointments")
    .insert({ patient_id: userId, doctor_id: doctorId, slot_id: slotId, status: "confirmed" })
    .select("id").single()
  if (error || !appointment) {
    await admin.from("slots").update({ is_booked: false }).eq("id", slotId).eq("doctor_id", doctorId)
    return { status: "error", message: "I could not confirm this slot. Please try again." }
  }
  await admin.from("slots").update({ appointment_id: appointment.id }).eq("id", slotId).eq("doctor_id", doctorId)
  const doctorResult = await admin.from("doctors_public").select("first_name,last_name,specialization,city,fee").eq("id", doctorId).maybeSingle()
  const doctor = doctorResult.data || {}
  return {
    status: "confirmed",
    appointmentId: appointment.id,
    doctorName: `${doctor.first_name || ""} ${doctor.last_name || ""}`.trim() || "your doctor",
    doctorSpecialization: doctor.specialization || "",
    doctorCity: doctor.city || "",
    doctorFee: doctor.fee || "",
    slotDate: claimedSlot.date,
    slotStartTime: claimedSlot.start_time,
    slotEndTime: claimedSlot.end_time,
    slotLabel: formatSlotLabel(claimedSlot),
  }
}

const streamResponse = (payload: any): Response => {
  const encoder = new TextEncoder()
  const text = String(payload?.data?.reply || "")
  const chunks = text.match(/.{1,55}(?:\s+|$)/g) || [text]
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      for (const chunk of chunks) {
        if (chunk) emit("delta", { text: chunk })
        await new Promise((resolve) => setTimeout(resolve, 8))
      }
      emit("done", payload)
      controller.close()
    },
  })
  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } })
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return new Response(JSON.stringify({ success: false, message: "POST required" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } })

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || ""
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || ""
  const authToken = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim()
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" }

  if (!supabaseUrl || !serviceRoleKey || (!openAiKey && !geminiKey)) {
    return new Response(JSON.stringify({ success: false, message: "AI function environment is not configured" }), { status: 500, headers: jsonHeaders })
  }
  if (!authToken) return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: jsonHeaders })

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: userData, error: authError } = await admin.auth.getUser(authToken)
    if (authError || !userData.user) return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: jsonHeaders })

    const body = await request.json().catch(() => ({}))
    if (body?.quotaOnly || body?.rateLimitOnly) {
      return new Response(JSON.stringify({ success: true, data: { quotaOnly: true, rateLimit: { blocked: false, used: 0, remaining: 20, limit: 20, isPro: false } } }), { headers: jsonHeaders })
    }

    const message = clip(body?.message, MAX_MESSAGE_CHARS)
    const concern = clip(body?.concern || "General health", 120)
    const history = cleanHistory(body?.history)
    const previousSummary = clip(body?.clinicalSummary, 700)
    const language = detectLanguage(message, history)
    const stream = Boolean(body?.stream)

    if (!message) {
      const emptyPayload = { success: true, data: { reply: language === "english" ? `Please tell me what is happening with your ${concern.toLowerCase()} concern.` : language === "roman_hindi" ? `${concern} se related aapko kya takleef ho rahi hai, batayein.` : `${concern} से जुड़ी आपको क्या तकलीफ़ हो रही है, बताइए।`, message: "", source: "empty_input", model: null, selectedModel: null, rateLimit: { blocked: false, used: 0, remaining: 20, limit: 20 } } }
      return stream ? streamResponse(emptyPayload) : new Response(JSON.stringify(emptyPayload), { headers: jsonHeaders })
    }

    const emergencySignal = detectEmergencySignal(message, history)
    const initialClinicalContext = previousSummary || clip(
      history.filter((item) => item.role === "user").map((item) => item.content).join(" | "),
      700,
    )

    const messages = [
      { role: "system", content: buildSystemPrompt(concern, language, { intent: "symptom_report", activeTopic: concern, clinicalSummary: initialClinicalContext }) },
      ...history,
      { role: "user", content: message },
    ]
    let generation: { text: string; model: string; source: string }
    try {
      if (openAiKey) {
        const result = await callOpenAI(openAiKey, messages)
        generation = { ...result, source: "openai" }
      } else {
        const result = await callGemini(geminiKey, messages)
        generation = { ...result, source: "gemini" }
      }
    } catch (primaryError) {
      if (openAiKey && geminiKey) {
        const result = await callGemini(geminiKey, messages)
        generation = { ...result, source: "gemini_fallback" }
      } else {
        throw primaryError
      }
    }

    const decision = parseAssistantDecision(generation.text)
    if (!decision.isMedical) {
      const scopePayload = { success: true, data: { reply: nonMedicalReply(language), message: nonMedicalReply(language), source: "medical_scope_guard", intent: decision.intent, activeTopic: decision.activeTopic || concern, clinicalSummary: decision.clinicalSummary || previousSummary, model: generation.model, selectedModel: generation.model, rateLimit: { blocked: false, used: 0, remaining: 20, limit: 20 } } }
      return stream ? streamResponse(scopePayload) : new Response(JSON.stringify(scopePayload), { headers: jsonHeaders })
    }
    const clinicalSummary = decision.clinicalSummary || previousSummary || initialClinicalContext
    if (emergencySignal) {
      decision.consultRecommended = true
      decision.consultPriority = "immediate"
      decision.needsHumanReview = true
      decision.riskScore = Math.max(decision.riskScore, 0.95)
      decision.reviewReason = "emergency_signal"
    }
    const locationCity = clip(body?.searchAreaCity || body?.preferredCity || body?.locationCity, 80)
    const shouldFindDoctors = Boolean(
      body?.showDoctors === true ||
      wantsDoctorOrBooking(message) ||
      (decision.consultRecommended && (body?.replyInVoice || body?.voiceMode)),
    )
    let doctorRecommendations: any[] = []
    let bookingPreparation: any = null
    let bookingConfirmation: any = null
    if (body?.bookDoctorId && body?.bookSlotId) {
      if (hasExplicitBookingConfirmation(message, history)) {
        bookingConfirmation = await bookSlotWithoutPayment(admin, userData.user.id, String(body.bookDoctorId), String(body.bookSlotId))
      } else {
        bookingConfirmation = {
          status: "needs_confirmation",
          message: "Please clearly confirm this specific doctor and slot before booking.",
        }
      }
    }
    if (shouldFindDoctors && !bookingConfirmation) {
      const doctorSearch = await loadDoctorRecommendations(admin, decision.activeTopic || concern, locationCity)
      doctorRecommendations = doctorSearch.doctors
      if (doctorSearch.slotOptions.length > 0) {
        bookingPreparation = {
          slotOptions: doctorSearch.slotOptions,
          doctorId: doctorSearch.doctors[0]?.id || null,
          searchCity: doctorSearch.city,
          source: doctorSearch.mode,
        }
      }
    }
    if (bookingConfirmation?.status === "confirmed") {
      decision.consultRecommended = false
      decision.consultPriority = null
      decision.reply = language === "devanagari_hindi"
        ? `✅ आपका appointment **${bookingConfirmation.doctorName}** के साथ **${bookingConfirmation.slotLabel}** पर confirm हो गया है। कोई payment नहीं लिया गया है।`
        : language === "roman_hindi"
          ? `✅ Aapka appointment **${bookingConfirmation.doctorName}** ke saath **${bookingConfirmation.slotLabel}** par confirm ho gaya hai. Koi payment nahi liya gaya hai.`
          : `✅ Your appointment with **${bookingConfirmation.doctorName}** is confirmed for **${bookingConfirmation.slotLabel}**. No payment was taken.`
    }
    if (bookingConfirmation?.status === "needs_confirmation") {
      decision.reply = language === "devanagari_hindi"
        ? "कृपया इस डॉक्टर और इसी स्लॉट की booking के लिए साफ़ तौर पर हाँ कहें।"
        : language === "roman_hindi"
          ? "Is doctor aur isi slot ki booking ke liye please saaf taur par haan kahiye."
          : "Please clearly confirm this specific doctor and slot before I book it."
    }
    const payload = {
      success: true,
      data: {
        reply: decision.reply,
        message: decision.reply,
        source: generation.source,
        intent: decision.intent,
        activeTopic: decision.activeTopic || concern,
        clinicalSummary,
        model: generation.model,
        selectedModel: generation.model,
        doctorRecommendations,
        bookingPreparation,
        bookingConfirmation,
        bookingPrompt: bookingConfirmation?.status === "confirmed"
          ? "Your appointment is confirmed. No payment was taken."
          : bookingConfirmation?.status === "needs_confirmation"
            ? bookingConfirmation.message
          : bookingPreparation?.slotOptions?.length
            ? "I found these available slots. Choose one to continue."
            : doctorRecommendations.length
              ? "I found verified doctors. Choose a doctor to view booking options."
              : null,
        consultRecommended: decision.consultRecommended,
        consultPriority: decision.consultPriority,
        needsHumanReview: decision.needsHumanReview,
        riskScore: decision.riskScore,
        reviewReason: decision.reviewReason,
        fastResponse: Boolean(body?.fastResponse || body?.quick || body?.replyInVoice),
        transport: stream ? "sse" : "json",
        rateLimit: { blocked: false, used: 0, remaining: 20, limit: 20 },
      },
    }
    return stream ? streamResponse(payload) : new Response(JSON.stringify(payload), { headers: jsonHeaders })
  } catch (error) {
    console.error("[chat-ai] request failed", error)
    return new Response(JSON.stringify({ success: false, message: error instanceof Error ? error.message : "AI response failed" }), { status: 400, headers: jsonHeaders })
  }
})
