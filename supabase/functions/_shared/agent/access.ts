// @ts-nocheck
// What the agent may read for whom. The role comes from the database, never from the client or from user_metadata,
// and every lookup is scoped to the signed-in user's id. Nothing here takes a patient id from the request.

export type AgentRole = "patient" | "doctor" | "hospital" | "admin" | "marketing"

export type AgentActor = { id: string; role: AgentRole }

export type AgentCapability =
  | "knowledge.search"
  | "doctors.search"
  | "booking.start"
  | "records.own_appointments"
  | "records.own_reports"

const POLICY: Record<AgentRole, AgentCapability[]> = {
  patient: ["knowledge.search", "doctors.search", "booking.start", "records.own_appointments", "records.own_reports"],
  doctor: ["knowledge.search", "doctors.search"],
  hospital: ["knowledge.search"],
  admin: ["knowledge.search", "doctors.search"],
  marketing: ["knowledge.search"],
}

export const resolveActor = async (admin: any, userId: string): Promise<AgentActor> => {
  const { data } = await admin.from("profiles").select("roles(slug)").eq("id", userId).maybeSingle()
  const slug = Array.isArray(data?.roles) ? data.roles[0]?.slug : data?.roles?.slug
  const role = String(slug || "patient").trim().toLowerCase()
  return { id: userId, role: (role in POLICY ? role : "patient") as AgentRole }
}

export const can = (actor: AgentActor, capability: AgentCapability): boolean => POLICY[actor.role].includes(capability)

const asksAboutAppointments = /\b(my|meri|mera|mere|next|upcoming|agla|agli)\b.{0,25}\b(appointments?|booking|consultation|slot)\b|\b(appointments?|booking)\b.{0,25}\b(kab|when|time|status)\b|(मेरी|मेरा|अगली|अगला).{0,20}(अपॉइंटमेंट|बुकिंग)|अपॉइंटमेंट.{0,15}कब/i
const asksAboutReports = /\b(my|meri|mera|mere)\b.{0,25}\b(reports?|test|blood test|results?|prescription|parcha|parchi|lab|hba1c|cbc|thyroid|sugar)\b|\b(report|test)\b.{0,20}\b(me|mein|main)\b.{0,20}\b(kya|what)\b|(मेरी|मेरा|मेरे).{0,20}(रिपोर्ट|जाँच|जांच|पर्चा|टेस्ट)/i

export const wantsOwnAppointments = (message: string) => asksAboutAppointments.test(message)
export const wantsOwnReports = (message: string) => asksAboutReports.test(message)

export const loadOwnAppointments = async (admin: any, actor: AgentActor): Promise<string | null> => {
  if (!can(actor, "records.own_appointments")) return null
  const { data } = await admin
    .from("appointments")
    .select("status, appointment_type, slot:slots!slot_id(date, start_time), doctor:doctors_public!doctor_id(first_name, last_name, specialization)")
    .eq("patient_id", actor.id)
    .in("status", ["pending", "confirmed"])
    .order("created_at", { ascending: false })
    .limit(8)
  const today = new Date().toISOString().slice(0, 10)
  const rows = (data || []).filter((row: any) => String(row.slot?.date || "") >= today)
  if (rows.length === 0) return "The patient has no upcoming appointments."
  return rows
    .map((row: any) => {
      const doctor = [row.doctor?.first_name, row.doctor?.last_name].filter(Boolean).join(" ") || "their doctor"
      return `${row.slot?.date} at ${String(row.slot?.start_time || "").slice(0, 5)} with Dr. ${doctor}${row.doctor?.specialization ? ` (${String(row.doctor.specialization).trim()})` : ""}, status ${row.status}`
    })
    .join("\n")
}
