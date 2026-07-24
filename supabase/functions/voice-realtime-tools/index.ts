// @ts-nocheck
/// <reference lib="deno.window" />
import { createClient } from "npm:@supabase/supabase-js@2"

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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceKey
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
  if (!url || !serviceKey || !token) return json({ success: false, message: "Unauthorized" }, 401)
  try {
    const admin = createClient(url, serviceKey)
    const { data: userData, error } = await admin.auth.getUser(token)
    if (error || !userData.user) return json({ success: false, message: "Unauthorized" }, 401)
    const body = await request.json().catch(() => ({}))
    const name = String(body?.name || "")
    const args = typeof body?.arguments === "string" ? JSON.parse(body.arguments) : (body?.arguments || {})
    if (!["search_verified_doctors", "book_appointment"].includes(name)) return json({ success: false, message: "Unknown voice tool" }, 400)
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
      let doctorResult = await findDoctors(city)
      let doctors = doctorResult.data || []
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
          .limit(12)
        const doctorById = new Map(doctorRecommendations.map((doctor: any) => [String(doctor.id), doctor]))
        bookingSlotOptions = (slots || []).map((slot: any) => {
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

    const response = await fetch(`${url}/functions/v1/chat-ai`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Please find verified doctors for ${args.concern || "this health concern"}.`, concern: args.concern || "General health", showDoctors: true, searchAreaCity: args.city || null, locationCity: args.city || null, replyInVoice: true }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success !== true) return json({ success: false, message: payload?.message || "Voice tool failed" }, 400)
    const result = payload.data || {}
    const genericDoctors = Array.isArray(result.doctorRecommendations) ? result.doctorRecommendations : []
    // Keep the voice tool response flat and compatible with the appointment
    // UI. chat-ai stores slots under bookingPreparation.slotOptions, while
    // the voice client also accepts bookingSlotOptions directly.
    return json({
      success: true,
      result: {
        ...result,
        reply: genericDoctors.length
          ? "I found verified doctors. Please choose a doctor first, and then I will show that doctor's available slots."
          : result.reply || "I could not find a verified doctor right now.",
        // Generic search shows doctors first. Slots are fetched only after
        // the patient names/selects a specific doctor.
        bookingSlotOptions: [],
        bookingPreparation: result.bookingPreparation ? { ...result.bookingPreparation, slotOptions: [] } : result.bookingPreparation,
      },
    })
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : "Voice tool failed" }, 400)
  }
})
