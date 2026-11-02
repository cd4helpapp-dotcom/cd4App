// @ts-nocheck
// Doctor search for the voice assistant. It reads the database directly: routing "doctors in Patna" through the
// chat model let its medical-scope guard return no doctors at all, and the assistant then blamed "the system".

const CITY_TOKEN_PATTERN = /[^\p{L}\p{N}]+/gu
const cityTokens = (value: unknown): string[] =>
  String(value || "").toLowerCase().replace(CITY_TOKEN_PATTERN, " ").trim().split(" ").filter(Boolean)

// Whole words only: "Patna, Bihar" is Patna, "Visakhapatnam" is not.
export const isSameCity = (doctorCity: unknown, wanted: unknown): boolean => {
  const a = cityTokens(doctorCity)
  const b = cityTokens(wanted)
  if (!a.length || !b.length) return false
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.every((token) => longer.includes(token))
}

const SPECIALTY_RULES: Array<{ pattern: RegExp; terms: string[]; label: string }> = [
  { pattern: /ayurved|bams|kayachikitsa/, terms: ["ayurved", "bams", "kayachikitsa"], label: "Ayurveda" },
  { pattern: /general physician|general medicine|primary care|fever|bukhar|temperature|typhoid|malaria|dengue|infection|viral|\bcold\b|body ache|body pain/, terms: ["general physician", "general medicine", "internal medicine", "physician"], label: "General Physician" },
  { pattern: /diabet|sugar|thyroid|hormone|insulin|endocrin/, terms: ["endocrin", "diabet"], label: "Endocrinology" },
  { pattern: /heart|cardio|cardiac|chest|\bbp\b|blood pressure|palpitation/, terms: ["cardio"], label: "Cardiology" },
  { pattern: /cough|breath|lung|asthma|copd|saans|pulmon|respirat/, terms: ["pulmon", "respirat"], label: "Pulmonology" },
  { pattern: /skin|rash|acne|allerg|eczema|itch|dermat|\bhair\b/, terms: ["dermat", "skin"], label: "Dermatology" },
  { pattern: /\bbones?\b|joint|back pain|back ache|\bknee|fracture|arthritis|ortho|rheumat/, terms: ["ortho", "rheumat"], label: "Orthopedics" },
  { pattern: /pregnan|period|women|gyn(a)?ec|menstrual|pcos|obstetric/, terms: ["gynec", "gynaec", "obstetric"], label: "Gynecology" },
  { pattern: /stomach|\bpet\b|gastric|gastro|liver|digestion|diarr|constipation|vomit|acidity/, terms: ["gastro", "hepat"], label: "Gastroenterology" },
  { pattern: /brain|headache|migraine|seizure|nerve|numbness|stroke|neurolog/, terms: ["neurolog"], label: "Neurology" },
  { pattern: /kidney|nephro|renal/, terms: ["nephro"], label: "Nephrology" },
  { pattern: /urine|urinary|bladder|prostate|urolog/, terms: ["urolog"], label: "Urology" },
  { pattern: /\b(ent|ears?|nose|throat)\b|sinus|hearing|otolaryng/, terms: ["otolaryng", "=ent"], label: "ENT" },
  { pattern: /\beyes?\b|vision|sight|ophthal/, terms: ["ophthal"], label: "Ophthalmology" },
  { pattern: /child|baby|infant|p(a)?ediatr/, terms: ["pediatr", "paediatr"], label: "Pediatrics" },
  { pattern: /mental|anxiety|depress|panic|sleep|stress|psychiatr|psycholog/, terms: ["psychiatr", "psycholog"], label: "Psychiatry" },
]

export const resolveSpecialty = (concern: unknown): { terms: string[]; label: string } | null => {
  const text = String(concern || "").toLowerCase()
  const rule = SPECIALTY_RULES.find((item) => item.pattern.test(text))
  return rule ? { terms: rule.terms, label: rule.label } : null
}

