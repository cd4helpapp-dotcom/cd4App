// @ts-nocheck
/// <reference lib="deno.window" />
import { createClient } from "npm:@supabase/supabase-js@2"
import { searchVerifiedDoctors } from "../_shared/doctorSearch.ts"

import { detectPromptInjection, wrapUntrusted } from "../_shared/agent/guards.ts"
import { embedText, formatKnowledge, retrieveKnowledge, retrieveReportChunks } from "../_shared/agent/knowledge.ts"
import { can, loadOwnAppointments, resolveActor, type AgentCapability } from "../_shared/agent/access.ts"
import { trackInBackground } from "../_shared/agent/telemetry.ts"

// What a voice tool needs from the caller's role. The model can ask for anything; this decides.
const TOOL_CAPABILITY: Record<string, AgentCapability> = {
  search_verified_doctors: "doctors.search",
  book_appointment: "booking.start",
  lookup_cd4_information: "knowledge.search",
  get_my_appointments: "records.own_appointments",
  search_my_reports: "records.own_reports",
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

const inferDepartmentSuggestion = (value: unknown) => {
  const text = String(value || "").toLowerCase()
  if (/fever|bukhar|temperature|body ache|body pain|viral|infection/.test(text)) return { id: "General Physician", label: "General Physician" }
  if (/chest|heart|cardiac|palpitation/.test(text)) return { id: "Cardiologist", label: "Cardiologist" }
  if (/cough|breath|lung|asthma|copd|saans/.test(text)) return { id: "Pulmonologist", label: "Pulmonologist" }
  if (/skin|rash|acne|eczema|itch/.test(text)) return { id: "Dermatologist", label: "Dermatologist" }
  if (/diabet|sugar|thyroid|hormone|insulin/.test(text)) return { id: "Endocrinologist", label: "Endocrinologist" }
  if (/stomach|gastric|liver|digestion|diarr|constipation|vomit/.test(text)) return { id: "Gastroenterologist", label: "Gastroenterologist" }
  if (/child|baby|infant|pediatric/.test(text)) return { id: "Pediatrician", label: "Pediatrician" }
  return null
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return json({ success: false, message: "POST required" }, 405)
  const url = Deno.env.get("SUPABASE_URL") || ""
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
  if (!url || !serviceKey || !token) return json({ success: false, message: "Unauthorized" }, 401)
  try {
    const admin = createClient(url, serviceKey)
    const { data: userData, error } = await admin.auth.getUser(token)
    if (error || !userData.user) return json({ success: false, message: "Unauthorized" }, 401)
    const body = await request.json().catch(() => ({}))
    const name = String(body?.name || "")
    const args = typeof body?.arguments === "string" ? JSON.parse(body.arguments) : (body?.arguments || {})
    if (!TOOL_CAPABILITY[name]) return json({ success: false, message: "Unknown voice tool" }, 400)
    const actor = await resolveActor(admin, userData.user.id)
    if (!can(actor, TOOL_CAPABILITY[name])) {
      trackInBackground(admin, { surface: "voice_tool", userId: actor.id, role: actor.role, route: "denied", routeReason: name, guardFlags: ["rbac_denied"] })
      return json({ success: true, result: { status: "not_allowed", message: "This is not available for this account." } })
    }

    if (name === "lookup_cd4_information" || name === "search_my_reports") {
      const query = String(args.query || "").slice(0, 500)
      if (detectPromptInjection(query).flagged) return json({ success: true, result: { status: "not_found", message: "No information found." } })
      const embedded = await embedText(Deno.env.get("OPENAI_API_KEY") || "", query)
      if (!embedded) return json({ success: true, result: { status: "not_found", message: "No information found." } })
      const rows = name === "lookup_cd4_information"
        ? await retrieveKnowledge(admin, { query, embedding: embedded.embedding, audience: actor.role === "doctor" ? "doctor" : "patient" })
        : await retrieveReportChunks(admin, { patientId: actor.id, query, embedding: embedded.embedding })
      trackInBackground(admin, { surface: "voice_tool", userId: actor.id, role: actor.role, route: "retrieval", routeReason: name, embeddingTokens: embedded.tokens, retrievedChunks: rows.length, topScore: rows[0]?.score ?? null })
      if (!rows.length) return json({ success: true, result: { status: "not_found", message: "This information is not available. Say so plainly and do not guess." } })
      const facts = name === "lookup_cd4_information"
        ? formatKnowledge(rows)
        : wrapUntrusted("patient reports", rows.map((row: any) => row.content).join("\n---\n"), 5000)
      return json({ success: true, result: { status: "found", facts } })
    }

    if (name === "get_my_appointments") {
      const facts = await loadOwnAppointments(admin, actor)
      trackInBackground(admin, { surface: "voice_tool", userId: actor.id, role: actor.role, route: "records", routeReason: name })
      return json({ success: true, result: { status: "found", facts: wrapUntrusted("patient appointments", facts) } })
    }

    if (name === "book_appointment") {
      if (args.confirmed !== true) {
        return json({
          success: true,
          result: {
            status: "needs_confirmation",
            message: "Please ask the patient to clearly confirm the exact doctor and slot before opening payment.",
          },
        })
      }

      const doctorId = String(args.doctorId || "").trim()
      const slotId = String(args.slotId || "").trim()
      if (!doctorId || !slotId) return json({ success: false, message: "Doctor and slot are required" }, 400)

      const [{ data: doctor, error: doctorError }, { data: slot, error: slotError }] = await Promise.all([
        admin.from("doctors_public")
          .select("id,first_name,last_name,specialization,city,fee")
          .eq("id", doctorId)
          .maybeSingle(),
        admin.from("slots")
          .select("id,doctor_id,date,start_time,end_time,is_booked")
          .eq("id", slotId)
          .eq("doctor_id", doctorId)
          .maybeSingle(),
      ])
      if (doctorError || !doctor) return json({ success: false, message: "Selected doctor was not found" }, 400)
      if (slotError || !slot || slot.is_booked) return json({ success: false, message: "That slot is no longer available" }, 400)

      const { data: recentBooking } = await admin
        .from("appointments")
        .select("created_at")
        .eq("patient_id", userData.user.id)
        .eq("doctor_id", doctorId)
        .in("status", ["pending", "confirmed", "completed"])
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (recentBooking?.created_at) {
        const nextDate = new Date(new Date(recentBooking.created_at).getTime() + 30 * 24 * 60 * 60 * 1000)
          .toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
        return json({
          success: true,
          result: {
            status: "booking_cooldown",
            message: `The patient already booked this doctor in the last 30 days and can book again on ${nextDate}. Tell them this kindly and offer another doctor.`,
          },
        })
      }
      const doctorName = `${doctor.first_name || ""} ${doctor.last_name || ""}`.trim() || "your doctor"
      const slotLabel = `${slot.date || "Selected date"} • ${slot.start_time || ""}${slot.end_time ? ` - ${slot.end_time}` : ""}`
      return json({
        success: true,
        result: {
          status: "payment_required",
          message: `The ${doctorName} slot is ready. Please complete payment to confirm the appointment.`,
          doctorId,
          slotId,
          doctorName,
          doctorSpecialization: doctor.specialization || "",
          doctorCity: doctor.city || "",
          doctorFee: doctor.fee || "500",
          concern: args.concern || "General health",
          departmentSuggestion: inferDepartmentSuggestion(args.concern || ""),
          slotDate: slot.date || "",
          slotStartTime: slot.start_time || "",
          slotEndTime: slot.end_time || "",
          slotLabel,
        },
      })
    }

    // A named doctor request is not a medical concern. Search the platform
    // directly instead of sending "Dr Nitesh" through chat-ai's medical
    // scope guard, which would otherwise return a generic health reply.
    const requestedDoctorName = String(args.doctorName || args.doctor || "").trim()
      || (/^(dr\.?|doctor)\b/i.test(String(args.concern || "")) ? String(args.concern).trim() : "")
    if (requestedDoctorName) {
      const doctorSearchText = requestedDoctorName
        .replace(/^dr\.?\s*/i, "")
        .replace(/^doctor\s*/i, "")
        .replace(/[%,()]/g, " ")
        .trim()
      const searchTerm = doctorSearchText.split(/\s+/)[0] || doctorSearchText
      const city = String(args.city || "").trim()
      const fields = "id,city,specialization,experience,fee,rating,first_name,last_name,profile_picture"
      const findDoctors = async (cityFilter: string) => {
        let query = admin.from("doctors_public").select(fields).limit(6)
        if (cityFilter) query = query.ilike("city", `%${cityFilter}%`)
        if (searchTerm) query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`)
        return query
      }
      // ilike %patna% also matches "Visakhapatnam"; keep only whole-word city matches.
      const sameCity = (doctorCity: unknown) => {
        const tokens = (value: unknown) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean)
        const a = tokens(doctorCity)
        const b = tokens(city)
        const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
        return shorter.length > 0 && shorter.every((token) => longer.includes(token))
      }
      let doctorResult = await findDoctors(city)
      let doctors = (doctorResult.data || []).filter((doctor: any) => !city || sameCity(doctor.city))
      if (doctors.length === 0 && city) {
        doctorResult = await findDoctors("")
        doctors = doctorResult.data || []
      }
      const requestedTokens = doctorSearchText.toLowerCase().split(/\s+/).filter(Boolean)
      const exactMatches = doctors.filter((doctor: any) => {
        const fullName = `${doctor.first_name || ""} ${doctor.last_name || ""}`.toLowerCase().trim()
        return requestedTokens.length > 0 && requestedTokens.every((token) => fullName.includes(token))
      })
      // A named-doctor request must never fan out into unrelated doctors or
      // their slots. Prefer an exact full-name match, otherwise show only the
      // best first-name match and let the patient clarify if needed.
      doctors = exactMatches.length > 0 ? exactMatches.slice(0, 1) : doctors.slice(0, 1)
      const doctorRecommendations = doctors.map((doctor: any) => ({
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
      const doctorIds = doctorRecommendations.map((doctor: any) => doctor.id).filter(Boolean)
      let bookingSlotOptions: any[] = []
      if (doctorIds.length > 0) {
        const today = new Date().toISOString().slice(0, 10)
        const { data: slots } = await admin.from("slots")
          .select("id,doctor_id,date,start_time,end_time")
          .in("doctor_id", doctorIds)
          .eq("is_booked", false)
          .gte("date", today)
          .order("date", { ascending: true })
          .order("start_time", { ascending: true })
          .limit(40)
        const doctorById = new Map(doctorRecommendations.map((doctor: any) => [String(doctor.id), doctor]))
        // The query filters by date only; drop slots earlier today (clinic time is IST) and anything starting in <10 min.
        const bookableFromMs = Date.now() + 10 * 60 * 1000
        const upcomingSlots = (slots || [])
          .filter((slot: any) => new Date(`${slot.date}T${String(slot.start_time || "00:00:00").slice(0, 8)}+05:30`).getTime() >= bookableFromMs)
          .slice(0, 12)
        bookingSlotOptions = upcomingSlots.map((slot: any) => {
          const doctor = doctorById.get(String(slot.doctor_id)) || {}
          const doctorLabel = `${doctor.firstName || ""} ${doctor.lastName || ""}`.trim() || "Doctor"
          const timeLabel = `${slot.date || ""}${slot.start_time ? ` • ${String(slot.start_time).slice(0, 5)}` : ""}${slot.end_time ? `–${String(slot.end_time).slice(0, 5)}` : ""}`
          return {
            id: slot.id,
            doctorId: slot.doctor_id,
            doctorName: doctorLabel,
            doctorSpecialization: doctor.specialization || "",
            doctorCity: doctor.city || "",
            date: slot.date,
            startTime: slot.start_time,
            endTime: slot.end_time,
            label: `${doctorLabel} • ${timeLabel}`,
          }
        })
      }
      const doctorLabel = doctorRecommendations[0]
        ? `${doctorRecommendations[0].firstName} ${doctorRecommendations[0].lastName}`.trim()
        : requestedDoctorName
      return json({
        success: true,
        result: {
          reply: bookingSlotOptions.length
            ? `I found ${doctorLabel}'s available slots. Please choose one.`
            : `I could not find an open slot for ${doctorLabel} right now.`,
          doctorRecommendations,
          bookingSlotOptions,
           bookingPreparation: { slotOptions: bookingSlotOptions, doctorId: doctorRecommendations[0]?.id || null, searchCity: city || null },
          bookingPrompt: bookingSlotOptions.length ? "Choose a specific doctor and slot before booking." : null,
          departmentSuggestion: inferDepartmentSuggestion(args.concern || ""),
        },
      })
    }

    // A general request ("doctors in Patna", "skin doctor") goes straight to the database, with open slots attached.
    const search = await searchVerifiedDoctors(admin, { concern: args.concern, city: args.city })
    return json({ success: true, result: { ...search, departmentSuggestion: inferDepartmentSuggestion(args.concern || "") } })
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : "Voice tool failed" }, 400)
  }
})
