// @ts-nocheck
/// <reference lib="deno.window" />
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

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
          slotDate: slot.date || "",
          slotStartTime: slot.start_time || "",
          slotEndTime: slot.end_time || "",
          slotLabel,
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
    return json({ success: true, result: payload.data })
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : "Voice tool failed" }, 400)
  }
})