// "=ent" means the whole speciality is ENT; a plain substring would also match "gastroENTerology".
const matchesSpecialty = (specialization: unknown, terms: string[]): boolean => {
  const value = String(specialization || "").toLowerCase().trim()
  return terms.some((term) => (term.startsWith("=") ? value === term.slice(1) : value.includes(term)))
}

const isPresentable = (doctor: any): boolean => {
  const name = `${doctor.first_name || ""} ${doctor.last_name || ""}`.replace(/^\s*dr\.?\s*/i, "").trim()
  return Boolean(String(doctor.specialization || "").trim()) && /\p{L}{2,}/u.test(name) && !/(\p{L})\1{3,}/u.test(name)
}

const titleCase = (value: unknown): string =>
  String(value || "").trim().replace(/\s+/g, " ").replace(/(^|\s)(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase())

const parseYears = (value: unknown): number => {
  const match = String(value ?? "").match(/\d+/)
  return match ? Number(match[0]) : 0
}

const istDateKey = (ms: number): string => new Date(ms + 330 * 60 * 1000).toISOString().slice(0, 10)

// "today, 7:00 PM" / "tomorrow, 9:30 AM" / "5 Nov, 6:00 PM". Slot dates and times are stored in clinic time (IST).
export const formatSlotWhen = (date: string, startTime: string, nowMs = Date.now()): string => {
  const [h, m] = String(startTime || "00:00").split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, "0")} ${period}`
  if (date === istDateKey(nowMs)) return `today, ${time}`
  if (date === istDateKey(nowMs + 24 * 60 * 60 * 1000)) return `tomorrow, ${time}`
  const parsed = new Date(`${date}T00:00:00Z`)
  const day = parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })
  return `${day}, ${time}`
}

const MAX_DOCTORS = 6
const MAX_SLOTS_PER_DOCTOR = 2

const INSTRUCTIONS =
  "Tell the patient the result in their own language, like a helpful clinic receptionist. Name each doctor with speciality, fee and next open slot, and ask which doctor or slot they would like. " +
  "If a doctor has no open slot, say so plainly and offer another doctor. If searchNote is present, say it plainly first. " +
  "Use only these doctors and slots. Never mention the system, a search, a database, a tool or filters."

export const searchVerifiedDoctors = async (admin: any, args: { concern?: unknown; city?: unknown; nowMs?: number }) => {
  const city = String(args.city || "").trim()
  const nowMs = args.nowMs ?? Date.now()
  const specialty = resolveSpecialty(args.concern)
  const cityLabel = titleCase(city)

  const { data, error } = await admin
    .from("doctors_public")
    .select("id,city,specialization,experience,fee,rating,first_name,last_name,profile_picture")
    .limit(500)
  if (error) throw new Error(error.message || "doctor_search_failed")
  const all = (data || []).filter(isPresentable)

  const inCity = city ? all.filter((doctor: any) => isSameCity(doctor.city, city)) : all
  const withSpecialty = (list: any[]) => (specialty ? list.filter((doctor) => matchesSpecialty(doctor.specialization, specialty.terms)) : list)

  // Closest match first; the note makes any widening explicit, so the patient is never told something untrue.
  let pool = withSpecialty(inCity)
  let scope: "exact" | "specialty_elsewhere" | "city_elsewhere" = "exact"
  let searchNote: string | null = null
  if (pool.length === 0 && city && specialty && withSpecialty(all).length > 0) {
    pool = withSpecialty(all)
    scope = "specialty_elsewhere"
    searchNote = `CD4 has no ${specialty.label} doctor in ${cityLabel} right now. These ${specialty.label} doctors are in other cities and consult online.`
  } else if (pool.length === 0 && city && inCity.length > 0) {
    pool = inCity
    searchNote = `CD4 has no ${specialty?.label || "matching"} doctor anywhere right now. These are the doctors available in ${cityLabel}.`
  } else if (pool.length === 0) {
    pool = all
    scope = "city_elsewhere"
    searchNote = city ? `CD4 has no doctors in ${cityLabel} yet. These doctors are in other cities and consult online.` : null
  }

  const poolIds = pool.map((doctor: any) => doctor.id).filter(Boolean)
  let slots: any[] = []
  if (poolIds.length) {
    const { data: slotRows } = await admin
      .from("slots")
      .select("id,doctor_id,date,start_time,end_time")
      .in("doctor_id", poolIds)
      .eq("is_booked", false)
      .gte("date", istDateKey(nowMs))
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(200)
    // Stored as IST. Hide slots that have passed or start within 10 minutes.
    const bookableFromMs = nowMs + 10 * 60 * 1000
    slots = (slotRows || []).filter((slot: any) => new Date(`${slot.date}T${String(slot.start_time || "00:00:00").slice(0, 8)}+05:30`).getTime() >= bookableFromMs)
  }

  const slotsByDoctor = new Map<string, any[]>()
  for (const slot of slots) {
    const key = String(slot.doctor_id)
    slotsByDoctor.set(key, [...(slotsByDoctor.get(key) || []), slot])
  }

  // Doctors the patient can actually book come first, then rating, then experience.
  const ranked = [...pool].sort((a: any, b: any) => {
    const open = Number(slotsByDoctor.has(String(b.id))) - Number(slotsByDoctor.has(String(a.id)))
    if (open) return open
    const rating = Number(b.rating || 0) - Number(a.rating || 0)
    return rating || parseYears(b.experience) - parseYears(a.experience)
  }).slice(0, MAX_DOCTORS)

  const doctorRecommendations = ranked.map((doctor: any) => {
    const next = slotsByDoctor.get(String(doctor.id))?.[0]
    return {
      id: doctor.id,
      firstName: doctor.first_name || "",
      lastName: doctor.last_name || "",
      city: titleCase(doctor.city),
      specialization: String(doctor.specialization || "").trim(),
      experience: doctor.experience || "",
      fee: doctor.fee || "",
      rating: Number(doctor.rating || 0),
      image: doctor.profile_picture || "",
      nextSlot: next ? formatSlotWhen(next.date, next.start_time, nowMs) : "no open slot right now",
    }
  })

  const bookingSlotOptions = doctorRecommendations.flatMap((doctor: any) =>
    (slotsByDoctor.get(String(doctor.id)) || []).slice(0, MAX_SLOTS_PER_DOCTOR).map((slot: any) => {
      const doctorName = `${doctor.firstName} ${doctor.lastName}`.trim().replace(/^dr\.?\s*/i, "") || "Doctor"
      return {
        id: slot.id,
        doctorId: slot.doctor_id,
        doctorName,
        doctorSpecialization: doctor.specialization,
        doctorCity: doctor.city,
        date: slot.date,
        startTime: slot.start_time,
        endTime: slot.end_time,
        label: `Dr. ${doctorName} • ${formatSlotWhen(slot.date, slot.start_time, nowMs)}`,
      }
    })
  )

  return {
    reply: doctorRecommendations.length
      ? `Found ${doctorRecommendations.length} doctor${doctorRecommendations.length === 1 ? "" : "s"}${scope === "exact" && city ? ` in ${cityLabel}` : ""}.`
      : "No doctor is available on CD4 right now.",
    instructionsForAssistant: INSTRUCTIONS,
    searchNote,
    searchScope: scope,
    searchCity: cityLabel || null,
    doctorRecommendations,
    bookingSlotOptions,
    bookingPreparation: { slotOptions: bookingSlotOptions, doctorId: doctorRecommendations[0]?.id || null, searchCity: cityLabel || null },
    bookingPrompt: bookingSlotOptions.length ? "Choose a specific doctor and slot before booking." : null,
  }
}
