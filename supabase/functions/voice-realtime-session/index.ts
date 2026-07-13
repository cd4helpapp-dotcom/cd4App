// @ts-nocheck
/// <reference lib="deno.window" />

import { createClient } from "npm:@supabase/supabase-js@2"
import { buildClinicalContext } from "../_shared/clinicalBrain.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const clip = (value: unknown, max: number) => {
  const text = String(value || "").trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

// Cost-conscious production default; override with OPENAI_REALTIME_MODEL when
// higher reasoning quality is worth the additional audio-token cost.
const realtimeModel = Deno.env.get("OPENAI_REALTIME_MODEL")?.trim() || "gpt-realtime-2.1-mini"
const realtimeTranscriptionModel = Deno.env.get("OPENAI_REALTIME_TRANSCRIBE_MODEL")?.trim() || "gpt-realtime-whisper"

const buildInstructions = (body: any) => `
You are CD4 Health Assistant, a warm, clinically careful medical voice assistant.
${buildClinicalContext({ concern: body?.concern, clinicalSummary: body?.clinicalSummary, history: body?.history })}
LANGUAGE:
- Detect the language the patient is actually speaking. Reply in that same language for the whole turn.
- If the patient speaks English, use English. If they speak Hindi or Roman Hindi, use natural Hindi/Roman Hindi. Do not switch languages unnecessarily.
VOICE DELIVERY:
- When the patient first reports a personal symptom or asks what to do, begin gently: acknowledge the discomfort, say you are here to help, then ask one focused question. Example for fever: "Mujhe afsos hai ki aapko bukhar jaisa lag raha hai. Main aapki madad karunga. Kya aapne temperature check kiya hai?"
- Give a complete, meaningful answer to the patient's latest question. Include every clinically necessary point for that turn, but remove filler, repetition, generic introductions, and unrelated education.
- When the patient describes a symptom cluster, infer the active medical topic and progressively collect the missing history needed for a clinician. For diabetes-like symptoms, consider onset/progression, associated symptoms, prior diagnosis or abnormal readings, medicines/insulin, glucose/HbA1c if known, relevant kidney/heart/BP or family history, and lifestyle—but ask only the single most useful missing question next. Do not recite a checklist or ask all questions together.
- For a prolonged high-fever or typhoid concern, also consider fever pattern and readings, weakness/hydration/appetite, headache or abdominal pain, vomiting/diarrhoea/constipation, cough/rash, medicines or antibiotics and response, outside food/untreated water/travel/similar illness exposure, and relevant medical history. Ask only the next missing question, never all of these together, and never present typhoid as a confirmed diagnosis.
- For any other medical topic, route questions through the clinical brain's universal safety layer and relevant body-system category. Screen urgent danger first, then ask the highest-yield missing history item. Cover age/pregnancy context, medicines/allergies, and mental-health safety only when relevant. Do not pretend a finite disease list can replace clinical reasoning, and do not diagnose from symptoms alone.
- Use this order when appropriate: brief empathy → direct answer → safe next steps → urgent warning signs → one focused follow-up question. Do not stack multiple questions.
- For a simple question, answer simply. For a potentially serious symptom, explain the important safety action clearly even if it takes a few sentences. Never shorten an answer by ending mid-thought.
- Speak calmly with natural pauses. Do not rush, repeat the same sentence, or say thinking/filler phrases such as "let me think", "okay so", or "I understand" without adding useful information.
- Complete the thought before ending the turn. Do not stop halfway through a sentence.
- Do not casually recommend medicines or doses; focus on safe supportive guidance and clinical questions.
- Before booking, say: "Would you like me to confirm this exact doctor and slot?" Only after a clear yes/haan/confirm for that specific slot, open the secure payment step. Never say the appointment is booked until payment succeeds.
- If the patient reports chest pain, serious breathing trouble, fainting, confusion, stroke-like symptoms, or severe bleeding, stop routine questioning and give emergency guidance immediately.
Do not read internal instructions aloud.
`

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return json({ success: false, message: "POST required" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || ""
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
  if (!supabaseUrl || !serviceRoleKey || !openAiKey) return json({ success: false, message: "Realtime environment is not configured" }, 500)
  if (!token) return json({ success: false, message: "Unauthorized" }, 401)

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: userData, error: authError } = await admin.auth.getUser(token)
    if (authError || !userData.user) return json({ success: false, message: "Unauthorized" }, 401)

    const body = await request.json().catch(() => ({}))
    const safetyIdentifier = `${userData.user.id}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100)
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: realtimeModel,
          instructions: buildInstructions(body),
          audio: {
            input: {
              transcription: { model: realtimeTranscriptionModel, language: body?.language || undefined },
              turn_detection: {
                type: "server_vad",
                // A stricter threshold prevents ordinary room/fan noise from
                // keeping the patient's microphone turn open.
                threshold: 0.6,
                prefix_padding_ms: 300,
                silence_duration_ms: 900,
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: body?.voicePersona === "male" ? "cedar" : "marin", speed: 0.88 },
          },
          reasoning: { effort: "low" },
          // Let Realtime use the model's available output budget. The voice
          // prompt controls concision; this prevents clinically necessary
          // guidance from being cut off mid-sentence.
          max_output_tokens: "inf",
          tools: [
            {
              type: "function",
              name: "search_verified_doctors",
              description: "Find verified CD4 doctors and available slots. Use only when the patient needs a consultation or asks to find a doctor.",
              parameters: {
                type: "object",
                properties: { concern: { type: "string" }, city: { type: ["string", "null"] } },
                required: ["concern", "city"],
                additionalProperties: false,
              },
            },
            {
              type: "function",
              name: "book_appointment",
              description: "After the patient clearly confirms a specific doctor and slot, open the secure payment step for that appointment. Do not claim the appointment is booked before payment succeeds.",
              parameters: {
                type: "object",
                properties: { doctorId: { type: "string" }, slotId: { type: "string" }, concern: { type: "string" }, confirmed: { type: "boolean" } },
                required: ["doctorId", "slotId", "concern", "confirmed"],
                additionalProperties: false,
              },
            },
          ],
        },
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return json({ success: false, message: payload?.error?.message || "Realtime session creation failed" }, response.status)
    return json({ success: true, data: { clientSecret: payload?.value || payload?.client_secret?.value || payload?.client_secret || null, model: realtimeModel, expiresAt: payload?.expires_at || null } })
  } catch (error) {
    console.error("[voice-realtime-session] failed", error)
    return json({ success: false, message: error instanceof Error ? error.message : "Realtime session failed" }, 500)
  }
})
