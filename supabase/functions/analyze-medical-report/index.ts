// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const parseEnvInt = (key: string, fallback: number): number => {
  const raw = Number((Deno.env.get(key) || "").trim())
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

const parseEnvBool = (key: string, fallback: boolean): boolean => {
  const raw = (Deno.env.get(key) || "").trim().toLowerCase()
  if (!raw) return fallback
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  return fallback
}

// GPT-5.6 Sol is the current flagship model for report-quality analysis.
// Terra remains the fast fallback if the flagship route is temporarily unavailable.
const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol"
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-5.6-terra"
const DEFAULT_OPENAI_VISION_MODEL = "gpt-5.6-sol"
const DEFAULT_OPENAI_VISION_FALLBACK_MODEL = "gpt-5.6-terra"
const FORCE_OPENAI_ONLY = true
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
const DEFAULT_GEMINI_OCR_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"]
const AI_MESSAGE_LIMIT_PER_WINDOW = Math.max(10, Math.min(1000, parseEnvInt("CHAT_AI_MESSAGE_LIMIT_PER_WINDOW", 40)))
const AI_BURST_LIMIT_MESSAGES = Math.max(2, Math.min(50, parseEnvInt("CHAT_AI_BURST_LIMIT_MESSAGES", 6)))
const AI_BURST_WINDOW_MS = Math.max(10 * 1000, parseEnvInt("CHAT_AI_BURST_WINDOW_MS", 60 * 1000))
const AI_FIRST_BLOCK_MS = Math.max(5 * 60 * 1000, parseEnvInt("CHAT_AI_FIRST_BLOCK_MS", 2 * 60 * 60 * 1000))
const AI_SECOND_BLOCK_MS = Math.max(10 * 60 * 1000, parseEnvInt("CHAT_AI_SECOND_BLOCK_MS", 4 * 60 * 60 * 1000))
const AI_RATE_LIMIT_TZ_OFFSET_MINUTES = 330
const MAX_PDF_OPERATOR_SCAN_BYTES = 8 * 1024 * 1024

const clipText = (value: string, maxLength: number): string => {
  const text = (value || "").trim()
  if (!text) return ""
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

const encodeBase64 = (bytes: Uint8Array): string => {
  if (!bytes || bytes.length === 0) return ""
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

const MAX_ANALYZE_FILE_BYTES = Math.max(2 * 1024 * 1024, parseEnvInt("ANALYZE_REPORT_MAX_BYTES", 8 * 1024 * 1024))
const MAX_PDF_INLINE_BYTES = Math.max(
  2 * 1024 * 1024,
  Math.min(MAX_ANALYZE_FILE_BYTES, parseEnvInt("ANALYZE_MAX_PDF_INLINE_BYTES", MAX_ANALYZE_FILE_BYTES))
)
const MAX_EXTRACTED_TEXT_CHARS = Math.max(
  8000,
  Math.min(70000, parseEnvInt("ANALYZE_MAX_EXTRACTED_TEXT_CHARS", 30000))
)
const MAX_GENERIC_TEXT_SCAN_BYTES = Math.max(
  300 * 1024,
  Math.min(4 * 1024 * 1024, parseEnvInt("ANALYZE_MAX_TEXT_SCAN_BYTES", 2 * 1024 * 1024))
)
// Core PDF behavior is code-locked (not env-driven) for predictable production behavior.
const ENABLE_PDF_OPERATOR_EXTRACTION = true
const ENABLE_PDF_TEXT_EXTRACTION = true
const ALLOW_PDF_INLINE_BINARY = true
const PDF_OPERATOR_EXTRACTION_CPU_BUDGET_MS = 160
const PDF_OPERATOR_EXTRACTION_MAX_CHUNKS = 64
const MAX_PDF_INLINE_FALLBACK_BYTES = Math.min(MAX_PDF_INLINE_BYTES, 12 * 1024 * 1024)
const MAX_OPENAI_FILE_INPUT_BYTES = Math.min(MAX_ANALYZE_FILE_BYTES, 50 * 1024 * 1024)
const GEMINI_MAX_OUTPUT_TOKENS = Math.max(
  800,
  Math.min(4000, parseEnvInt("ANALYZE_GEMINI_MAX_OUTPUT_TOKENS", 2500))
)
const GEMINI_REQUEST_TIMEOUT_MS = Math.max(
  15000,
  Math.min(45000, parseEnvInt("ANALYZE_GEMINI_TIMEOUT_MS", 30000))
)
const GEMINI_MAX_ATTEMPTS = 2
const GEMINI_OCR_MAX_ATTEMPTS = Math.max(1, Math.min(2, parseEnvInt("ANALYZE_GEMINI_OCR_MAX_ATTEMPTS", 1)))
const GEMINI_OCR_MAX_MODELS = Math.max(1, Math.min(3, parseEnvInt("ANALYZE_GEMINI_OCR_MAX_MODELS", 1)))
const DEEP_PDF_RESCUE_MAX_ATTEMPTS = Math.max(1, Math.min(2, parseEnvInt("ANALYZE_DEEP_PDF_RESCUE_MAX_ATTEMPTS", 1)))
const DEEP_PDF_RESCUE_TIMEOUT_MS = Math.max(22000, Math.min(70000, parseEnvInt("ANALYZE_DEEP_PDF_RESCUE_TIMEOUT_MS", 52000)))
const DEEP_PDF_RESCUE_MAX_OUTPUT_TOKENS = Math.max(
  1600,
  Math.min(5000, parseEnvInt("ANALYZE_DEEP_PDF_RESCUE_MAX_OUTPUT_TOKENS", 3600))
)
const ENABLE_ANALYSIS_QUALITY_RETRY = parseEnvBool("ANALYZE_ENABLE_QUALITY_RETRY", false)
const ENABLE_AI_OCR_FALLBACK = parseEnvBool("ANALYZE_ENABLE_AI_OCR_FALLBACK", true)
const AI_OCR_MIN_TEXT_CHARS = Math.max(120, Math.min(2000, parseEnvInt("ANALYZE_AI_OCR_MIN_TEXT_CHARS", 260)))
const AI_OCR_MAX_TEXT_CHARS = Math.max(3000, Math.min(120000, parseEnvInt("ANALYZE_AI_OCR_MAX_TEXT_CHARS", 50000)))
const DEFAULT_RAG_EMBEDDING_MODEL = "text-embedding-3-small"
const RAG_CHUNK_TARGET_CHARS = Math.max(500, Math.min(2400, parseEnvInt("RAG_CHUNK_TARGET_CHARS", 1600)))
const RAG_CHUNK_OVERLAP_CHARS = Math.max(80, Math.min(600, parseEnvInt("RAG_CHUNK_OVERLAP_CHARS", 220)))
const RAG_MAX_CHUNKS_PER_REPORT = Math.max(3, Math.min(80, parseEnvInt("RAG_MAX_CHUNKS_PER_REPORT", 28)))
const RAG_MIN_SOURCE_TEXT_CHARS = Math.max(60, Math.min(800, parseEnvInt("RAG_MIN_SOURCE_TEXT_CHARS", 120)))

const maskId = (value: string | null | undefined): string => {
  const id = (value || "").trim()
  if (!id) return "na"
  if (id.length <= 10) return id
  return `${id.slice(0, 6)}...${id.slice(-4)}`
}

const traceLog = (
  level: "log" | "warn" | "error",
  traceId: string,
  step: string,
  details?: Record<string, unknown>
) => {
  const payload = details ? ` | ${JSON.stringify(details)}` : ""
  const line = `[analyze-medical-report][trace:${traceId}] ${step}${payload}`
  if (level === "warn") {
    console.warn(line)
    return
  }
  if (level === "error") {
    console.error(line)
    return
  }
  console.log(line)
}

const toArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 18)
}

const normalizeObjectString = (value: unknown, maxLength: number): string => {
  if (value === null || value === undefined) return ""
  return clipText(String(value).trim(), maxLength)
}

const normalizeReportIdentity = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const obj: any = value
  const mapped: Record<string, string> = {}

  const setIfPresent = (key: string, ...candidates: unknown[]) => {
    for (const candidate of candidates) {
      const normalized = normalizeObjectString(candidate, 120)
      if (normalized) {
        mapped[key] = normalized
        return
      }
    }
  }

  setIfPresent("patient_name", obj.patient_name, obj.patientName, obj.name)
  setIfPresent("age", obj.age, obj.patient_age, obj.patientAge)
  setIfPresent("gender", obj.gender, obj.sex, obj.patient_gender, obj.patientGender)
  setIfPresent("lab_name", obj.lab_name, obj.labName, obj.laboratory, obj.source_lab)
  setIfPresent("report_date", obj.report_date, obj.reportDate, obj.date, obj.generated_on)
  setIfPresent("sample_collected_at", obj.sample_collected_at, obj.sampleCollectedAt, obj.collection_date)
  setIfPresent("report_id", obj.report_id, obj.reportId, obj.lab_number, obj.labNumber)
  setIfPresent("referred_by", obj.referred_by, obj.referredBy, obj.referring_doctor, obj.refBy)

  return mapped
}

const normalizeDetailedStringList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) return []
  const dedupe = new Set<string>()
  const items: string[] = []
  for (const entry of value) {
    const normalized = normalizeObjectString(entry, maxLength)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.add(key)
    items.push(normalized)
    if (items.length >= maxItems) break
  }
  return items
}

const normalizeParameterHighlights = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const dedupe = new Set<string>()
  const items: string[] = []

  for (const entry of value) {
    let line = ""
    if (typeof entry === "string") {
      line = normalizeObjectString(entry, 220)
    } else if (entry && typeof entry === "object") {
      const row: any = entry
      const testName = normalizeObjectString(
        row.test_name || row.parameter || row.test || row.name,
        80
      )
      const observedValue = normalizeObjectString(
        row.observed_value || row.value || row.result || row.reading,
        40
      )
      const unit = normalizeObjectString(row.unit, 24)
      const refRange = normalizeObjectString(
        row.reference_range || row.ref_range || row.normal_range || row.range,
        56
      )
      const status = normalizeObjectString(row.status || row.flag || row.level, 34)
      const interpretation = normalizeObjectString(
        row.interpretation || row.meaning || row.note,
        90
      )

      const valueWithUnit = [observedValue, unit].filter(Boolean).join(" ").trim()
      const base = [testName, valueWithUnit].filter(Boolean).join(": ")
      const suffixParts: string[] = []
      if (refRange) suffixParts.push(`Ref ${refRange}`)
      if (status) suffixParts.push(status)
      if (interpretation) suffixParts.push(interpretation)

      const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(" | ")})` : ""
      line = clipText(`${base}${suffix}`.trim(), 220)
    }

    if (!line || line.length < 4) continue
    const key = line.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.add(key)
    items.push(line)
    if (items.length >= 16) break
  }

  return items
}

type NormalizedPrescriptionMedication = {
  name: string
  dosage: string
  frequency: string
  timing: string
  duration: string
  purpose: string
  instructions: string
}

type NormalizedPrescriptionDetails = {
  doctor_name: string
  diagnosis: string
  prescribed_on: string
  followup_date: string
  patient_name: string
  relation_tag: string
  age: string
  sex: string
  occupation: string
  insurance_no: string
  health_provider: string
  health_card_no: string
  patient_id_no: string
  address: string
  cell_no: string
  blood_pressure: string
  pulse_rate: string
  weight: string
  allergies: string
  disabilities: string
  diet_to_follow: string
  brief_history: string
  followup_physician: string
  general_instructions: string[]
  red_flags: string[]
  medications: NormalizedPrescriptionMedication[]
}

const normalizeFlexibleStringList = (
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] => {
  if (Array.isArray(value)) {
    return normalizeDetailedStringList(value, maxItems, maxLength)
  }

  const text = normalizeObjectString(value, maxLength * maxItems)
  if (!text) return []

  return text
    .split(/\n|;|\u2022|,/g)
    .map((item) => clipText(item.trim(), maxLength))
    .filter((item) => item.length >= 3)
    .slice(0, maxItems)
}

const normalizePrescriptionMedicationObject = (
  value: unknown
): NormalizedPrescriptionMedication | null => {
  if (!value || typeof value !== "object") return null
  const row: any = value

  const normalized = {
    name: normalizeObjectString(row.name || row.medicine || row.drug || row.medication || row.tablet, 90),
    dosage: normalizeObjectString(row.dosage || row.dose || row.strength, 60),
    frequency: normalizeObjectString(row.frequency || row.schedule || row.how_often || row.times_per_day, 60),
    timing: normalizeObjectString(row.timing || row.when || row.time, 80),
    duration: normalizeObjectString(row.duration || row.days || row.period || row.course, 60),
    purpose: normalizeObjectString(row.purpose || row.for || row.indication || row.reason, 120),
    instructions: normalizeObjectString(row.instructions || row.notes || row.note || row.remark, 140),
  }

  if (!normalized.name) return null
  return normalized
}

const normalizePrescriptionMedicationObjects = (
  value: unknown,
  maxItems: number = 18
): NormalizedPrescriptionMedication[] => {
  if (!Array.isArray(value)) return []
  const dedupe = new Set<string>()
  const items: NormalizedPrescriptionMedication[] = []

  for (const entry of value) {
    if (items.length >= maxItems) break

    if (typeof entry === "string") {
      const name = normalizeObjectString(entry, 120)
      if (!name) continue
      const key = name.toLowerCase()
      if (dedupe.has(key)) continue
      dedupe.add(key)
      items.push({
        name,
        dosage: "",
        frequency: "",
        timing: "",
        duration: "",
        purpose: "",
        instructions: "",
      })
      continue
    }

    const normalized = normalizePrescriptionMedicationObject(entry)
    if (!normalized) continue
    const dedupeKey = [
      normalized.name.toLowerCase(),
      normalized.dosage.toLowerCase(),
      normalized.frequency.toLowerCase(),
      normalized.timing.toLowerCase(),
      normalized.duration.toLowerCase(),
    ]
      .filter(Boolean)
      .join("|")

    const key = dedupeKey || normalized.name.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.add(key)
    items.push(normalized)
  }

  return items
}

const stringifyPrescriptionMedication = (item: NormalizedPrescriptionMedication): string => {
  const parts = [item.name, item.dosage, item.frequency, item.timing, item.duration].filter(Boolean)
  return clipText(parts.join(" | "), 180)
}

const normalizePrescriptionDetails = (
  value: unknown,
  fallbackMedicationLines: string[] = []
): NormalizedPrescriptionDetails => {
  const obj: any =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {}

  const medicationsFromObject = normalizePrescriptionMedicationObjects(
    obj.medications || obj.medicines || obj.items || obj.drugs || obj.prescription_items
  )
  const fallbackMedicationObjects = normalizePrescriptionMedicationObjects(fallbackMedicationLines)

  const medications =
    medicationsFromObject.length > 0 ? medicationsFromObject : fallbackMedicationObjects

  return {
    doctor_name: normalizeObjectString(
      obj.doctor_name || obj.doctorName || obj.prescribed_by || obj.prescriber || obj.referring_doctor,
      100
    ),
    diagnosis: normalizeObjectString(obj.diagnosis || obj.condition || obj.reason, 220),
    prescribed_on: normalizeObjectString(obj.prescribed_on || obj.prescribedOn || obj.date || obj.rx_date, 60),
    followup_date: normalizeObjectString(obj.followup_date || obj.followupDate || obj.review_date || obj.next_visit, 60),
    patient_name: normalizeObjectString(obj.patient_name || obj.patientName || obj.name, 100),
    relation_tag: normalizeObjectString(
      obj.relation_tag || obj.relationTag || obj.guardian_name || obj.guardianName || obj.so_do_wo,
      100
    ),
    age: normalizeObjectString(obj.age || obj.patient_age || obj.patientAge, 40),
    sex: normalizeObjectString(obj.sex || obj.gender || obj.patient_gender || obj.patientGender, 30),
    occupation: normalizeObjectString(obj.occupation || obj.job, 80),
    insurance_no: normalizeObjectString(obj.insurance_no || obj.insuranceNo || obj.health_insurance_no, 80),
    health_provider: normalizeObjectString(obj.health_provider || obj.healthcare_provider || obj.provider, 100),
    health_card_no: normalizeObjectString(obj.health_card_no || obj.healthCardNo, 80),
    patient_id_no: normalizeObjectString(obj.patient_id_no || obj.patientIdNo || obj.patient_id, 80),
    address: normalizeObjectString(obj.address || obj.patient_address || obj.patientAddress, 200),
    cell_no: normalizeObjectString(obj.cell_no || obj.mobile || obj.phone || obj.contact_no, 60),
    blood_pressure: normalizeObjectString(obj.blood_pressure || obj.bp || obj.bloodPressure, 40),
    pulse_rate: normalizeObjectString(obj.pulse_rate || obj.pulse || obj.heart_rate || obj.pulseRate, 40),
    weight: normalizeObjectString(obj.weight || obj.wt || obj.body_weight, 40),
    allergies: normalizeObjectString(obj.allergies || obj.allergy, 180),
    disabilities: normalizeObjectString(obj.disabilities || obj.disability, 180),
    diet_to_follow: normalizeObjectString(obj.diet_to_follow || obj.dietToFollow || obj.diet, 180),
    brief_history: normalizeObjectString(obj.brief_history || obj.briefHistory || obj.history, 260),
    followup_physician: normalizeObjectString(
      obj.followup_physician || obj.followupPhysician || obj.follow_up_physician || obj.review_with,
      100
    ),
    general_instructions: normalizeFlexibleStringList(
      obj.general_instructions || obj.instructions || obj.doctor_notes || obj.advice,
      10,
      180
    ),
    red_flags: normalizeFlexibleStringList(
      obj.red_flags || obj.warning_signs || obj.urgent_signs,
      8,
      180
    ),
    medications,
  }
}

const extractJsonText = (raw: string): string => {
  const trimmed = (raw || "").trim()
  if (!trimmed) return "{}"
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
  }
  const first = trimmed.indexOf("{")
  const last = trimmed.lastIndexOf("}")
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1)
  }
  return "{}"
}

const parseLooseJsonObject = (rawText: string): Record<string, any> | null => {
  const trimmed = (rawText || "").trim()
  if (!trimmed) return null

  const stripCodeFences = (value: string): string =>
    (value || "")
      .replace(/```json/gi, "```")
      .replace(/```/g, "")
      .trim()

  const cleaned = stripCodeFences(trimmed)

  const decodeJsonStringSafe = (value: string): string => {
    const input = (value || "").trim()
    if (!input) return ""
    try {
      return JSON.parse(`"${input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    } catch {
      return input.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    }
  }

  const extractQuotedField = (raw: string, field: string): string => {
    const regex = new RegExp(
      `["']?${field}["']?\\s*:\\s*(?:"([\\s\\S]*?)"|'([\\s\\S]*?)')(?=\\s*,\\s*["']?[a-zA-Z0-9_]+["']?\\s*:|\\s*\\}|\\s*$)`,
      "i"
    )
    const match = raw.match(regex)
    const captured = match?.[1] || match?.[2] || ""
    if (captured) return decodeJsonStringSafe(captured).trim()

    const plainRegex = new RegExp(`["']?${field}["']?\\s*:\\s*([^,\\n\\r\\}]+)`, "i")
    const plainMatch = raw.match(plainRegex)
    const plainValue = (plainMatch?.[1] || "").trim().replace(/^["']|["']$/g, "")
    return plainValue
  }

  const extractStringArrayField = (raw: string, field: string, maxItems: number = 18): string[] => {
    const regex = new RegExp(`["']?${field}["']?\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i")
    const match = raw.match(regex)
    if (!match?.[1]) return []
    const block = match[1]
    const items: string[] = []
    const itemRegex = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'/g
    let itemMatch: RegExpExecArray | null = itemRegex.exec(block)
    while (itemMatch && items.length < maxItems) {
      const decoded = decodeJsonStringSafe(itemMatch[1] || itemMatch[2] || "").trim()
      if (decoded) items.push(decoded)
      itemMatch = itemRegex.exec(block)
    }
    return items
  }

  const tryParse = (candidate: string): any | null => {
    try {
      return JSON.parse(candidate)
    } catch {
      return null
    }
  }

  const normalize = (parsed: any, depth: number = 0): Record<string, any> | null => {
    if (depth > 3 || !parsed) return null
    if (typeof parsed === "string") {
      const nested = parsed.trim()
      if (!nested) return null

      const nestedParsed = tryParse(nested)
      if (nestedParsed) return normalize(nestedParsed, depth + 1)

      const nestedJsonSlice = extractJsonText(nested)
      if (nestedJsonSlice !== "{}") {
        const fromSlice = tryParse(nestedJsonSlice)
        if (fromSlice) return normalize(fromSlice, depth + 1)
      }

      return null
    }

    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }

    return null
  }

  const directParsed = normalize(tryParse(cleaned))
  if (directParsed) return directParsed

  const jsonSlice = extractJsonText(cleaned)
  if (jsonSlice !== "{}") {
    const sliceParsed = normalize(tryParse(jsonSlice))
    if (sliceParsed) return sliceParsed
  }

  const summary =
    extractQuotedField(cleaned, "summary") ||
    extractQuotedField(cleaned, "patient_friendly_explanation")
  const patientExplanation =
    extractQuotedField(cleaned, "patient_friendly_explanation") ||
    summary
  const keyPoints =
    extractStringArrayField(cleaned, "key_points") ||
    extractStringArrayField(cleaned, "keyPoints")
  const cautionFlags =
    extractStringArrayField(cleaned, "caution_flags") ||
    extractStringArrayField(cleaned, "cautionFlags")
  const followups =
    extractStringArrayField(cleaned, "suggested_followups") ||
    extractStringArrayField(cleaned, "suggestedFollowups")
  const medications =
    extractStringArrayField(cleaned, "medications") ||
    extractStringArrayField(cleaned, "prescriptions") ||
    extractStringArrayField(cleaned, "prescription_items")
  const avoidList =
    extractStringArrayField(cleaned, "what_to_avoid") ||
    extractStringArrayField(cleaned, "avoid") ||
    extractStringArrayField(cleaned, "avoid_list")
  const next24hActions =
    extractStringArrayField(cleaned, "next_24h_actions") ||
    extractStringArrayField(cleaned, "action_plan_24h") ||
    extractStringArrayField(cleaned, "next_actions")
  const recoveryTimeline =
    extractQuotedField(cleaned, "recovery_timeline") ||
    extractQuotedField(cleaned, "timeline")
  const reportType = extractQuotedField(cleaned, "report_type") || extractQuotedField(cleaned, "reportType")
  const parameterHighlights =
    extractStringArrayField(cleaned, "parameter_highlights", 16) ||
    extractStringArrayField(cleaned, "parameterHighlights", 16)
  const abnormalFindings =
    extractStringArrayField(cleaned, "abnormal_findings", 14) ||
    extractStringArrayField(cleaned, "abnormalFindings", 14)
  const normalFindings =
    extractStringArrayField(cleaned, "normal_findings", 10) ||
    extractStringArrayField(cleaned, "normalFindings", 10)
  const missingSections =
    extractStringArrayField(cleaned, "missing_sections", 10) ||
    extractStringArrayField(cleaned, "missingSections", 10)
  const confidenceNote =
    extractQuotedField(cleaned, "confidence_note") ||
    extractQuotedField(cleaned, "confidenceNote")
  const reportIdentity = {
    patient_name:
      extractQuotedField(cleaned, "patient_name") ||
      extractQuotedField(cleaned, "patientName"),
    age: extractQuotedField(cleaned, "age") || extractQuotedField(cleaned, "patient_age"),
    gender: extractQuotedField(cleaned, "gender") || extractQuotedField(cleaned, "sex"),
    lab_name:
      extractQuotedField(cleaned, "lab_name") ||
      extractQuotedField(cleaned, "labName") ||
      extractQuotedField(cleaned, "laboratory"),
    report_date:
      extractQuotedField(cleaned, "report_date") ||
      extractQuotedField(cleaned, "reportDate") ||
      extractQuotedField(cleaned, "date"),
    sample_collected_at:
      extractQuotedField(cleaned, "sample_collected_at") ||
      extractQuotedField(cleaned, "sampleCollectedAt") ||
      extractQuotedField(cleaned, "collection_date"),
    report_id:
      extractQuotedField(cleaned, "report_id") ||
      extractQuotedField(cleaned, "reportId") ||
      extractQuotedField(cleaned, "lab_number"),
    referred_by:
      extractQuotedField(cleaned, "referred_by") ||
      extractQuotedField(cleaned, "referredBy") ||
      extractQuotedField(cleaned, "referring_doctor"),
  }
  const prescriptionDetails = {
    doctor_name:
      extractQuotedField(cleaned, "doctor_name") ||
      extractQuotedField(cleaned, "doctorName") ||
      extractQuotedField(cleaned, "prescribed_by") ||
      extractQuotedField(cleaned, "prescriber"),
    diagnosis:
      extractQuotedField(cleaned, "diagnosis") ||
      extractQuotedField(cleaned, "condition"),
    prescribed_on:
      extractQuotedField(cleaned, "prescribed_on") ||
      extractQuotedField(cleaned, "prescribedOn") ||
      extractQuotedField(cleaned, "rx_date"),
    followup_date:
      extractQuotedField(cleaned, "followup_date") ||
      extractQuotedField(cleaned, "followupDate") ||
      extractQuotedField(cleaned, "review_date"),
    patient_name:
      extractQuotedField(cleaned, "patient_name") ||
      extractQuotedField(cleaned, "patientName"),
    relation_tag:
      extractQuotedField(cleaned, "relation_tag") ||
      extractQuotedField(cleaned, "relationTag") ||
      extractQuotedField(cleaned, "guardian_name"),
    age:
      extractQuotedField(cleaned, "age") ||
      extractQuotedField(cleaned, "patient_age"),
    sex:
      extractQuotedField(cleaned, "sex") ||
      extractQuotedField(cleaned, "gender"),
    occupation:
      extractQuotedField(cleaned, "occupation"),
    insurance_no:
      extractQuotedField(cleaned, "insurance_no") ||
      extractQuotedField(cleaned, "insuranceNo") ||
      extractQuotedField(cleaned, "health_insurance_no"),
    health_provider:
      extractQuotedField(cleaned, "health_provider") ||
      extractQuotedField(cleaned, "healthcare_provider"),
    health_card_no:
      extractQuotedField(cleaned, "health_card_no") ||
      extractQuotedField(cleaned, "healthCardNo"),
    patient_id_no:
      extractQuotedField(cleaned, "patient_id_no") ||
      extractQuotedField(cleaned, "patientIdNo"),
    address:
      extractQuotedField(cleaned, "address") ||
      extractQuotedField(cleaned, "patient_address"),
    cell_no:
      extractQuotedField(cleaned, "cell_no") ||
      extractQuotedField(cleaned, "mobile") ||
      extractQuotedField(cleaned, "phone"),
    blood_pressure:
      extractQuotedField(cleaned, "blood_pressure") ||
      extractQuotedField(cleaned, "bp"),
    pulse_rate:
      extractQuotedField(cleaned, "pulse_rate") ||
      extractQuotedField(cleaned, "pulse") ||
      extractQuotedField(cleaned, "heart_rate"),
    weight:
      extractQuotedField(cleaned, "weight") ||
      extractQuotedField(cleaned, "wt"),
    allergies:
      extractQuotedField(cleaned, "allergies") ||
      extractQuotedField(cleaned, "allergy"),
    disabilities:
      extractQuotedField(cleaned, "disabilities") ||
      extractQuotedField(cleaned, "disability"),
    diet_to_follow:
      extractQuotedField(cleaned, "diet_to_follow") ||
      extractQuotedField(cleaned, "dietToFollow") ||
      extractQuotedField(cleaned, "diet"),
    brief_history:
      extractQuotedField(cleaned, "brief_history") ||
      extractQuotedField(cleaned, "briefHistory") ||
      extractQuotedField(cleaned, "history"),
    followup_physician:
      extractQuotedField(cleaned, "followup_physician") ||
      extractQuotedField(cleaned, "followupPhysician") ||
      extractQuotedField(cleaned, "follow_up_physician"),
    general_instructions:
      extractStringArrayField(cleaned, "general_instructions", 10) ||
      extractStringArrayField(cleaned, "instructions", 10) ||
      extractStringArrayField(cleaned, "doctor_notes", 10),
    red_flags:
      extractStringArrayField(cleaned, "red_flags", 8) ||
      extractStringArrayField(cleaned, "warning_signs", 8) ||
      extractStringArrayField(cleaned, "urgent_signs", 8),
    medications,
  }
  const hasPrescriptionDetails =
    Boolean(prescriptionDetails.doctor_name) ||
    Boolean(prescriptionDetails.diagnosis) ||
    Boolean(prescriptionDetails.prescribed_on) ||
    Boolean(prescriptionDetails.followup_date) ||
    Boolean(prescriptionDetails.patient_name) ||
    Boolean(prescriptionDetails.age) ||
    Boolean(prescriptionDetails.sex) ||
    Boolean(prescriptionDetails.blood_pressure) ||
    Boolean(prescriptionDetails.pulse_rate) ||
    Boolean(prescriptionDetails.weight) ||
    Boolean(prescriptionDetails.allergies) ||
    Boolean(prescriptionDetails.diet_to_follow) ||
    Boolean(prescriptionDetails.brief_history) ||
    prescriptionDetails.general_instructions.length > 0 ||
    prescriptionDetails.red_flags.length > 0 ||
    prescriptionDetails.medications.length > 0

  if (
    summary ||
    patientExplanation ||
    keyPoints.length > 0 ||
    cautionFlags.length > 0 ||
    followups.length > 0 ||
    medications.length > 0 ||
    avoidList.length > 0 ||
    next24hActions.length > 0 ||
    recoveryTimeline ||
    parameterHighlights.length > 0 ||
    abnormalFindings.length > 0 ||
    normalFindings.length > 0 ||
    missingSections.length > 0 ||
    confidenceNote ||
    Object.values(reportIdentity).some(Boolean) ||
    hasPrescriptionDetails
  ) {
    return {
      summary,
      patient_friendly_explanation: patientExplanation,
      key_points: keyPoints,
      caution_flags: cautionFlags,
      suggested_followups: followups,
      medications,
      what_to_avoid: avoidList,
      next_24h_actions: next24hActions,
      recovery_timeline: recoveryTimeline,
      report_type: reportType,
      report_identity: reportIdentity,
      parameter_highlights: parameterHighlights,
      abnormal_findings: abnormalFindings,
      normal_findings: normalFindings,
      missing_sections: missingSections,
      confidence_note: confidenceNote,
      prescription_details: prescriptionDetails,
    }
  }

  return null
}

const parseAnalysis = (rawText: string) => {
  const emptyPrescriptionDetails: NormalizedPrescriptionDetails = {
    doctor_name: "",
    diagnosis: "",
    prescribed_on: "",
    followup_date: "",
    patient_name: "",
    relation_tag: "",
    age: "",
    sex: "",
    occupation: "",
    insurance_no: "",
    health_provider: "",
    health_card_no: "",
    patient_id_no: "",
    address: "",
    cell_no: "",
    blood_pressure: "",
    pulse_rate: "",
    weight: "",
    allergies: "",
    disabilities: "",
    diet_to_follow: "",
    brief_history: "",
    followup_physician: "",
    general_instructions: [],
    red_flags: [],
    medications: [],
  }

  const fallback = {
    summary: clipText(rawText || "AI analysis is available in raw response.", 2200),
    key_points: [],
    report_type: "medical_report",
    caution_flags: [],
    suggested_followups: [],
    medications: [],
    what_to_avoid: [],
    next_24h_actions: [],
    recovery_timeline: "",
    report_identity: {},
    parameter_highlights: [],
    abnormal_findings: [],
    normal_findings: [],
    missing_sections: [],
    confidence_note: "",
    patient_friendly_explanation: clipText(rawText || "Could not format explanation.", 4500),
    prescription_details: emptyPrescriptionDetails,
  }

  const parsed = parseLooseJsonObject(rawText)
  if (!parsed) {
    return fallback
  }

  const medicationObjects = normalizePrescriptionMedicationObjects(
    parsed.medications ??
      parsed.medicines ??
      parsed.prescriptions ??
      parsed.prescription_items ??
      parsed.drugs
  )
  const medicationLines = medicationObjects
    .map((item) => stringifyPrescriptionMedication(item))
    .filter(Boolean)

  const prescriptionSource =
    parsed.prescription_details ??
    parsed.prescriptionDetails ??
    {
      doctor_name: parsed.doctor_name ?? parsed.doctorName ?? parsed.prescribed_by ?? parsed.prescriber,
      diagnosis: parsed.diagnosis ?? parsed.condition,
      prescribed_on: parsed.prescribed_on ?? parsed.prescribedOn ?? parsed.rx_date,
      followup_date: parsed.followup_date ?? parsed.followupDate ?? parsed.review_date,
      general_instructions:
        parsed.general_instructions ?? parsed.instructions ?? parsed.doctor_notes ?? parsed.advice,
      red_flags: parsed.red_flags ?? parsed.warning_signs ?? parsed.urgent_signs,
      medications:
        parsed.medications ??
        parsed.medicines ??
        parsed.prescriptions ??
        parsed.prescription_items ??
        parsed.drugs,
    }

  const prescriptionDetails = normalizePrescriptionDetails(prescriptionSource, medicationLines)
  const prescriptionMedicationLines = prescriptionDetails.medications
    .map((item) => stringifyPrescriptionMedication(item))
    .filter(Boolean)
  const mergedMedicationLines = Array.from(
    new Set([...medicationLines, ...prescriptionMedicationLines])
  ).slice(0, 12)
  const explicitReportType = clipText(String(parsed.report_type || parsed.reportType || ""), 80)
  const inferredPrescription =
    mergedMedicationLines.length > 0 ||
    Boolean(prescriptionDetails.doctor_name) ||
    Boolean(prescriptionDetails.diagnosis)
  const normalizedReportType = explicitReportType || (inferredPrescription ? "prescription" : "medical_report")

  return {
    summary:
      clipText(String(parsed.summary || parsed.patient_friendly_explanation || ""), 2200) ||
      fallback.summary,
    key_points: toArray(parsed.key_points ?? parsed.keyPoints),
    report_type: normalizedReportType,
    caution_flags: toArray(parsed.caution_flags ?? parsed.cautionFlags),
    suggested_followups: toArray(parsed.suggested_followups ?? parsed.suggestedFollowups),
    medications: mergedMedicationLines,
    what_to_avoid: toArray(parsed.what_to_avoid ?? parsed.avoid ?? parsed.avoid_list),
    next_24h_actions: toArray(parsed.next_24h_actions ?? parsed.action_plan_24h ?? parsed.next_actions),
    recovery_timeline: clipText(String(parsed.recovery_timeline || parsed.timeline || ""), 600),
    report_identity: normalizeReportIdentity(
      parsed.report_identity ?? parsed.reportIdentity ?? parsed.report_meta ?? parsed.reportMeta
    ),
    parameter_highlights: normalizeParameterHighlights(
      parsed.parameter_highlights ?? parsed.parameterHighlights ?? parsed.test_results ?? parsed.testResults
    ),
    abnormal_findings: normalizeDetailedStringList(
      parsed.abnormal_findings ?? parsed.abnormalFindings ?? parsed.alert_findings ?? [],
      12,
      180
    ),
    normal_findings: normalizeDetailedStringList(
      parsed.normal_findings ?? parsed.normalFindings ?? [],
      10,
      160
    ),
    missing_sections: normalizeDetailedStringList(
      parsed.missing_sections ?? parsed.missingSections ?? [],
      10,
      160
    ),
    confidence_note: clipText(String(parsed.confidence_note ?? parsed.confidenceNote ?? ""), 260),
    patient_friendly_explanation:
      clipText(String(parsed.patient_friendly_explanation || parsed.patientFriendlyExplanation || ""), 4500) ||
      fallback.patient_friendly_explanation,
    prescription_details: prescriptionDetails,
  }
}

const isAnalysisTooShallow = (
  analysis: {
    summary?: string
    key_points?: string[]
    parameter_highlights?: string[]
    patient_friendly_explanation?: string
  },
  extractedTextLength: number
): boolean => {
  const summary = String(analysis?.summary || "").trim()
  const explanation = String(analysis?.patient_friendly_explanation || "").trim()
  const keyPoints = toArray(analysis?.key_points)
  const parameterHighlights = toArray(analysis?.parameter_highlights)
  const detailPoints = [...keyPoints, ...parameterHighlights]
  const combined = [summary, explanation, ...detailPoints].join(" ")
  const numericMentions = (combined.match(/\d+(?:\.\d+)?/g) || []).length
  const normalizedCombined = combined.toLowerCase()
  const genericPatterns = [
    "comprehensive health report",
    "overall health report",
    "this report indicates",
    "consult your doctor",
    "maintain a healthy lifestyle",
  ]

  if (detailPoints.length >= 8 && summary.length >= 220) {
    return false
  }

  if (genericPatterns.some((pattern) => normalizedCombined.includes(pattern)) && detailPoints.length < 6) {
    return true
  }

  if (summary.length < 120 && explanation.length < 180) {
    return true
  }

  if (detailPoints.length <= 3) {
    return true
  }

  if (extractedTextLength >= 1200 && numericMentions < 4) {
    return true
  }

  return false
}

const countNumericMentions = (value: string): number =>
  ((value || "").match(/\b\d+(?:\.\d+)?\b/g) || []).length

const isHeaderOnlyLabAnalysis = (analysis: {
  summary?: string
  key_points?: string[]
  patient_friendly_explanation?: string
  report_type?: string
}, extractedText: string, rawText: string): boolean => {
  const summary = String(analysis?.summary || "").trim()
  const explanation = String(analysis?.patient_friendly_explanation || "").trim()
  const keyPoints = toArray(analysis?.key_points)
  const reportType = String(analysis?.report_type || "").toLowerCase()
  const combined = [summary, explanation, ...keyPoints, rawText || ""].join(" ").toLowerCase()
  const extracted = normalizeDecodedText(extractedText || "")

  const headerSignals = [
    "only the header",
    "header portion",
    "lab report header",
    "patient name visible",
    "lab number visible",
    "source visible",
  ]
  const missingResultSignals = [
    "no laboratory parameters",
    "no numeric values",
    "no units are visible",
    "no reference ranges",
    "not clearly visible",
    "incomplete report text",
    "result pages were not readable",
    "no pathology impression",
    "no test panel names",
  ]

  const headerHit = headerSignals.some((token) => combined.includes(token))
  const missingHit = missingResultSignals.some((token) => combined.includes(token))
  const combinedNumericMentions = countNumericMentions(combined)
  const extractedNumericMentions = countNumericMentions(extracted)
  const labLikeType = reportType.includes("lab")
  const extractedLooksWeak = extracted.length < 2600 || extractedNumericMentions < 10

  if (!labLikeType && !headerHit) return false
  if (!missingHit) return false
  if (combinedNumericMentions > 22 && extractedNumericMentions > 14) return false
  if (!extractedLooksWeak) return false
  return true
}

const buildInitialAssistantMessage = (analysis: {
  summary: string
  key_points: string[]
  caution_flags: string[]
  suggested_followups: string[]
  medications?: string[]
  prescription_details?: NormalizedPrescriptionDetails
  report_identity?: Record<string, string>
  parameter_highlights?: string[]
  abnormal_findings?: string[]
  normal_findings?: string[]
  confidence_note?: string
  patient_friendly_explanation: string
}): string => {
  const lines: string[] = []
  const intro = clipText(analysis.patient_friendly_explanation || analysis.summary || "", 4500)
  const keyPoints = toArray(analysis.key_points)
  const cautions = toArray(analysis.caution_flags).slice(0, 8)
  const followups = toArray(analysis.suggested_followups).slice(0, 8)
  const medications = toArray(analysis.medications || []).slice(0, 8)
  const prescriptionDetails = normalizePrescriptionDetails(analysis.prescription_details || {}, medications)
  const prescriptionMedicationLines = prescriptionDetails.medications
    .map((item) => stringifyPrescriptionMedication(item))
    .filter(Boolean)
    .slice(0, 8)
  const medicationsToShow =
    prescriptionMedicationLines.length > 0 ? prescriptionMedicationLines : medications
  const parameterHighlights = toArray(analysis.parameter_highlights || []).slice(0, 12)
  const abnormalFindings = toArray(analysis.abnormal_findings || []).slice(0, 8)
  const normalFindings = toArray(analysis.normal_findings || []).slice(0, 6)
  const confidenceNote = clipText(String(analysis.confidence_note || ""), 220)
  const identity = normalizeReportIdentity(analysis.report_identity || {})
  const keyPointEmojis = ["🔎", "✅", "📌", "💡", "🧠", "📊", "🩺", "✨"]

  const identityLines = [
    identity.patient_name ? `Patient: ${identity.patient_name}` : "",
    identity.age ? `Age: ${identity.age}` : "",
    identity.gender ? `Gender: ${identity.gender}` : "",
    identity.lab_name ? `Lab: ${identity.lab_name}` : "",
    identity.report_date ? `Report date: ${identity.report_date}` : "",
    identity.sample_collected_at ? `Sample collected: ${identity.sample_collected_at}` : "",
    identity.report_id ? `Report/Lab ID: ${identity.report_id}` : "",
    identity.referred_by ? `Referred by: ${identity.referred_by}` : "",
  ].filter(Boolean)

  if (identityLines.length > 0) {
    lines.push("### Report At A Glance")
    identityLines.forEach((item) => lines.push(`- 🧾 ${item}`))
  }

  if (intro) {
    lines.push("### Quick Summary")
    lines.push(`🙂 ${intro}`)
  }

  const hasPrescriptionSnapshot =
    Boolean(prescriptionDetails.doctor_name) ||
    Boolean(prescriptionDetails.diagnosis) ||
    Boolean(prescriptionDetails.prescribed_on) ||
    Boolean(prescriptionDetails.followup_date)
  if (hasPrescriptionSnapshot) {
    if (lines.length > 0) lines.push("")
    lines.push("### Prescription Snapshot")
    if (prescriptionDetails.doctor_name) {
      lines.push(`- 👨‍⚕️ Doctor: ${prescriptionDetails.doctor_name}`)
    }
    if (prescriptionDetails.diagnosis) {
      lines.push(`- 🧠 Condition: ${prescriptionDetails.diagnosis}`)
    }
    if (prescriptionDetails.prescribed_on) {
      lines.push(`- 📅 Prescribed on: ${prescriptionDetails.prescribed_on}`)
    }
    if (prescriptionDetails.followup_date) {
      lines.push(`- 🔁 Follow-up date: ${prescriptionDetails.followup_date}`)
    }
  }

  if (parameterHighlights.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Value-Wise Highlights")
    parameterHighlights.forEach((item) => {
      lines.push(`- 📈 ${item}`)
    })
  }

  if (keyPoints.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Key Findings")
    keyPoints.forEach((item, index) => {
      lines.push(`- ${keyPointEmojis[index % keyPointEmojis.length]} ${item}`)
    })
  }

  if (medicationsToShow.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Medicines Noted")
    medicationsToShow.forEach((item) => {
      lines.push(`- 💊 ${item}`)
    })
  }

  if (prescriptionDetails.general_instructions.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Prescription Instructions")
    prescriptionDetails.general_instructions.forEach((item) => {
      lines.push(`- 📝 ${item}`)
    })
  }

  if (prescriptionDetails.red_flags.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Urgent Help Signals")
    prescriptionDetails.red_flags.forEach((item) => {
      lines.push(`- 🚨 ${item}`)
    })
  }

  if (abnormalFindings.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Needs Attention")
    abnormalFindings.forEach((item) => {
      lines.push(`- 🚩 ${item}`)
    })
  }

  if (normalFindings.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Reassuring Findings")
    normalFindings.forEach((item) => {
      lines.push(`- ✅ ${item}`)
    })
  }

  if (cautions.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Watchouts")
    cautions.forEach((item) => {
      lines.push(`- ⚠️ ${item}`)
    })
  }

  if (followups.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("### Next Steps")
    followups.forEach((item) => {
      lines.push(`- 👉 ${item}`)
    })
  }

  if (confidenceNote) {
    if (lines.length > 0) lines.push("")
    lines.push("### Reading Confidence")
    lines.push(`- ℹ️ ${confidenceNote}`)
  }

  return clipText(lines.join("\n").trim() || intro || analysis.summary || "", 7000)
}

const isPushEnabledFromSettings = (settings: unknown): boolean => {
  if (!settings || typeof settings !== "object") return true
  const notifications = (settings as any).notifications
  if (!notifications || typeof notifications !== "object") return true
  const push = (notifications as any).push
  if (typeof push === "boolean") return push
  return true
}

const getExpoPushTicketErrors = (payload: any): any[] => {
  const tickets = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : []
  const ticketErrors = tickets.filter((ticket: any) => ticket?.status === "error")
  const requestErrors = Array.isArray(payload?.errors) ? payload.errors : []
  return [...ticketErrors, ...requestErrors]
}

const sendExpoPush = async (message: Record<string, unknown>) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
    })

    let payload: any = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    const ticketErrors = getExpoPushTicketErrors(payload)

    return {
      ok: response.ok && ticketErrors.length === 0,
      status: response.status,
      payload,
      ticketErrors,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

const REPORT_ALERT_NEGATION_PATTERN =
  /\b(no|not|without|none|non[-\s]?)(?:\s+\w+){0,3}\s+(urgent|emergency|critical|danger|severe|red flag)s?\b/i
const REPORT_ALERT_HARD_RISK_PATTERNS = [
  /\b(emergency|urgent|critical|life[-\s]?threat(?:ening)?|seek immediate medical attention|go to (?:the )?(?:er|emergency)|hospital(?:ization)? now)\b/i,
  /\b(call (?:an )?(?:ambulance|emergency services|108|112|911)|icu|intensive care)\b/i,
  /\b(stroke|heart attack|sepsis|internal bleeding|respiratory distress|organ failure|shock)\b/i,
  /\b(dangerously|critically|severely)\s+(high|low)\b/i,
  /\b(very high|very low)\s+(?:blood sugar|glucose|bp|blood pressure|potassium|sodium|hemoglobin|platelet|oxygen)\b/i,
]
const REPORT_ALERT_HIGH_SEVERITY_PATTERN =
  /\b(emergency|ambulance|911|112|108|icu|life[-\s]?threat|stroke|heart attack|sepsis|internal bleeding|respiratory distress|organ failure|shock)\b/i

const splitSentencesForRiskScan = (value: string, maxItems: number): string[] => {
  const normalized = (value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, " ")
    .trim()
  if (!normalized) return []
  const tokens = normalized
    .split(/[\n\r]+|[.!?]+\s+/g)
    .map((item) => clipText(item.replace(/\s+/g, " ").trim(), 260))
    .filter(Boolean)
  return tokens.slice(0, Math.max(1, maxItems))
}

const pickCriticalReportSignals = (analysis: {
  summary?: string
  patient_friendly_explanation?: string
  key_points?: string[]
  caution_flags?: string[]
  suggested_followups?: string[]
  next_24h_actions?: string[]
  abnormal_findings?: string[]
}): { severity: "high" | "moderate"; signals: string[] } => {
  const candidates = [
    ...toArray(analysis.caution_flags || []),
    ...toArray(analysis.suggested_followups || []),
    ...toArray(analysis.next_24h_actions || []),
    ...toArray(analysis.abnormal_findings || []),
    ...toArray(analysis.key_points || []),
    ...splitSentencesForRiskScan(analysis.summary || "", 6),
    ...splitSentencesForRiskScan(analysis.patient_friendly_explanation || "", 10),
  ]

  const deduped = new Set<string>()
  const matched: string[] = []
  let highSeverityHit = false

  for (const candidate of candidates) {
    const line = clipText((candidate || "").replace(/\s+/g, " ").trim(), 220)
    if (!line || line.length < 10) continue
    const key = line.toLowerCase()
    if (deduped.has(key)) continue
    deduped.add(key)

    if (REPORT_ALERT_NEGATION_PATTERN.test(line)) continue
    const risky = REPORT_ALERT_HARD_RISK_PATTERNS.some((pattern) => pattern.test(line))
    if (!risky) continue

    if (REPORT_ALERT_HIGH_SEVERITY_PATTERN.test(line)) {
      highSeverityHit = true
    }

    matched.push(line)
    if (matched.length >= 4) break
  }

  return {
    severity: highSeverityHit ? "high" : "moderate",
    signals: matched,
  }
}

const sendCriticalReportAlertIfNeeded = async (args: {
  serviceClient: any
  userId: string
  reportId: string
  fileName: string
  analysis: {
    summary?: string
    patient_friendly_explanation?: string
    key_points?: string[]
    caution_flags?: string[]
    suggested_followups?: string[]
    next_24h_actions?: string[]
    abnormal_findings?: string[]
  }
  traceId: string
}): Promise<{
  sent: boolean
  reason: string
  severity: "high" | "moderate" | null
  signalCount: number
}> => {
  const risk = pickCriticalReportSignals(args.analysis)
  if (!risk.signals.length) {
    return {
      sent: false,
      reason: "no_high_risk_signal_detected",
      severity: null,
      signalCount: 0,
    }
  }

  const title = risk.severity === "high" ? "Urgent Report Alert" : "Important Report Alert"
  const firstSignal = risk.signals[0] || "Potentially important report finding detected."
  const filePrefix = args.fileName ? `${clipText(args.fileName, 36)}: ` : ""
  const body =
    risk.signals.length > 1
      ? `${filePrefix}${firstSignal} (+${risk.signals.length - 1} more). Tap to review.`
      : `${filePrefix}${firstSignal}. Tap to review.`

  try {
    await args.serviceClient
      .from("in_app_notifications")
      .insert({
        user_id: args.userId,
        type: "medical_report_alert",
        title,
        body: clipText(body, 200),
        data: {
          type: "medical_report_alert",
          reportId: args.reportId,
          recipientId: args.userId,
          severity: risk.severity,
          signals: risk.signals.slice(0, 3),
        },
        is_read: false,
      })
  } catch (inAppError: any) {
    traceLog("warn", args.traceId, "report_alert_in_app_insert_failed", {
      error: clipText(inAppError?.message || "in_app_insert_failed", 180),
    })
  }

  const { data: profile, error: profileError } = await args.serviceClient
    .from("profiles")
    .select("push_token, settings")
    .eq("id", args.userId)
    .maybeSingle()

  if (profileError || !profile?.push_token) {
    return {
      sent: false,
      reason: "push_token_missing",
      severity: risk.severity,
      signalCount: risk.signals.length,
    }
  }

  if (!isPushEnabledFromSettings((profile as any)?.settings)) {
    return {
      sent: false,
      reason: "push_disabled",
      severity: risk.severity,
      signalCount: risk.signals.length,
    }
  }

  const message: Record<string, unknown> = {
    to: profile.push_token,
    sound: "default",
    title,
    body: clipText(body, 200),
    data: {
      type: "medical_report_alert",
      reportId: args.reportId,
      recipientId: args.userId,
      severity: risk.severity,
      signalCount: risk.signals.length,
      topSignals: risk.signals.slice(0, 3),
    },
    priority: "high",
    channelId: "default",
  }

  const expoResult = await sendExpoPush(message)
  if (!expoResult.ok) {
    traceLog("warn", args.traceId, "report_alert_push_rejected", {
      status: expoResult.status,
    })
    return {
      sent: false,
      reason: "expo_push_rejected",
      severity: risk.severity,
      signalCount: risk.signals.length,
    }
  }

  return {
    sent: true,
    reason: "push_sent",
    severity: risk.severity,
    signalCount: risk.signals.length,
  }
}

const isTextLikeMime = (mimeType: string): boolean => {
  const normalized = (mimeType || "").toLowerCase()
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("csv") ||
    normalized.includes("xml")
  )
}

const isDocumentLikeMime = (mimeType: string): boolean => {
  const normalized = (mimeType || "").toLowerCase()
  return (
    normalized.includes("pdf") ||
    normalized.includes("msword") ||
    normalized.includes("wordprocessingml") ||
    normalized.includes("opendocument") ||
    normalized.includes("vnd.oasis") ||
    normalized.includes("rtf") ||
    normalized.includes("plain")
  )
}

const isPdfMime = (mimeType: string): boolean => {
  const normalized = (mimeType || "").toLowerCase()
  return normalized.includes("pdf")
}

const inferMimeType = (storedMimeType: string, fileName: string): string => {
  const normalizedMime = (storedMimeType || "").trim().toLowerCase()
  if (normalizedMime && normalizedMime !== "application/octet-stream" && normalizedMime !== "binary/octet-stream") {
    return normalizedMime
  }

  const normalizedName = (fileName || "").trim().toLowerCase()
  if (normalizedName.endsWith(".pdf")) return "application/pdf"
  if (normalizedName.endsWith(".png")) return "image/png"
  if (normalizedName.endsWith(".jpg") || normalizedName.endsWith(".jpeg")) return "image/jpeg"
  if (normalizedName.endsWith(".webp")) return "image/webp"
  if (normalizedName.endsWith(".heic")) return "image/heic"
  if (normalizedName.endsWith(".heif")) return "image/heif"
  if (normalizedName.endsWith(".txt")) return "text/plain"
  if (normalizedName.endsWith(".csv")) return "text/csv"
  if (normalizedName.endsWith(".json")) return "application/json"
  if (normalizedName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (normalizedName.endsWith(".doc")) return "application/msword"
  if (normalizedName.endsWith(".rtf")) return "application/rtf"
  if (normalizedName.endsWith(".odt")) return "application/vnd.oasis.opendocument.text"

  return normalizedMime || "application/octet-stream"
}

const normalizeDecodedText = (value: string): string =>
  (value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const normalizeOcrText = (value: string): string =>
  (value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

const SHORT_MEDICAL_SIGNAL_TERMS = [
  "cbc",
  "hb",
  "wbc",
  "rbc",
  "plt",
  "platelet",
  "hemoglobin",
  "esr",
  "crp",
  "tsh",
  "t3",
  "t4",
  "sgpt",
  "sgot",
  "creatinine",
  "urea",
  "uric",
  "glucose",
  "hba1c",
  "ldl",
  "hdl",
  "triglyceride",
  "cholesterol",
  "mg/dl",
  "mmol/l",
  "x-ray",
  "mri",
  "ct",
  "ultrasound",
  "path",
  "lab",
  "report",
]

const hasShortMedicalSignal = (value: string): boolean => {
  const normalized = (value || "").toLowerCase()
  if (!normalized) return false
  return SHORT_MEDICAL_SIGNAL_TERMS.some((term) => normalized.includes(term))
}

const isReadableExtractedText = (value: string): boolean => {
  const text = normalizeDecodedText(value)
  if (text.length < 40) return false

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 6) return false

  // Lab slips can be compact but still valid (value/unit heavy).
  if (text.length < 120 && hasShortMedicalSignal(text)) {
    return true
  }

  const letterCount = (text.match(/\p{L}/gu) || []).length
  const replacementCount = (text.match(/�/g) || []).length
  const oddSymbolCount = (text.match(/[^\p{L}\p{N}\s.,:%()\/+\-]/gu) || []).length

  const letterRatio = letterCount / Math.max(text.length, 1)
  const replacementRatio = replacementCount / Math.max(text.length, 1)
  const oddSymbolRatio = oddSymbolCount / Math.max(text.length, 1)

  return letterRatio >= 0.14 && replacementRatio < 0.03 && oddSymbolRatio < 0.45
}

const isLowConfidenceMedicalExtraction = (value: string, mimeType: string): boolean => {
  const text = normalizeDecodedText(value)
  if (!text) return true

  const normalized = text.toLowerCase()
  const signalHits = SHORT_MEDICAL_SIGNAL_TERMS.reduce(
    (count, term) => (normalized.includes(term) ? count + 1 : count),
    0
  )
  const numericMentions = (normalized.match(/\b\d+(?:\.\d+)?\b/g) || []).length
  const unitMentions =
    (
      normalized.match(
        /\b(?:mg\/dl|mmol\/l|g\/dl|iu\/l|u\/l|cells\/cumm|bpm|mmhg|ng\/ml|pg\/ml|meq\/l|mm\/hr|x10\^3|x10\^6)\b/g
      ) || []
    ).length
  const pdfArtifactHits =
    (normalized.match(/\b(?:obj|endobj|stream|endstream|xref|trailer|catalog|fontdescriptor|contents)\b/g) || [])
      .length

  const looksLikePdfArtifactDump = pdfArtifactHits >= 4 && signalHits < 2 && unitMentions === 0
  if (looksLikePdfArtifactDump) return true

  const isPdf = (mimeType || "").toLowerCase().includes("pdf")
  if (!isPdf) {
    return signalHits < 2 && numericMentions < 3 && text.length < 220
  }

  if (text.length < 500 && signalHits < 2) return true
  if (text.length < 2200 && signalHits < 3 && numericMentions < 6 && unitMentions < 2) return true
  return false
}

const mergeExtractedTexts = (baseText: string, ocrText: string): string => {
  const base = normalizeOcrText(baseText || "")
  const ocr = normalizeOcrText(ocrText || "")
  if (!base) return clipText(ocr, MAX_EXTRACTED_TEXT_CHARS)
  if (!ocr) return clipText(base, MAX_EXTRACTED_TEXT_CHARS)
  if (base.includes(ocr)) return clipText(base, MAX_EXTRACTED_TEXT_CHARS)
  if (ocr.includes(base)) return clipText(ocr, MAX_EXTRACTED_TEXT_CHARS)

  const mergedLines = [...base.split(/\n+/), ...ocr.split(/\n+/)]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const seen = new Set<string>()
  const deduped: string[] = []
  for (const line of mergedLines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(line)
  }

  return clipText(deduped.join("\n"), MAX_EXTRACTED_TEXT_CHARS)
}

const decodePdfLiteralString = (value: string): string => {
  let out = ""
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]
    if (current !== "\\") {
      out += current
      continue
    }

    const next = value[index + 1]
    if (!next) break

    if (/[0-7]/.test(next)) {
      let octal = next
      let cursor = index + 2
      while (cursor < value.length && octal.length < 3 && /[0-7]/.test(value[cursor])) {
        octal += value[cursor]
        cursor += 1
      }
      out += String.fromCharCode(Number.parseInt(octal, 8))
      index = cursor - 1
      continue
    }

    const map: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "\\": "\\",
      "(": "(",
      ")": ")",
    }

    out += map[next] ?? next
    index += 1
  }
  return out
}

const extractPdfTextFromOperators = (bytes: Uint8Array): string => {
  if (!ENABLE_PDF_OPERATOR_EXTRACTION) {
    return ""
  }

  const scanSlice =
    bytes.byteLength > MAX_PDF_OPERATOR_SCAN_BYTES
      ? bytes.slice(0, MAX_PDF_OPERATOR_SCAN_BYTES)
      : bytes
  const decoded = new TextDecoder("latin1").decode(scanSlice)
  const chunks: string[] = []
  const startedAt = Date.now()

  const pushChunk = (raw: string) => {
    if (chunks.length >= PDF_OPERATOR_EXTRACTION_MAX_CHUNKS) return
    const normalized = normalizeDecodedText(decodePdfLiteralString(raw))
    if (normalized.length >= 2) {
      chunks.push(normalized)
    }
  }

  const maxChars = decoded.length
  let cursor = 0
  while (
    cursor < maxChars &&
    chunks.length < PDF_OPERATOR_EXTRACTION_MAX_CHUNKS &&
    Date.now() - startedAt < PDF_OPERATOR_EXTRACTION_CPU_BUDGET_MS
  ) {
    const start = decoded.indexOf("(", cursor)
    if (start < 0) break

    let depth = 1
    let end = start + 1
    let escaped = false
    while (end < maxChars) {
      const char = decoded[end]
      if (escaped) {
        escaped = false
        end += 1
        continue
      }
      if (char === "\\") {
        escaped = true
        end += 1
        continue
      }
      if (char === "(") {
        depth += 1
        end += 1
        continue
      }
      if (char === ")") {
        depth -= 1
        if (depth === 0) {
          break
        }
      }
      end += 1
    }

    if (end >= maxChars || depth !== 0) {
      break
    }

    let tokenCursor = end + 1
    while (tokenCursor < maxChars && /\s/.test(decoded[tokenCursor])) {
      tokenCursor += 1
    }
    const token2 = decoded.slice(tokenCursor, tokenCursor + 2)
    const token1 = decoded[tokenCursor] || ""
    if (token2 === "Tj" || token2 === "TJ" || token1 === "'" || token1 === "\"") {
      pushChunk(decoded.slice(start + 1, end))
    }
    cursor = end + 1
  }

  return normalizeDecodedText(chunks.join(" "))
}

const extractBestEffortDocumentText = (bytes: Uint8Array, mimeType: string): string => {
  const normalizedMime = (mimeType || "").toLowerCase()

  if (normalizedMime.includes("pdf")) {
    try {
      const fromPdfOperators = extractPdfTextFromOperators(bytes)
      if (isReadableExtractedText(fromPdfOperators)) {
        return clipText(fromPdfOperators, MAX_EXTRACTED_TEXT_CHARS)
      }
    } catch {
      // no-op
    }
  }

  const scanSlices: Uint8Array[] = []
  scanSlices.push(
    bytes.byteLength > MAX_GENERIC_TEXT_SCAN_BYTES
      ? bytes.slice(0, MAX_GENERIC_TEXT_SCAN_BYTES)
      : bytes
  )

  if (normalizedMime.includes("pdf") && bytes.byteLength > MAX_GENERIC_TEXT_SCAN_BYTES + 64 * 1024) {
    const halfWindow = Math.floor(MAX_GENERIC_TEXT_SCAN_BYTES / 2)
    const middleStart = Math.max(0, Math.floor(bytes.byteLength / 2) - Math.floor(halfWindow / 2))
    const middleEnd = Math.min(bytes.byteLength, middleStart + halfWindow)
    if (middleEnd - middleStart > 16 * 1024) {
      scanSlices.push(bytes.slice(middleStart, middleEnd))
    }

    const tailStart = Math.max(0, bytes.byteLength - MAX_GENERIC_TEXT_SCAN_BYTES)
    if (bytes.byteLength - tailStart > 16 * 1024) {
      scanSlices.push(bytes.slice(tailStart))
    }
  }

  for (const scanSlice of scanSlices) {
    try {
      const decodedUtf8 = new TextDecoder("utf-8", { fatal: false }).decode(scanSlice)
      const compactUtf8 = normalizeDecodedText(decodedUtf8)
      if (isReadableExtractedText(compactUtf8)) {
        return clipText(compactUtf8, MAX_EXTRACTED_TEXT_CHARS)
      }
    } catch {
      // no-op
    }

    try {
      const fallbackDecoded = new TextDecoder().decode(scanSlice)
      const compactFallback = normalizeDecodedText(fallbackDecoded)
      if (isReadableExtractedText(compactFallback)) {
        return clipText(compactFallback, MAX_EXTRACTED_TEXT_CHARS)
      }
    } catch {
      // no-op
    }
  }

  return ""
}

const createServiceClient = () => {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) {
    throw new Error("Supabase service role not configured.")
  }
  return createClient(url, key)
}

const getOpenAIModelName = (): string => {
  const fromEnv = (Deno.env.get("ANALYZE_OPENAI_MODEL") || Deno.env.get("OPENAI_MODEL") || "").trim()
  return fromEnv || DEFAULT_OPENAI_MODEL
}

const parseModelList = (value: string): string[] =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

const getRagEmbeddingModelName = (): string => {
  const fromEnv = (Deno.env.get("RAG_EMBEDDING_MODEL") || "").trim()
  return fromEnv || DEFAULT_RAG_EMBEDDING_MODEL
}

const normalizeRagText = (value: string): string =>
  (value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

const dedupeLines = (lines: string[]): string[] => {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const line of lines) {
    const normalized = normalizeRagText(line)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(normalized)
  }
  return unique
}

const buildRagSourceText = (args: {
  extractedText: string
  summary: string
  patientFriendlyExplanation: string
  keyPoints: string[]
  cautionFlags: string[]
  followUps: string[]
}): string => {
  const parts = dedupeLines([
    args.extractedText || "",
    args.summary || "",
    args.patientFriendlyExplanation || "",
    ...(Array.isArray(args.keyPoints) ? args.keyPoints : []),
    ...(Array.isArray(args.cautionFlags) ? args.cautionFlags : []),
    ...(Array.isArray(args.followUps) ? args.followUps : []),
  ])

  return normalizeRagText(parts.join("\n\n"))
}

const splitTextForRag = (text: string, targetChars: number, overlapChars: number, maxChunks: number): string[] => {
  const source = normalizeRagText(text)
  if (!source) return []

  const chunks: string[] = []
  let cursor = 0

  while (cursor < source.length && chunks.length < maxChunks) {
    const hardEnd = Math.min(source.length, cursor + targetChars)
    let end = hardEnd

    if (hardEnd < source.length) {
      const slice = source.slice(cursor, hardEnd + 140)
      const boundaryMatch = slice.match(/[\n.!?]\s+[^\n.!?]*$/)
      if (boundaryMatch && boundaryMatch.index && boundaryMatch.index > targetChars * 0.45) {
        end = cursor + boundaryMatch.index + 1
      } else {
        const lastSpace = source.lastIndexOf(" ", hardEnd)
        if (lastSpace > cursor + Math.floor(targetChars * 0.45)) {
          end = lastSpace
        }
      }
    }

    const chunk = normalizeRagText(source.slice(cursor, end))
    if (chunk.length >= 40) {
      chunks.push(chunk)
    }

    if (end >= source.length) break

    const nextCursor = Math.max(end - overlapChars, cursor + 1)
    if (nextCursor <= cursor) {
      cursor = end
    } else {
      cursor = nextCursor
    }
  }

  return chunks.slice(0, maxChunks)
}

const vectorToPgLiteral = (values: number[]): string =>
  `[${(values || []).map((value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return "0"
    return numeric.toFixed(8)
  }).join(",")}]`

const invokeOpenAiEmbeddings = async (args: {
  apiKey: string
  inputs: string[]
  model: string
}): Promise<number[][]> => {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      input: args.inputs,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Embedding request failed (${response.status})`)
  }

  const rows = Array.isArray(payload?.data) ? payload.data : []
  const vectors = rows
    .map((item: any) => (Array.isArray(item?.embedding) ? item.embedding : null))
    .filter((embedding: number[] | null): embedding is number[] => Array.isArray(embedding) && embedding.length > 0)

  if (vectors.length !== args.inputs.length) {
    throw new Error("Embedding response size mismatch.")
  }

  return vectors
}

const isMissingRagTableError = (error: any): boolean => {
  const msg = String(error?.message || "").toLowerCase()
  return msg.includes("relation") && msg.includes("does not exist")
}

const upsertReportRagChunks = async (args: {
  serviceClient: any
  reportId: string
  patientId: string
  openAiApiKey: string
  sourceText: string
  reportType: string
  traceId: string
}): Promise<{
  enabled: boolean
  skippedReason: string | null
  embeddingModel: string | null
  chunkCount: number
}> => {
  if (!args.serviceClient) {
    return { enabled: false, skippedReason: "service_client_missing", embeddingModel: null, chunkCount: 0 }
  }

  const model = getRagEmbeddingModelName()
  const normalizedSource = normalizeRagText(args.sourceText || "")

  // Always clean stale chunks first for this report, then attempt fresh write.
  const { error: deleteError } = await args.serviceClient
    .from("medical_report_chunks")
    .delete()
    .eq("report_id", args.reportId)
    .eq("patient_id", args.patientId)

  if (deleteError) {
    if (isMissingRagTableError(deleteError)) {
      return { enabled: false, skippedReason: "rag_table_missing", embeddingModel: null, chunkCount: 0 }
    }
    traceLog("warn", args.traceId, "rag_chunks_delete_failed", {
      error: clipText(deleteError?.message || "delete_failed", 220),
    })
  }

  if (!args.openAiApiKey) {
    return { enabled: false, skippedReason: "openai_key_missing", embeddingModel: null, chunkCount: 0 }
  }

  if (normalizedSource.length < RAG_MIN_SOURCE_TEXT_CHARS) {
    return { enabled: false, skippedReason: "source_text_too_short", embeddingModel: model, chunkCount: 0 }
  }

  const chunks = splitTextForRag(
    normalizedSource,
    RAG_CHUNK_TARGET_CHARS,
    RAG_CHUNK_OVERLAP_CHARS,
    RAG_MAX_CHUNKS_PER_REPORT
  )

  if (chunks.length === 0) {
    return { enabled: false, skippedReason: "chunking_produced_zero", embeddingModel: model, chunkCount: 0 }
  }

  const embeddings = await invokeOpenAiEmbeddings({
    apiKey: args.openAiApiKey,
    inputs: chunks,
    model,
  })

  const rows = chunks.map((chunk, index) => ({
    report_id: args.reportId,
    patient_id: args.patientId,
    chunk_index: index,
    content: chunk,
    chunk_char_count: chunk.length,
    embedding: vectorToPgLiteral(embeddings[index]),
    metadata: {
      report_type: args.reportType || "medical_report",
      embedding_model: model,
      chunk_target_chars: RAG_CHUNK_TARGET_CHARS,
      chunk_overlap_chars: RAG_CHUNK_OVERLAP_CHARS,
    },
  }))

  const { error: insertError } = await args.serviceClient
    .from("medical_report_chunks")
    .insert(rows)

  if (insertError) {
    if (isMissingRagTableError(insertError)) {
      return { enabled: false, skippedReason: "rag_table_missing", embeddingModel: model, chunkCount: 0 }
    }
    throw new Error(insertError?.message || "rag_chunk_insert_failed")
  }

  return { enabled: true, skippedReason: null, embeddingModel: model, chunkCount: rows.length }
}

const isLikelyMedicalContent = (text: string): boolean => {
  const normalized = (text || "").toLowerCase()
  if (!normalized) return false
  const signals = [
    "hemoglobin",
    "hb",
    "cbc",
    "cholesterol",
    "hdl",
    "ldl",
    "triglyceride",
    "glucose",
    "rbs",
    "fbs",
    "creatinine",
    "urea",
    "wbc",
    "platelet",
    "bp ",
    "blood pressure",
    "mmhg",
    "mg/dl",
    "mmol/l",
    "bpm",
    "x-ray",
    "ct",
    "mri",
    "ultrasound",
    "echo",
    "prescription",
    "tablet",
    "capsule",
    "dosage",
    "dose",
    "diagnosis",
    "impression",
    "clinical",
    "pathology",
    "path labs",
    "pathlab",
    "investigation",
    "reference range",
    "normal range",
    "test result",
    "lab result",
    "hematology",
    "biochemistry",
    "thyroid",
    "liver function",
    "kidney function",
    "serum",
    "urine",
    "report",
    "patient",
    "doctor",
  ]
  return signals.some((token) => normalized.includes(token))
}

const isLikelyDocumentReadFailureReply = (raw: string): boolean => {
  const normalized = (raw || "").toLowerCase()
  if (!normalized) return true
  const patterns = [
    "cannot access",
    "can't access",
    "unable to access",
    "cannot read",
    "can't read",
    "unable to read",
    "cannot view",
    "can't view",
    "unable to view",
    "no document",
    "no file",
    "please upload",
    "please provide the report",
    "share the report",
    "not enough information",
    "could not extract",
  ]
  return patterns.some((pattern) => normalized.includes(pattern))
}

const isLikelyMedicalAnalysisResult = (parsed: {
  summary?: string
  patient_friendly_explanation?: string
  key_points?: unknown
  parameter_highlights?: unknown
  report_type?: string
}): boolean => {
  const normalizedReportType = String(parsed?.report_type || "").trim().toLowerCase()
  if (["lab_report", "imaging", "prescription", "discharge_summary"].includes(normalizedReportType)) {
    return true
  }

  const keyPoints = Array.isArray(parsed?.key_points)
    ? parsed.key_points
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : []
  const parameterHighlights = Array.isArray(parsed?.parameter_highlights)
    ? parsed.parameter_highlights
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : []

  const combinedText = [
    String(parsed?.summary || "").trim(),
    String(parsed?.patient_friendly_explanation || "").trim(),
    ...keyPoints,
    ...parameterHighlights,
  ]
    .filter(Boolean)
    .join(" ")

  return isLikelyMedicalContent(combinedText)
}

const getDayWindowInOffset = (now: Date, offsetMinutes: number) => {
  const utcMs = now.getTime()
  const offsetMs = offsetMinutes * 60 * 1000
  const shifted = new Date(utcMs + offsetMs)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth()
  const day = shifted.getUTCDate()
  const startMs = Date.UTC(year, month, day, 0, 0, 0) - offsetMs
  const endMs = startMs + 24 * 60 * 60 * 1000
  return {
    dayKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  }
}

const parseIsoToMs = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const evaluateRateLimit = async (args: { serviceClient: any; userId: string; action: string; now?: Date }) => {
  if (!args.serviceClient) {
    return { blocked: false, used: 0, remaining: AI_MESSAGE_LIMIT_PER_WINDOW, burstUsed: 0, retryAfterMs: 0 }
  }
  const now = args.now || new Date()
  const nowMs = now.getTime()
  const dayWindow = getDayWindowInOffset(now, AI_RATE_LIMIT_TZ_OFFSET_MINUTES)

  const burstWindowStartIso = new Date(nowMs - AI_BURST_WINDOW_MS).toISOString()
  const { data: burstRows } = await args.serviceClient
    .from("ai_agent_actions")
    .select("created_at")
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .gte("created_at", burstWindowStartIso)
    .order("created_at", { ascending: true })
    .limit(AI_BURST_LIMIT_MESSAGES)
  const burstUsed = Array.isArray(burstRows) ? burstRows.length : 0
  if (burstUsed >= AI_BURST_LIMIT_MESSAGES) {
    const oldest = burstRows?.[0]?.created_at ? parseIsoToMs(burstRows[0].created_at) : null
    const retryAfterMs = oldest ? Math.max(1000, AI_BURST_WINDOW_MS - Math.max(0, nowMs - oldest)) : AI_BURST_WINDOW_MS
    return { blocked: true, burst: true, retryAfterMs, used: 0, remaining: AI_MESSAGE_LIMIT_PER_WINDOW, burstUsed }
  }

  const { count: sentCount } = await args.serviceClient
    .from("ai_agent_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", args.userId)
    .eq("action", args.action)
    .in("status", ["success", "fallback"])
    .gte("created_at", dayWindow.startIso)
    .lt("created_at", dayWindow.endIso)

  const used = Math.max(0, Number(sentCount) || 0)
  if (used >= AI_MESSAGE_LIMIT_PER_WINDOW) {
    return { blocked: true, burst: false, retryAfterMs: AI_FIRST_BLOCK_MS, used, remaining: 0, burstUsed }
  }

  return {
    blocked: false,
    burst: false,
    retryAfterMs: 0,
    used,
    remaining: Math.max(0, AI_MESSAGE_LIMIT_PER_WINDOW - used),
    burstUsed,
  }
}

const isLikelyVisionCapableModel = (model: string): boolean => {
  const normalized = (model || "").toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes("4o") ||
    normalized.includes("4.1") ||
    normalized.includes("vision")
  )
}

const getOpenAIModelCandidates = (args?: { requireVision?: boolean }): string[] => {
  const requireVision = Boolean(args?.requireVision)
  const primary = getOpenAIModelName()
  const fallbacks = parseModelList(
    Deno.env.get("ANALYZE_OPENAI_MODEL_FALLBACK") || Deno.env.get("OPENAI_MODEL_FALLBACK") || ""
  )

  const dedupe = (models: string[]): string[] =>
    models.filter((model, index, list) => model.length > 0 && list.indexOf(model) === index)

  if (!requireVision) {
    const standard = dedupe([primary, ...fallbacks, DEFAULT_OPENAI_FALLBACK_MODEL])
    return standard.length > 0 ? standard : [DEFAULT_OPENAI_MODEL]
  }

  const visionPrimary = (Deno.env.get("ANALYZE_OPENAI_VISION_MODEL") || Deno.env.get("OPENAI_VISION_MODEL") || "").trim()
  const visionFallbacks = parseModelList(
    Deno.env.get("ANALYZE_OPENAI_VISION_MODEL_FALLBACK") || Deno.env.get("OPENAI_VISION_MODEL_FALLBACK") || ""
  )
  const derivedVisionCandidates = [primary, ...fallbacks].filter(isLikelyVisionCapableModel)
  const deduped = dedupe([
    visionPrimary,
    ...visionFallbacks,
    ...derivedVisionCandidates,
    DEFAULT_OPENAI_VISION_MODEL,
    DEFAULT_OPENAI_VISION_FALLBACK_MODEL,
  ])

  return deduped.length > 0 ? deduped : [DEFAULT_OPENAI_MODEL]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getGeminiModelName = (): string => {
  const fromEnv = (Deno.env.get("ANALYZE_GEMINI_MODEL") || Deno.env.get("GEMINI_MODEL") || "").trim()
  return fromEnv || DEFAULT_GEMINI_MODEL
}

const getGeminiOcrModelCandidates = (): string[] => {
  const explicit = parseModelList(
    Deno.env.get("ANALYZE_GEMINI_OCR_MODEL") ||
      Deno.env.get("GEMINI_OCR_MODEL") ||
      Deno.env.get("ANALYZE_GEMINI_OCR_MODEL_FALLBACK") ||
      Deno.env.get("GEMINI_OCR_MODEL_FALLBACK") ||
      ""
  )
  const base = [getGeminiModelName(), ...DEFAULT_GEMINI_OCR_MODELS]
  const models = [...explicit, ...base].filter(Boolean)
  return models.filter((model, index) => models.indexOf(model) === index)
}

const getGeminiDeepPdfModelCandidates = (): string[] => {
  const explicit = parseModelList(
    Deno.env.get("ANALYZE_GEMINI_DEEP_PDF_MODEL") ||
      Deno.env.get("GEMINI_DEEP_PDF_MODEL") ||
      Deno.env.get("ANALYZE_GEMINI_DEEP_PDF_MODEL_FALLBACK") ||
      Deno.env.get("GEMINI_DEEP_PDF_MODEL_FALLBACK") ||
      ""
  )
  // Keep deep rescue quality-first so header-only lab PDFs are re-read with stronger OCR reasoning.
  const baseline = ["gemini-2.5-pro", getGeminiModelName(), ...DEFAULT_GEMINI_OCR_MODELS]
  const merged = [...explicit, ...baseline].filter(Boolean)
  return merged.filter((model, index) => merged.indexOf(model) === index)
}

const buildGeminiEndpoint = (model: string, apiKey: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

const extractGeminiText = (payload: any): string =>
  (payload?.candidates || [])
    .flatMap((candidate: any) => candidate?.content?.parts || [])
    .map((part: any) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .find((text: string) => text.length > 0) || ""

const invokeGeminiWithRetry = async (args: {
  apiKey: string
  body: Record<string, unknown>
  traceId?: string
  modelCandidates?: string[]
  maxAttempts?: number
  timeoutMs?: number
}): Promise<{ rawText: string; model: string }> => {
  const models = (args.modelCandidates && args.modelCandidates.length > 0
    ? args.modelCandidates
    : [getGeminiModelName()]
  ).filter(Boolean)
  const maxAttempts = Math.max(1, args.maxAttempts || GEMINI_MAX_ATTEMPTS)
  const timeoutMs = Math.max(12000, args.timeoutMs || GEMINI_REQUEST_TIMEOUT_MS)
  let lastError: any = null

  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (args.traceId) {
        traceLog("log", args.traceId, "gemini_attempt_start", {
          model,
          attempt,
          timeoutMs,
        })
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort("request_timeout"), timeoutMs)
      try {
        const response = await fetch(buildGeminiEndpoint(model, args.apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.body),
          signal: controller.signal,
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error?.message || `Gemini analysis failed (${response.status})`)
        }

        const rawText = extractGeminiText(data)
        if (!rawText) {
          throw new Error("Gemini returned empty analysis response.")
        }

        if (args.traceId) {
          traceLog("log", args.traceId, "gemini_attempt_success", {
            model,
            attempt,
            rawTextLength: rawText.length,
          })
        }

        return { rawText, model }
      } catch (error) {
        lastError = error
        if (args.traceId) {
          traceLog("warn", args.traceId, "gemini_attempt_failed", {
            model,
            attempt,
            error: clipText(error?.message || "gemini_failed", 220),
          })
        }
        if (attempt < maxAttempts) {
          await sleep(300 * attempt)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  throw new Error(lastError?.message || "Gemini analysis unavailable")
}


const invokeGeminiOcrExtraction = async (args: {
  apiKey: string
  mimeType: string
  base64Data: string
  traceId?: string
}): Promise<{ text: string; model: string }> => {
  const models = getGeminiOcrModelCandidates().slice(0, GEMINI_OCR_MAX_MODELS)
  let lastError: any = null

  const prompt = [
    "Extract all visible text from this medical document exactly as seen.",
    "Read all pages before replying. Preserve page order.",
    "Keep table-like rows line-by-line so test name, value, unit, and range stay together.",
    "Focus on report values, units, reference ranges, medicine names, dose/frequency, impressions, and conclusions.",
    "Do not summarize, do not explain, do not add extra content.",
    "Return plain text only.",
  ].join(" ")

  for (const model of models) {
    for (let attempt = 1; attempt <= GEMINI_OCR_MAX_ATTEMPTS; attempt += 1) {
      if (args.traceId) {
        traceLog("log", args.traceId, "gemini_ocr_attempt_start", { model, attempt, mimeType: args.mimeType })
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort("request_timeout"), Math.max(20000, GEMINI_REQUEST_TIMEOUT_MS))
      try {
        const response = await fetch(buildGeminiEndpoint(model, args.apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: "You are a high-accuracy OCR extractor for medical documents." }],
            },
            generationConfig: {
              temperature: 0,
              topP: 1,
              maxOutputTokens: Math.max(1600, GEMINI_MAX_OUTPUT_TOKENS),
              responseMimeType: "text/plain",
            },
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: args.mimeType || "application/octet-stream",
                      data: args.base64Data,
                    },
                  },
                ],
              },
            ],
          }),
          signal: controller.signal,
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data?.error?.message || `Gemini OCR failed (${response.status})`)
        }

        const rawText = extractGeminiText(data)
        const text = clipText(normalizeOcrText(rawText), AI_OCR_MAX_TEXT_CHARS)
        if (!text) {
          throw new Error("Gemini OCR returned empty text")
        }

        if (args.traceId) {
          traceLog("log", args.traceId, "gemini_ocr_attempt_success", {
            model,
            attempt,
            extractedChars: text.length,
          })
        }

        return { text, model }
      } catch (error) {
        lastError = error
        if (args.traceId) {
          traceLog("warn", args.traceId, "gemini_ocr_attempt_failed", {
            model,
            attempt,
            error: clipText(error?.message || "gemini_ocr_failed", 220),
          })
        }
        if (attempt < GEMINI_OCR_MAX_ATTEMPTS) {
          await sleep(300 * attempt)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  throw new Error(lastError?.message || "Gemini OCR unavailable")
}

const isImageLikeMime = (mimeType: string): boolean => {
  const normalized = (mimeType || "").toLowerCase()
  return normalized.startsWith("image/")
}

const extractOpenAIText = (payload: any): string => {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === "string") {
    return content.trim()
  }
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim()
  }
  return ""
}

const extractOpenAIResponsesOutputText = (payload: any): string => {
  const direct = typeof payload?.output_text === "string" ? payload.output_text.trim() : ""
  if (direct) return direct

  const outputs = Array.isArray(payload?.output) ? payload.output : []
  const fromOutput = outputs
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((part: any) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter((text: string) => text.length > 0)
    .join("\n")
    .trim()

  return fromOutput
}

const invokeOpenAIResponsesFileWithRetry = async (args: {
  apiKey: string
  mimeType: string
  fileName: string
  base64Data: string
  promptText: string
  traceId?: string
}): Promise<{ rawText: string; model: string }> => {
  const candidates = getOpenAIModelCandidates({ requireVision: true })
  let lastError: any = null

  if (args.traceId) {
    traceLog("log", args.traceId, "openai_responses_file_models_resolved", { candidates })
  }

  for (const model of candidates) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (args.traceId) {
        traceLog("log", args.traceId, "openai_responses_file_attempt_start", { model, attempt })
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort("request_timeout"), 30_000)
      try {
        const fileDataUri = `data:${args.mimeType || "application/octet-stream"};base64,${args.base64Data}`
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${args.apiKey}`,
          },
          body: JSON.stringify({
            model,
            reasoning: { effort: "low" },
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: args.promptText },
                  {
                    type: "input_file",
                    filename: args.fileName || "medical-report.pdf",
                    file_data: fileDataUri,
                  },
                ],
              },
            ],
            temperature: 0.2,
            top_p: 0.95,
            max_output_tokens: 3200,
            text: { format: { type: "text" } },
          }),
          signal: controller.signal,
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data?.error?.message || `OpenAI responses file analysis failed (${response.status})`)
        }

        const rawText = extractOpenAIResponsesOutputText(data)
        if (!rawText) {
          throw new Error("OpenAI responses file analysis returned empty output.")
        }

        if (args.traceId) {
          traceLog("log", args.traceId, "openai_responses_file_attempt_success", {
            model,
            attempt,
            rawTextLength: rawText.length,
          })
        }

        return { rawText, model }
      } catch (error) {
        lastError = error
        if (args.traceId) {
          traceLog("warn", args.traceId, "openai_responses_file_attempt_failed", {
            model,
            attempt,
            error: clipText(error?.message || "openai_responses_file_failed", 220),
          })
        }
        if (attempt < 2) {
          await sleep(300 * attempt)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  throw new Error(lastError?.message || "OpenAI responses file analysis unavailable")
}

const invokeOpenAIWithRetry = async (args: {
  apiKey: string
  messages: Array<any>
  requireVision?: boolean
  traceId?: string
}): Promise<{ rawText: string; model: string }> => {
  const requireVision = Boolean(args.requireVision)
  const candidates = getOpenAIModelCandidates({ requireVision })
  let lastError: any = null

  if (args.traceId) {
    traceLog("log", args.traceId, "openai_models_resolved", {
      requireVision,
      candidates,
    })
  }

  for (const model of candidates) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (args.traceId) {
        traceLog("log", args.traceId, "openai_attempt_start", { model, attempt })
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort("request_timeout"), 22_000)

      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${args.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: args.messages,
            reasoning_effort: "low",
            temperature: 0.2,
            top_p: 0.95,
            max_completion_tokens: 3200,
          }),
          signal: controller.signal,
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error?.message || `OpenAI analysis failed (${response.status})`)
        }

        const rawText = extractOpenAIText(data)
        if (!rawText) {
          throw new Error("OpenAI returned empty analysis response.")
        }

        if (args.traceId) {
          traceLog("log", args.traceId, "openai_attempt_success", {
            model,
            attempt,
            rawTextLength: rawText.length,
          })
        }

        return { rawText, model }
      } catch (error) {
        lastError = error
        if (args.traceId) {
          traceLog("warn", args.traceId, "openai_attempt_failed", {
            model,
            attempt,
            error: clipText(error?.message || "openai_failed", 220),
          })
        }
        if (attempt < 2) {
          await sleep(300 * attempt)
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  throw new Error(lastError?.message || "OpenAI analysis unavailable")
}

const normalizeProviderError = (rawMessage: string): string => {
  const message = (rawMessage || "").trim()
  if (!message) {
    return "Failed to analyze report."
  }

  const normalized = message.toLowerCase()
  const isQuotaIssue =
    normalized.includes("quota exceeded") ||
    normalized.includes("rate limit") ||
    normalized.includes("generate_content_free_tier") ||
    normalized.includes("resource_exhausted")

  if (
    normalized.includes("cpu time exceeded") ||
    normalized.includes("worker_limit") ||
    normalized.includes("not enough compute") ||
    normalized.includes("resource limit")
  ) {
    return "This report is too heavy for a single scan right now. Please retry with a smaller PDF, or upload clear page images."
  }

  if (!isQuotaIssue) {
    return message
  }

  const retryMatch = message.match(/retry in\s+([\d.]+)\s*s/i)
  const retrySeconds = retryMatch ? Number.parseFloat(retryMatch[1]) : NaN
  const retryHint =
    Number.isFinite(retrySeconds) && retrySeconds > 0
      ? `Please retry in about ${Math.ceil(retrySeconds)} seconds.`
      : "Please retry in 1-2 minutes."

  return `AI scanner is temporarily busy. ${retryHint}`
}

Deno.serve(async (req) => {
  let serviceClient: any = null
  let currentUserId: string | null = null
  let currentReportId: string | null = null
  const requestStartedAt = Date.now()
  const traceId = crypto.randomUUID().slice(0, 8)

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    traceLog("log", traceId, "request_received", { method: req.method })
    const authHeader = req.headers.get("authorization") || ""
    const accessToken = authHeader.replace("Bearer ", "").trim()
    if (!accessToken) {
      traceLog("warn", traceId, "missing_access_token")
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim()
    const geminiApiKeyRaw = (Deno.env.get("GEMINI_API_KEY") || "").trim()
    const geminiApiKey = FORCE_OPENAI_ONLY ? "" : geminiApiKeyRaw
    if (!openAiApiKey) {
      throw new Error("OPENAI_API_KEY must be configured on Edge runtime.")
    }
    const configuredGeminiModel = geminiApiKey ? getGeminiModelName() : null
    traceLog("log", traceId, "provider_keys_loaded", {
      hasOpenAI: Boolean(openAiApiKey),
      hasGemini: Boolean(geminiApiKey),
      hasGeminiEnv: Boolean(geminiApiKeyRaw),
      geminiIgnored: FORCE_OPENAI_ONLY,
      mode: FORCE_OPENAI_ONLY ? "openai_only" : "openai_primary_gemini_fallback",
      openAiModel: getOpenAIModelName(),
      openAiCandidates: getOpenAIModelCandidates({ requireVision: false }),
      geminiModel: configuredGeminiModel,
    })

    serviceClient = createServiceClient()
    const {
      data: { user },
      error: authError,
    } = await serviceClient.auth.getUser(accessToken)
    if (authError || !user) {
      traceLog("warn", traceId, "auth_user_failed", {
        error: clipText(authError?.message || "unauthorized", 180),
      })
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    currentUserId = user.id
    traceLog("log", traceId, "auth_user_ok", { userId: maskId(user.id) })

    const rateLimit = await evaluateRateLimit({
      serviceClient,
      userId: user.id,
      action: "analyze_medical_report",
    })
    if (rateLimit.blocked) {
      return new Response(
        JSON.stringify({
          success: false,
          message: rateLimit.burst
            ? "Too many rapid scans. Please wait and retry."
            : "Daily AI scan limit reached. Please try again later.",
          retryAfterMs: rateLimit.retryAfterMs,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const body = await req.json()
    const reportId = typeof body?.reportId === "string" ? body.reportId : ""
    const responseLanguage =
      typeof body?.responseLanguage === "string" ? body.responseLanguage.trim().toLowerCase() : "auto"
    const forceEnglishResponse = responseLanguage === "en" || responseLanguage === "english"
    if (!reportId) {
      throw new Error("reportId is required.")
    }
    currentReportId = reportId
    traceLog("log", traceId, "request_payload_ok", { reportId: maskId(reportId) })

    const { data: reportRow, error: reportError } = await serviceClient
      .from("medical_reports")
      .select("id, patient_id, file_name, file_path, mime_type, file_size_bytes, analysis_status, updated_at")
      .eq("id", reportId)
      .eq("patient_id", user.id)
      .is("deleted_at", null)
      .single()

    if (reportError || !reportRow) {
      throw new Error("Report not found for this user.")
    }
    traceLog("log", traceId, "report_row_loaded", {
      reportId: maskId(reportId),
      mimeType: reportRow?.mime_type || "",
      fileSizeBytes: Number(reportRow?.file_size_bytes || 0),
      currentStatus: String(reportRow?.analysis_status || ""),
    })

    const reportStatus = String(reportRow?.analysis_status || "").toLowerCase()
    if (reportStatus === "processing") {
      const updatedAtMs = Date.parse(String(reportRow?.updated_at || ""))
      const processingAgeMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Number.POSITIVE_INFINITY
      const PROCESSING_DEDUP_WINDOW_MS = 12 * 60 * 1000

      if (processingAgeMs < PROCESSING_DEDUP_WINDOW_MS) {
        traceLog("log", traceId, "duplicate_processing_request_skipped", {
          reportId: maskId(reportId),
          processingAgeMs,
        })
        return new Response(
          JSON.stringify({
            success: true,
            message: "Analysis already in progress.",
            data: {
              reportId,
              status: "processing",
              deduped: true,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    await serviceClient
      .from("medical_reports")
      .update({
        analysis_status: "processing",
        analysis_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .eq("patient_id", user.id)

    const { data: fileBlob, error: downloadError } = await serviceClient.storage
      .from("medical-reports")
      .download(reportRow.file_path)

    if (downloadError || !fileBlob) {
      throw new Error(downloadError?.message || "Failed to read uploaded report file.")
    }
    traceLog("log", traceId, "file_downloaded", {
      path: clipText(String(reportRow.file_path || ""), 80),
    })

    const fileBuffer = new Uint8Array(await fileBlob.arrayBuffer())
    const fileSize = Number(reportRow.file_size_bytes || fileBuffer.byteLength || 0)
    const mimeType = inferMimeType(reportRow.mime_type || "", reportRow.file_name || "")
    const pdfMime = isPdfMime(mimeType)
    const allowPdfInlineBinary = ALLOW_PDF_INLINE_BINARY
    const pdfTooLargeForInline = pdfMime && fileSize > MAX_PDF_INLINE_BYTES
    if (fileSize > MAX_ANALYZE_FILE_BYTES) {
      const maxMb = Math.max(1, Math.floor(MAX_ANALYZE_FILE_BYTES / (1024 * 1024)))
      throw new Error(`File is too large for AI scan. Please upload a file up to ${maxMb} MB.`)
    }
    traceLog("log", traceId, "file_ready_for_analysis", {
      fileName: clipText(String(reportRow.file_name || ""), 80),
      mimeType,
      fileSizeBytes: fileSize,
      pdfTooLargeForInline,
      textLike: isTextLikeMime(mimeType),
      imageLike: isImageLikeMime(mimeType),
      documentLike: isDocumentLikeMime(mimeType),
    })

    const analysisPrompt = [
      "You are the CD4 Medical AI assistant, a highly empathetic and highly capable medical NLP expert.",
      "Analyze the uploaded patient report and return strict JSON only.",
      forceEnglishResponse
        ? "All output text must be in professional English only. Do not use Hindi or mixed-script output."
        : "Match the user's preferred language when available.",
      "Rules:",
      "1) Explain the report in simple, patient-friendly language. Lead with the main conclusion.",
      "2) Stay factual to report content only. Do not invent details.",
      "3) Do not prescribe medicines or give final medical diagnoses.",
      "4) Cover the important visible parameters, prioritizing abnormal or attention-required values. Explain what each important value means in plain language.",
      "5) Remove repetition. Do not repeat the same value or conclusion in multiple sections unless needed for safety.",
      "6) Keep the summary to 3-5 short lines and patient_friendly_explanation to 2-4 short paragraphs. Be concise but complete.",
      "7) In key_points include 5-8 high-value findings with test name, value, unit, reference range, and meaning when visible.",
      "8) Use emojis sparingly: only for a main conclusion, warning, or next step.",
      "9) Cover visible pages/sections, but omit administrative details and generic health advice unless clinically relevant.",
      "10) If report is prescription, extract medicines only if clearly visible. Never invent medicine names/doses.",
      "11) For lab/pathology reports, include parameter-wise findings with observed value, unit, and reference range wherever visible.",
      "12) If any values are unclear/unreadable, explicitly say they were not clearly visible; never guess.",
      "13) Capture report identity details if visible: patient name, age, gender, lab/hospital name, report date, sample collection date, report/lab id.",
      "14) For prescriptions, also capture visible form fields (if present): relation tag, insurance/provider IDs, address/cell, BP/pulse/weight, allergies/disabilities, diet/history, follow-up physician.",
      "15) Add parameter_highlights with concise, non-duplicated value-wise lines for the most important numbers only.",
      "16) Keep response medically precise and fact-grounded. If the report is unclear, say so briefly.",
      "JSON shape:",
      "{",
      '  "summary": "3-5 short lines: main conclusion, important abnormalities, and what the patient should do next",',
      '  "key_points": ["5-8 non-repeating important findings with values/ranges and plain meaning"],',
      '  "report_type": "lab_report|imaging|prescription|discharge_summary|other",',
      '  "report_identity": {',
      '    "patient_name": "if visible else empty",',
      '    "age": "if visible else empty",',
      '    "gender": "if visible else empty",',
      '    "lab_name": "if visible else empty",',
      '    "report_date": "if visible else empty",',
      '    "sample_collected_at": "if visible else empty",',
      '    "report_id": "if visible else empty",',
      '    "referred_by": "if visible else empty"',
      "  },",
      '  "parameter_highlights": ["test/value/unit/reference/status in one line"],',
      '  "abnormal_findings": ["only clearly visible abnormal findings"],',
      '  "normal_findings": ["important normal findings worth reassurance"],',
      '  "missing_sections": ["sections or values not clearly visible"],',
      '  "confidence_note": "1 line on how complete/clear the report reading was",',
      '  "caution_flags": ["critical watchouts, if any"],',
      '  "suggested_followups": ["valuable lifestyle or doctor follow-up actions"],',
      '  "medications": ["only medicines clearly visible in prescription with dose/frequency when available"],',
      '  "prescription_details": {',
      '    "doctor_name": "if visible else empty",',
      '    "diagnosis": "if visible else empty",',
      '    "prescribed_on": "if visible else empty",',
      '    "followup_date": "if visible else empty",',
      '    "patient_name": "if visible else empty",',
      '    "relation_tag": "S/O D/O W/O or guardian info if visible",',
      '    "age": "if visible else empty",',
      '    "sex": "if visible else empty",',
      '    "occupation": "if visible else empty",',
      '    "insurance_no": "if visible else empty",',
      '    "health_provider": "if visible else empty",',
      '    "health_card_no": "if visible else empty",',
      '    "patient_id_no": "if visible else empty",',
      '    "address": "if visible else empty",',
      '    "cell_no": "if visible else empty",',
      '    "blood_pressure": "if visible else empty",',
      '    "pulse_rate": "if visible else empty",',
      '    "weight": "if visible else empty",',
      '    "allergies": "if visible else empty",',
      '    "disabilities": "if visible else empty",',
      '    "diet_to_follow": "if visible else empty",',
      '    "brief_history": "if visible else empty",',
      '    "followup_physician": "if visible else empty",',
      '    "general_instructions": ["doctor instructions clearly visible in prescription"],',
      '    "red_flags": ["urgent warning signs or when to seek immediate care"],',
      '    "medications": [',
      '      {',
      '        "name": "medicine name",',
      '        "dosage": "dose/strength if visible",',
      '        "frequency": "how often if visible",',
      '        "timing": "before/after food or time if visible",',
      '        "duration": "days/course if visible",',
      '        "purpose": "indication if inferable from report text",',
      '        "instructions": "extra notes if visible"',
      "      }",
      "    ]",
      "  },",
      '  "what_to_avoid": ["avoid list based on report findings"],',
      '  "next_24h_actions": ["prioritized next 24 hour actions"],',
      '  "recovery_timeline": "estimated timeline in simple language based on report severity (if inferable)",',
      '  "patient_friendly_explanation": "2-4 short paragraphs explaining the important findings in simple language without repetition"',
      "}",
    ].join("\n")
    const analysisDocumentHeader = [
      `File name: ${clipText(String(reportRow.file_name || "uploaded-report"), 120)}`,
      `Mime type: ${mimeType}`,
      `File size bytes: ${fileSize}`,
      "Important: include concrete values from as many visible report parameters as possible.",
    ].join("\n")

    let extractedText = ""
    const extractionStartedAt = Date.now()
    let extractionMs = 0
    let base64File = ""
    let aiOcrUsed = false
    let aiOcrModel: string | null = null
    let aiOcrError: string | null = null
    let aiOcrTextLength = 0

    if (isTextLikeMime(mimeType)) {
      extractedText = clipText(new TextDecoder().decode(fileBuffer), MAX_EXTRACTED_TEXT_CHARS)
    } else if (pdfMime) {
      // Always attempt best-effort text extraction for PDFs first.
      // This improves coverage for multi-page lab reports before model analysis.
      const shouldTryPdfTextExtraction = true
      if (shouldTryPdfTextExtraction) {
        extractedText = extractBestEffortDocumentText(fileBuffer, mimeType)
        traceLog("log", traceId, "document_text_extraction", {
          mimeType,
          extractedTextLength: extractedText.length,
          shouldTryPdfTextExtraction,
        })
      } else {
        traceLog("log", traceId, "pdf_text_extraction_skipped", {
          allowPdfInlineBinary,
          pdfTooLargeForInline,
          hasGeminiKey: Boolean(geminiApiKey),
          enablePdfTextExtraction: ENABLE_PDF_TEXT_EXTRACTION,
        })
      }
    } else if (isDocumentLikeMime(mimeType)) {
      extractedText = extractBestEffortDocumentText(fileBuffer, mimeType)
      traceLog("log", traceId, "document_text_extraction", {
        mimeType,
        extractedTextLength: extractedText.length,
      })
    }
    let extractedTextReadable = extractedText.length > 0 && isReadableExtractedText(extractedText)
    let extractedTextHasMedicalSignal = extractedTextReadable && isLikelyMedicalContent(extractedText)
    let extractedTextLowConfidence = extractedTextReadable && isLowConfidenceMedicalExtraction(extractedText, mimeType)

    const shouldAttemptAiOcrFallback =
      !FORCE_OPENAI_ONLY &&
      ENABLE_AI_OCR_FALLBACK &&
      (!extractedTextReadable || extractedTextLowConfidence || !extractedTextHasMedicalSignal) &&
      Boolean(geminiApiKey) &&
      (pdfMime || isImageLikeMime(mimeType) || isDocumentLikeMime(mimeType)) &&
      fileSize <= MAX_ANALYZE_FILE_BYTES

    if (shouldAttemptAiOcrFallback) {
      try {
        if (!base64File) {
          base64File = encodeBase64(fileBuffer)
        }
        const ocrExtraction = await invokeGeminiOcrExtraction({
          apiKey: geminiApiKey,
          mimeType,
          base64Data: base64File,
          traceId,
        })
        const ocrText = clipText(ocrExtraction.text || "", MAX_EXTRACTED_TEXT_CHARS)
        const ocrTextUsable =
          isReadableExtractedText(ocrText) ||
          (normalizeDecodedText(ocrText).length >= AI_OCR_MIN_TEXT_CHARS && isLikelyMedicalContent(ocrText))

        if (ocrTextUsable) {
          extractedText = mergeExtractedTexts(extractedText, ocrText)
          extractedTextReadable = true
          extractedTextHasMedicalSignal = isLikelyMedicalContent(extractedText)
          extractedTextLowConfidence = isLowConfidenceMedicalExtraction(extractedText, mimeType)
          aiOcrUsed = true
          aiOcrModel = ocrExtraction.model
          aiOcrTextLength = extractedText.length
        } else {
          aiOcrError = "ocr_text_not_usable"
        }
      } catch (ocrError: any) {
        aiOcrError = clipText(ocrError?.message || "ocr_failed", 180)
      }
    }

    extractionMs = Date.now() - extractionStartedAt
    const canUseDirectPdfInput =
      pdfMime &&
      !pdfTooLargeForInline &&
      (allowPdfInlineBinary || (!extractedTextReadable && fileSize <= MAX_PDF_INLINE_FALLBACK_BYTES))
    const likelyPartialPdfExtraction =
      pdfMime &&
      (
        extractedTextLowConfidence ||
        !extractedTextHasMedicalSignal ||
        extractedText.length < 1800
      )
    const preferTextOnlyForPdf =
      pdfMime &&
      extractedTextReadable &&
      !likelyPartialPdfExtraction
    const canUseInlineBinary =
      isImageLikeMime(mimeType) ||
      (canUseDirectPdfInput && !preferTextOnlyForPdf) ||
      (isDocumentLikeMime(mimeType) && !pdfMime && extractedText.length === 0)
    const geminiSupportedForFile =
      isTextLikeMime(mimeType) ||
      isImageLikeMime(mimeType) ||
      isDocumentLikeMime(mimeType)
    const openAiSupportedForFile =
      isTextLikeMime(mimeType) ||
      isImageLikeMime(mimeType) ||
      (isDocumentLikeMime(mimeType) && extractedTextReadable)
    const canUseOpenAiFileInput =
      isDocumentLikeMime(mimeType) &&
      fileSize <= MAX_OPENAI_FILE_INPUT_BYTES
    const shouldUseOpenAiFileInput =
      canUseOpenAiFileInput &&
      (pdfMime || !extractedTextReadable || extractedTextLowConfidence)

    if (FORCE_OPENAI_ONLY && !openAiSupportedForFile && !canUseOpenAiFileInput) {
      if (pdfMime || isDocumentLikeMime(mimeType)) {
        throw new Error(
          "OpenAI-only mode: this document cannot be processed. Please upload a PDF/image/text file under size limits."
        )
      }
      throw new Error("OpenAI-only mode: unsupported file type. Please upload a report PDF/image/text file.")
    }
    const preferGeminiPrimary =
      !FORCE_OPENAI_ONLY &&
      Boolean(geminiApiKey) &&
      geminiSupportedForFile &&
      pdfMime &&
      canUseInlineBinary &&
      likelyPartialPdfExtraction
    // Text keyword gate is reliable only when readable text exists.
    // For image/PDF inline-vision paths, avoid hard-failing before model inspection.
    const canTrustFileAsMedicalCandidateWithoutText =
      isImageLikeMime(mimeType) ||
      canUseDirectPdfInput ||
      (isDocumentLikeMime(mimeType) && !extractedTextReadable && canUseInlineBinary)
    const looksMedical =
      extractedTextReadable
        ? extractedTextHasMedicalSignal
        : canTrustFileAsMedicalCandidateWithoutText
    if (!looksMedical) {
      throw new Error(
        "Upload must be a medical report (lab, imaging, prescription, or discharge summary). Please upload a medical document or clear report image."
      )
    }
    traceLog("log", traceId, "analysis_provider_plan", {
      geminiSupportedForFile,
      openAiSupportedForFile,
      canUseDirectPdfInput,
      canUseInlineBinary,
      likelyPartialPdfExtraction,
      preferTextOnlyForPdf,
      extractedTextReadable,
      extractedTextHasMedicalSignal,
      extractedTextLowConfidence,
      preferGeminiPrimary,
      aiOcrUsed,
      aiOcrModel,
      aiOcrTextLength,
      aiOcrError,
      canTrustFileAsMedicalCandidateWithoutText,
      looksMedical,
      allowPdfInlineBinary,
      maxPdfInlineFallbackBytes: MAX_PDF_INLINE_FALLBACK_BYTES,
      willTryGemini: Boolean(geminiApiKey) && geminiSupportedForFile,
      willTryOpenAI: Boolean(openAiApiKey) && openAiSupportedForFile,
      canUseOpenAiFileInput,
      shouldUseOpenAiFileInput,
    })

    if (canUseInlineBinary) {
      if (!base64File) {
        base64File = encodeBase64(fileBuffer)
      }
      traceLog("log", traceId, "inline_binary_encoded", {
        mimeType,
        encodedBytes: base64File.length,
      })
    }

    if (pdfMime && !canUseDirectPdfInput && !extractedTextReadable) {
      if (pdfTooLargeForInline) {
        const maxMb = Math.max(1, Math.floor(MAX_PDF_INLINE_BYTES / (1024 * 1024)))
        throw new Error(
          `PDF is larger than inline scan limit (${maxMb} MB) and readable text could not be extracted. Please upload a text-based PDF or clear page images.`
        )
      }
      throw new Error(
        "Could not read text from this PDF. Please upload a text-based PDF or clear images/photos of the report pages."
      )
    }
    const geminiBodyToSend: Record<string, unknown> = {
      systemInstruction: {
        parts: [
          {
            text: [
              "You are CD4 Medical Report AI assistant.",
              "Return strict JSON only with the requested shape.",
              "Do not wrap output in markdown fences.",
            ].join(" "),
          },
        ],
      },
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
      },
      contents: [],
    }

    if (preferTextOnlyForPdf && extractedText.length > 0) {
      geminiBodyToSend.contents = [
        {
          role: "user",
          parts: [
            {
              text: `${analysisPrompt}\n\n${analysisDocumentHeader}\n\nDocument text content (best effort extraction):\n${extractedText}`,
            },
          ],
        },
      ]
    } else if (canUseInlineBinary) {
      const partialTextHint =
        extractedText && extractedText.length > 0
          ? `\n\nPartial extracted text hint (verify against document pages):\n${clipText(extractedText, 16000)}`
          : ""
      geminiBodyToSend.contents = [
        {
          role: "user",
          parts: [
            { text: `${analysisPrompt}\n\n${analysisDocumentHeader}${partialTextHint}` },
            {
              inlineData: {
                mimeType: mimeType || "application/octet-stream",
                data: base64File,
              },
            },
          ],
        },
      ]
    } else {
      geminiBodyToSend.contents = [
        {
          role: "user",
          parts: [
            {
              text: `${analysisPrompt}\n\n${analysisDocumentHeader}\n\nDocument text content (best effort extraction):\n${extractedText}`,
            },
          ],
        },
      ]
    }

    let rawText = ""
    let provider: "openai" | "gemini" | "fallback" = "fallback"
    let selectedModel: string | null = null
    let aiMs = 0

    const openAiSystemPrompt = [
      "You are CD4 Medical Report AI assistant.",
      "Return strict JSON only with the requested shape.",
      "Do not wrap output in markdown fences.",
    ].join(" ")

    const buildOpenAiUserContent = (): any => {
      if (isImageLikeMime(mimeType) && base64File) {
        const url = `data:${mimeType || "image/jpeg"};base64,${base64File}`
        return [
          { type: "text", text: `${analysisPrompt}\n\n${analysisDocumentHeader}` },
          { type: "image_url", image_url: { url } },
        ]
      }
      const textPayload = extractedText
        ? `${analysisPrompt}\n\n${analysisDocumentHeader}\n\nDocument text content (best effort extraction):\n${extractedText}`
        : `${analysisPrompt}\n\n${analysisDocumentHeader}`
      return textPayload
    }

    const requireVision = isImageLikeMime(mimeType)
    const openAiMessages = [
      { role: "system", content: openAiSystemPrompt },
      { role: "user", content: buildOpenAiUserContent() },
    ]

    if (openAiApiKey && shouldUseOpenAiFileInput) {
      try {
        if (!base64File) {
          base64File = encodeBase64(fileBuffer)
        }
        traceLog("log", traceId, "openai_responses_file_flow_start", {
          mimeType,
          fileSizeBytes: fileSize,
          extractedTextReadable,
          extractedTextLowConfidence,
        })
        const aiStartedAt = Date.now()
        const openAiFileGeneration = await invokeOpenAIResponsesFileWithRetry({
          apiKey: openAiApiKey,
          mimeType: mimeType || "application/octet-stream",
          fileName: String(reportRow.file_name || "medical-report.pdf"),
          base64Data: base64File,
          promptText:
            `${analysisPrompt}\n\n${analysisDocumentHeader}` +
            (extractedText
              ? `\n\nPartial extracted text hint (verify against full document):\n${clipText(extractedText, 16000)}`
              : ""),
          traceId,
        })
        aiMs = Date.now() - aiStartedAt
        rawText = openAiFileGeneration.rawText
        provider = "openai"
        selectedModel = openAiFileGeneration.model
      } catch (openAiFileError: any) {
        traceLog("warn", traceId, "openai_responses_file_flow_failed", {
          error: clipText(openAiFileError?.message || "openai_responses_file_failed", 220),
        })
        throw new Error(openAiFileError?.message || "OpenAI file analysis failed")
      }
    } else if (preferGeminiPrimary && geminiApiKey && geminiSupportedForFile) {
      try {
        traceLog("log", traceId, "gemini_flow_start", { reason: "pdf_partial_extraction" })
        const aiStartedAt = Date.now()
        const geminiGeneration = await invokeGeminiWithRetry({
          apiKey: geminiApiKey,
          body: geminiBodyToSend,
          traceId,
        })
        aiMs = Date.now() - aiStartedAt
        rawText = geminiGeneration.rawText
        provider = "gemini"
        selectedModel = geminiGeneration.model
      } catch (geminiError: any) {
        traceLog("warn", traceId, "gemini_primary_flow_failed", {
          error: clipText(geminiError?.message || "gemini_failed", 220),
        })
        if (openAiApiKey && openAiSupportedForFile) {
          const aiStartedAt = Date.now()
          const openAiGeneration = await invokeOpenAIWithRetry({
            apiKey: openAiApiKey,
            messages: openAiMessages,
            requireVision,
            traceId,
          })
          aiMs = Date.now() - aiStartedAt
          rawText = openAiGeneration.rawText
          provider = "openai"
          selectedModel = openAiGeneration.model
        } else {
          throw new Error(geminiError?.message || "Gemini analysis failed")
        }
      }
    } else if (openAiApiKey && openAiSupportedForFile) {
      try {
        traceLog("log", traceId, "openai_flow_start", { requireVision })
        const aiStartedAt = Date.now()
        const openAiGeneration = await invokeOpenAIWithRetry({
          apiKey: openAiApiKey,
          messages: openAiMessages,
          requireVision,
          traceId,
        })
        aiMs = Date.now() - aiStartedAt
        rawText = openAiGeneration.rawText
        provider = "openai"
        selectedModel = openAiGeneration.model
      } catch (openAiError: any) {
        traceLog("warn", traceId, "openai_flow_failed", {
          error: clipText(openAiError?.message || "openai_failed", 220),
        })
        // Fall back to Gemini when OpenAI fails (or when OpenAI can't handle PDFs/doc binaries).
        if (geminiApiKey && geminiSupportedForFile) {
          try {
            traceLog("log", traceId, "gemini_flow_start")
            const aiStartedAt = Date.now()
            const geminiGeneration = await invokeGeminiWithRetry({
              apiKey: geminiApiKey,
              body: geminiBodyToSend,
              traceId,
            })
            aiMs = Date.now() - aiStartedAt
            rawText = geminiGeneration.rawText
            provider = "gemini"
            selectedModel = geminiGeneration.model
          } catch (geminiError: any) {
            traceLog("error", traceId, "gemini_flow_failed", {
              error: clipText(geminiError?.message || "gemini_failed", 220),
            })
            throw new Error(openAiError?.message || geminiError?.message || "AI analysis failed")
          }
        } else {
          throw new Error(openAiError?.message || "OpenAI analysis failed")
        }
      }
    } else if (geminiApiKey && geminiSupportedForFile) {
      try {
        traceLog("log", traceId, "gemini_flow_start")
        const aiStartedAt = Date.now()
        const geminiGeneration = await invokeGeminiWithRetry({
          apiKey: geminiApiKey,
          body: geminiBodyToSend,
          traceId,
        })
        aiMs = Date.now() - aiStartedAt
        rawText = geminiGeneration.rawText
        provider = "gemini"
        selectedModel = geminiGeneration.model
      } catch (geminiError: any) {
        traceLog("error", traceId, "gemini_flow_failed", {
          error: clipText(geminiError?.message || "gemini_failed", 220),
        })
        throw new Error(geminiError?.message || "Gemini analysis failed")
      }
    } else if (geminiApiKey && !geminiSupportedForFile) {
      traceLog("warn", traceId, "gemini_skipped_unsupported_file_type", {
        mimeType,
        extractedTextLength: extractedText.length,
      })
      if (isDocumentLikeMime(mimeType)) {
        throw new Error(
          "Could not read this document content clearly. Please upload a text-based PDF or clear image/photo of the report pages."
        )
      }
      throw new Error("Unsupported file type for Gemini analysis. Please upload image, text, PDF, or DOCX.")
    }

    if (!rawText) {
      throw new Error("AI failed to analyze this report.")
    }

    traceLog("log", traceId, "analysis_text_received", {
      provider,
      model: selectedModel,
      rawTextLength: rawText.length,
    })
    let parsed = parseAnalysis(rawText)
    const initialShallowAnalysis = extractedTextReadable && isAnalysisTooShallow(parsed, extractedText.length)
    const visibleDetailPointCount =
      toArray(parsed.key_points).length + toArray(parsed.parameter_highlights).length
    const initialLongReportUnderCovered =
      extractedTextReadable &&
      extractedText.length >= 16000 &&
      visibleDetailPointCount < 6
    const shouldSkipQualityRetryForSpeed =
      pdfMime &&
      fileSize > 3 * 1024 * 1024 &&
      visibleDetailPointCount >= 8 &&
      String(parsed.summary || "").length >= 260
    const shouldRunQualityRetry =
      ENABLE_ANALYSIS_QUALITY_RETRY &&
      (initialShallowAnalysis || initialLongReportUnderCovered) &&
      !shouldSkipQualityRetryForSpeed
    let qualityRetryUsed = false
    let qualityRetryProvider: "openai" | "gemini" | null = null
    let qualityRetryModel: string | null = null
    let qualityRetryRawTextLength = 0
    let deepPdfRescueUsed = false
    let deepPdfRescueModel: string | null = null
    let deepPdfRescueRawTextLength = 0

    if (shouldRunQualityRetry && extractedTextReadable) {
      const qualityPrompt = [
        "You are CD4 Medical Report AI assistant.",
        "Re-analyze this same report with maximum detail and return strict JSON only.",
        "Do not return generic summary lines.",
        "Must include concrete values, units, reference ranges, and clear clinical meaning.",
        "If values are not visible for a parameter, skip it instead of inventing.",
        "For lab/pathology reports, prioritize parameter-wise extraction with value, unit, range, and plain interpretation.",
        "Also capture visible report identity details (name, age, gender, lab, dates, report id).",
        "JSON shape:",
        "{",
        '  "summary": "8-14 detailed lines",',
        '  "key_points": ["at least 8 highly specific report findings with values/ranges where available"],',
        '  "report_type": "lab_report|imaging|prescription|discharge_summary|other",',
        '  "report_identity": {',
        '    "patient_name": "if visible else empty",',
        '    "age": "if visible else empty",',
        '    "gender": "if visible else empty",',
        '    "lab_name": "if visible else empty",',
        '    "report_date": "if visible else empty",',
        '    "sample_collected_at": "if visible else empty",',
        '    "report_id": "if visible else empty",',
        '    "referred_by": "if visible else empty"',
        "  },",
        '  "parameter_highlights": ["test/value/unit/reference/status in one line"],',
        '  "abnormal_findings": ["only clearly visible abnormal findings"],',
        '  "normal_findings": ["important normal findings worth reassurance"],',
        '  "missing_sections": ["sections or values not clearly visible"],',
        '  "confidence_note": "1 line on completeness/clarity",',
        '  "caution_flags": ["important watchouts, if any"],',
        '  "suggested_followups": ["practical follow-up actions"],',
        '  "medications": ["only medicines clearly visible in uploaded prescription"],',
        '  "prescription_details": {',
        '    "doctor_name": "if visible else empty",',
        '    "diagnosis": "if visible else empty",',
        '    "prescribed_on": "if visible else empty",',
        '    "followup_date": "if visible else empty",',
        '    "patient_name": "if visible else empty",',
        '    "relation_tag": "S/O D/O W/O or guardian info if visible",',
        '    "age": "if visible else empty",',
        '    "sex": "if visible else empty",',
        '    "occupation": "if visible else empty",',
        '    "insurance_no": "if visible else empty",',
        '    "health_provider": "if visible else empty",',
        '    "health_card_no": "if visible else empty",',
        '    "patient_id_no": "if visible else empty",',
        '    "address": "if visible else empty",',
        '    "cell_no": "if visible else empty",',
        '    "blood_pressure": "if visible else empty",',
        '    "pulse_rate": "if visible else empty",',
        '    "weight": "if visible else empty",',
        '    "allergies": "if visible else empty",',
        '    "disabilities": "if visible else empty",',
        '    "diet_to_follow": "if visible else empty",',
        '    "brief_history": "if visible else empty",',
        '    "followup_physician": "if visible else empty",',
        '    "general_instructions": ["doctor instructions if visible"],',
        '    "red_flags": ["urgent warning signs if visible"],',
        '    "medications": [',
        '      {',
        '        "name": "medicine name",',
        '        "dosage": "dose if visible",',
        '        "frequency": "frequency if visible",',
        '        "timing": "timing if visible",',
        '        "duration": "duration if visible",',
        '        "purpose": "purpose if inferable",',
        '        "instructions": "extra notes if visible"',
        "      }",
        "    ]",
        "  },",
        '  "what_to_avoid": ["avoid list based on findings"],',
        '  "next_24h_actions": ["prioritized next 24 hour actions"],',
        '  "recovery_timeline": "estimated timeline if inferable",',
        '  "patient_friendly_explanation": "deep multi-paragraph explanation in simple language"',
        "}",
      ].join("\n")
      const qualityUserText = `${qualityPrompt}\n\nDocument text content (best effort extraction):\n${extractedText}`
      traceLog("warn", traceId, "analysis_quality_retry_started", {
        initialSummaryLength: (parsed.summary || "").length,
        initialKeyPoints: Array.isArray(parsed.key_points) ? parsed.key_points.length : 0,
        extractedTextLength: extractedText.length,
        initialLongReportUnderCovered,
      })

      let retryRawText = ""

      if (openAiApiKey) {
        try {
          const retryStartedAt = Date.now()
          const retryGeneration = await invokeOpenAIWithRetry({
            apiKey: openAiApiKey,
            messages: [
              { role: "system", content: openAiSystemPrompt },
              { role: "user", content: qualityUserText },
            ],
            requireVision: false,
            traceId,
          })
          aiMs += Date.now() - retryStartedAt
          retryRawText = retryGeneration.rawText
          qualityRetryProvider = "openai"
          qualityRetryModel = retryGeneration.model
        } catch (retryError: any) {
          traceLog("warn", traceId, "analysis_quality_retry_openai_failed", {
            error: clipText(retryError?.message || "quality_retry_openai_failed", 220),
          })
        }
      }

      if (!retryRawText && !FORCE_OPENAI_ONLY && geminiApiKey) {
        try {
          const retryStartedAt = Date.now()
          const retryGeneration = await invokeGeminiWithRetry({
            apiKey: geminiApiKey,
            body: {
              systemInstruction: {
                parts: [
                  {
                    text: [
                      "You are CD4 Medical Report AI assistant.",
                      "Return strict JSON only with the requested shape.",
                      "Do not wrap output in markdown fences.",
                    ].join(" "),
                  },
                ],
              },
              generationConfig: {
                temperature: 0.2,
                topP: 0.95,
                maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
                responseMimeType: "application/json",
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: qualityUserText }],
                },
              ],
            },
            traceId,
          })
          aiMs += Date.now() - retryStartedAt
          retryRawText = retryGeneration.rawText
          qualityRetryProvider = "gemini"
          qualityRetryModel = retryGeneration.model
        } catch (retryError: any) {
          traceLog("warn", traceId, "analysis_quality_retry_gemini_failed", {
            error: clipText(retryError?.message || "quality_retry_gemini_failed", 220),
          })
        }
      }

      if (retryRawText) {
        const retryParsed = parseAnalysis(retryRawText)
        const retryStillShallow = isAnalysisTooShallow(retryParsed, extractedText.length)
        qualityRetryRawTextLength = retryRawText.length
        if (!retryStillShallow) {
          parsed = retryParsed
          rawText = retryRawText
          qualityRetryUsed = true
          provider = qualityRetryProvider || provider
          selectedModel = qualityRetryModel || selectedModel
        } else {
          traceLog("warn", traceId, "analysis_quality_retry_still_shallow", {
            retrySummaryLength: (retryParsed.summary || "").length,
            retryKeyPoints: Array.isArray(retryParsed.key_points) ? retryParsed.key_points.length : 0,
          })
        }
      }
    }

    const shouldRunHeaderRescue =
      !FORCE_OPENAI_ONLY &&
      pdfMime &&
      canUseInlineBinary &&
      Boolean(geminiApiKey) &&
      isHeaderOnlyLabAnalysis(parsed, extractedText, rawText)

    if (shouldRunHeaderRescue) {
      try {
        if (!base64File) {
          base64File = encodeBase64(fileBuffer)
        }

        const deepRescuePrompt = [
          "You are CD4 Medical Report AI assistant.",
          "The first extraction looked header-only/incomplete.",
          "Re-read every visible page of this document and return strict JSON only.",
          "Focus on lab/result tables and extract as many visible parameters as possible.",
          "For each key finding include parameter name, observed value, unit, and reference range when visible.",
          "Capture visible report identity details (patient name/age/gender/lab/date/report id) exactly as seen.",
          "If a field is not visible, state 'not clearly visible' instead of guessing.",
          "JSON shape:",
          "{",
          '  "summary": "detailed multi-line summary of visible findings",',
          '  "key_points": ["parameter-wise findings with value/unit/range where visible"],',
          '  "report_type": "lab_report|imaging|prescription|discharge_summary|other",',
          '  "report_identity": {',
          '    "patient_name": "if visible else empty",',
          '    "age": "if visible else empty",',
          '    "gender": "if visible else empty",',
          '    "lab_name": "if visible else empty",',
          '    "report_date": "if visible else empty",',
          '    "sample_collected_at": "if visible else empty",',
          '    "report_id": "if visible else empty",',
          '    "referred_by": "if visible else empty"',
          "  },",
          '  "parameter_highlights": ["test/value/unit/reference/status in one line"],',
          '  "abnormal_findings": ["only clearly visible abnormal findings"],',
          '  "normal_findings": ["important normal findings worth reassurance"],',
          '  "missing_sections": ["sections or values not clearly visible"],',
          '  "confidence_note": "1 line on completeness/clarity",',
          '  "caution_flags": ["important watchouts, if any"],',
          '  "suggested_followups": ["practical follow-up actions"],',
          '  "medications": ["only if clearly visible in report"],',
          '  "prescription_details": {',
          '    "doctor_name": "if visible else empty",',
          '    "diagnosis": "if visible else empty",',
          '    "prescribed_on": "if visible else empty",',
          '    "followup_date": "if visible else empty",',
          '    "patient_name": "if visible else empty",',
          '    "relation_tag": "S/O D/O W/O or guardian info if visible",',
          '    "age": "if visible else empty",',
          '    "sex": "if visible else empty",',
          '    "occupation": "if visible else empty",',
          '    "insurance_no": "if visible else empty",',
          '    "health_provider": "if visible else empty",',
          '    "health_card_no": "if visible else empty",',
          '    "patient_id_no": "if visible else empty",',
          '    "address": "if visible else empty",',
          '    "cell_no": "if visible else empty",',
          '    "blood_pressure": "if visible else empty",',
          '    "pulse_rate": "if visible else empty",',
          '    "weight": "if visible else empty",',
          '    "allergies": "if visible else empty",',
          '    "disabilities": "if visible else empty",',
          '    "diet_to_follow": "if visible else empty",',
          '    "brief_history": "if visible else empty",',
          '    "followup_physician": "if visible else empty",',
          '    "general_instructions": ["doctor instructions if visible"],',
          '    "red_flags": ["urgent warning signs if visible"],',
          '    "medications": [',
          '      {',
          '        "name": "medicine name",',
          '        "dosage": "dose if visible",',
          '        "frequency": "frequency if visible",',
          '        "timing": "timing if visible",',
          '        "duration": "duration if visible",',
          '        "purpose": "purpose if inferable",',
          '        "instructions": "extra notes if visible"',
          "      }",
          "    ]",
          "  },",
          '  "what_to_avoid": ["avoid list based on visible findings"],',
          '  "next_24h_actions": ["prioritized next 24 hour actions"],',
          '  "recovery_timeline": "timeline if inferable from visible findings",',
          '  "patient_friendly_explanation": "clear patient-facing explanation based on visible findings"',
          "}",
        ].join("\n")

        const deepRescueBody: Record<string, unknown> = {
          systemInstruction: {
            parts: [
              {
                text: [
                  "You are CD4 Medical Report AI assistant.",
                  "Return strict JSON only with the requested shape.",
                  "Do not wrap output in markdown fences.",
                ].join(" "),
              },
            ],
          },
          generationConfig: {
            temperature: 0.15,
            topP: 0.95,
            maxOutputTokens: DEEP_PDF_RESCUE_MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    `${deepRescuePrompt}\n\n${analysisDocumentHeader}\n\n` +
                    `Partial extracted text hint (if any):\n${clipText(extractedText || "", 20000)}`,
                },
                {
                  inlineData: {
                    mimeType: mimeType || "application/octet-stream",
                    data: base64File,
                  },
                },
              ],
            },
          ],
        }

        const deepStartedAt = Date.now()
        const deepRescueGeneration = await invokeGeminiWithRetry({
          apiKey: geminiApiKey,
          body: deepRescueBody,
          modelCandidates: getGeminiDeepPdfModelCandidates(),
          maxAttempts: DEEP_PDF_RESCUE_MAX_ATTEMPTS,
          timeoutMs: DEEP_PDF_RESCUE_TIMEOUT_MS,
          traceId,
        })
        aiMs += Date.now() - deepStartedAt
        deepPdfRescueRawTextLength = deepRescueGeneration.rawText.length
        deepPdfRescueModel = deepRescueGeneration.model

        const deepParsed = parseAnalysis(deepRescueGeneration.rawText)
        const baseNumericScore = countNumericMentions(
          [String(parsed.summary || ""), ...toArray(parsed.key_points), String(parsed.patient_friendly_explanation || "")]
            .join(" ")
        )
        const deepNumericScore = countNumericMentions(
          [String(deepParsed.summary || ""), ...toArray(deepParsed.key_points), String(deepParsed.patient_friendly_explanation || "")]
            .join(" ")
        )
        const deepStillHeaderOnly = isHeaderOnlyLabAnalysis(deepParsed, extractedText, deepRescueGeneration.rawText)

        if (
          isLikelyMedicalAnalysisResult(deepParsed) &&
          (!deepStillHeaderOnly || deepNumericScore >= baseNumericScore + 4)
        ) {
          parsed = deepParsed
          rawText = deepRescueGeneration.rawText
          provider = "gemini"
          selectedModel = deepRescueGeneration.model
          deepPdfRescueUsed = true
        }
      } catch (deepRescueError: any) {
        traceLog("warn", traceId, "deep_pdf_rescue_failed", {
          error: clipText(deepRescueError?.message || "deep_pdf_rescue_failed", 220),
        })
      }
    }

    const parsedLooksMedical = isLikelyMedicalAnalysisResult(parsed)
    if (!parsedLooksMedical) {
      const likelyReadFailure = isLikelyDocumentReadFailureReply(rawText)
      if (likelyReadFailure && isDocumentLikeMime(mimeType)) {
        throw new Error(
          "Could not read this report clearly from the uploaded file. Please re-upload a clearer/text-based PDF or report images."
        )
      }
      if (pdfMime || isDocumentLikeMime(mimeType) || isImageLikeMime(mimeType)) {
        throw new Error(
          "Could not confidently parse this uploaded report as a readable medical document. Please re-upload a clearer PDF/image and re-analyze."
        )
      }
      throw new Error(
        "Upload must be a medical report (lab, imaging, prescription, or discharge summary). Please upload a medical document or clear report image."
      )
    }
    traceLog("log", traceId, "analysis_parsed", {
      summaryLength: (parsed.summary || "").length,
      keyPoints: Array.isArray(parsed.key_points) ? parsed.key_points.length : 0,
      cautionFlags: Array.isArray(parsed.caution_flags) ? parsed.caution_flags.length : 0,
      followups: Array.isArray(parsed.suggested_followups) ? parsed.suggested_followups.length : 0,
      medications: Array.isArray(parsed.medications) ? parsed.medications.length : 0,
      prescriptionMedicationCount: Array.isArray(parsed.prescription_details?.medications)
        ? parsed.prescription_details.medications.length
        : 0,
      hasPrescriptionDoctor: Boolean(parsed.prescription_details?.doctor_name),
      hasPrescriptionDiagnosis: Boolean(parsed.prescription_details?.diagnosis),
      avoidItems: Array.isArray(parsed.what_to_avoid) ? parsed.what_to_avoid.length : 0,
      next24hActions: Array.isArray(parsed.next_24h_actions) ? parsed.next_24h_actions.length : 0,
      parameterHighlights: Array.isArray(parsed.parameter_highlights) ? parsed.parameter_highlights.length : 0,
      abnormalFindings: Array.isArray(parsed.abnormal_findings) ? parsed.abnormal_findings.length : 0,
      normalFindings: Array.isArray(parsed.normal_findings) ? parsed.normal_findings.length : 0,
      missingSections: Array.isArray(parsed.missing_sections) ? parsed.missing_sections.length : 0,
      reportIdentityFields: Object.keys(normalizeReportIdentity(parsed.report_identity || {})).length,
      recoveryTimelineLength: String(parsed.recovery_timeline || "").length,
      reportType: parsed.report_type || "medical_report",
      parsedLooksMedical,
      initialShallowAnalysis,
      initialLongReportUnderCovered,
      shouldSkipQualityRetryForSpeed,
      shouldRunQualityRetry,
      qualityRetryUsed,
      qualityRetryProvider,
      qualityRetryModel,
      qualityRetryRawTextLength,
      shouldRunHeaderRescue,
      deepPdfRescueUsed,
      deepPdfRescueModel,
      deepPdfRescueRawTextLength,
    })

    const ragSourceText = buildRagSourceText({
      extractedText: extractedText || "",
      summary: parsed.summary || "",
      patientFriendlyExplanation: parsed.patient_friendly_explanation || "",
      keyPoints: Array.isArray(parsed.key_points) ? parsed.key_points : [],
      cautionFlags: Array.isArray(parsed.caution_flags) ? parsed.caution_flags : [],
      followUps: Array.isArray(parsed.suggested_followups) ? parsed.suggested_followups : [],
    })

    const ragStartedAt = Date.now()
    let ragIngestion: {
      enabled: boolean
      skippedReason: string | null
      embeddingModel: string | null
      chunkCount: number
    } = {
      enabled: false,
      skippedReason: "not_started",
      embeddingModel: getRagEmbeddingModelName(),
      chunkCount: 0,
    }
    try {
      ragIngestion = await upsertReportRagChunks({
        serviceClient,
        reportId,
        patientId: user.id,
        openAiApiKey,
        sourceText: ragSourceText,
        reportType: parsed.report_type || "medical_report",
        traceId,
      })
    } catch (ragError: any) {
      ragIngestion = {
        enabled: false,
        skippedReason: clipText(ragError?.message || "rag_ingestion_failed", 120),
        embeddingModel: getRagEmbeddingModelName(),
        chunkCount: 0,
      }
      traceLog("warn", traceId, "rag_ingestion_failed_non_fatal", {
        error: clipText(ragError?.message || "rag_ingestion_failed", 220),
      })
    }
    const ragMs = Date.now() - ragStartedAt

    traceLog("log", traceId, "rag_ingestion_result", {
      enabled: ragIngestion.enabled,
      skippedReason: ragIngestion.skippedReason,
      chunkCount: ragIngestion.chunkCount,
      embeddingModel: ragIngestion.embeddingModel,
      ragMs,
      sourceChars: ragSourceText.length,
    })

    const dbStartedAt = Date.now()
    await Promise.all([
      serviceClient
        .from("medical_reports")
        .update({
          analysis_status: "completed",
          report_type: parsed.report_type || "medical_report",
          ai_summary: parsed.summary,
          ai_key_points: parsed.key_points,
          ai_structured: {
            caution_flags: parsed.caution_flags,
            suggested_followups: parsed.suggested_followups,
            medications: parsed.medications,
            prescription_details: parsed.prescription_details,
            what_to_avoid: parsed.what_to_avoid,
            next_24h_actions: parsed.next_24h_actions,
            recovery_timeline: parsed.recovery_timeline,
            report_identity: parsed.report_identity,
            parameter_highlights: parsed.parameter_highlights,
            abnormal_findings: parsed.abnormal_findings,
            normal_findings: parsed.normal_findings,
            missing_sections: parsed.missing_sections,
            confidence_note: parsed.confidence_note,
            patient_friendly_explanation: parsed.patient_friendly_explanation,
            provider,
            model: selectedModel,
            insights_generated_at: new Date().toISOString(),
            rag: {
              enabled: ragIngestion.enabled,
              skipped_reason: ragIngestion.skippedReason,
              chunk_count: ragIngestion.chunkCount,
              embedding_model: ragIngestion.embeddingModel,
              rag_ms: ragMs,
            },
            raw_model_text: clipText(rawText, 12000),
          },
          extracted_text: extractedText || null,
          analyzed_at: new Date().toISOString(),
          analysis_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reportId)
        .eq("patient_id", user.id),
      serviceClient
        .from("medical_report_chat_messages")
        .insert({
          report_id: reportId,
          patient_id: user.id,
          role: "assistant",
          content: buildInitialAssistantMessage(parsed),
        }),
      serviceClient.from("ai_agent_actions").insert({
        user_id: user.id,
        conversation_id: reportId,
        action: "analyze_medical_report",
        status: provider === "fallback" ? "fallback" : "success",
        payload: {
          model: selectedModel,
          provider,
          extractionMs,
          aiOcrUsed,
          aiOcrModel,
          aiOcrTextLength,
          aiOcrError,
          aiMs,
          initialShallowAnalysis,
          initialLongReportUnderCovered,
          shouldRunQualityRetry,
          qualityRetryUsed,
          qualityRetryProvider,
          qualityRetryModel,
          ragMs,
          ragIngestion,
        },
      }),
    ])
    const dbMs = Date.now() - dbStartedAt

    let riskAlertNotification: {
      sent: boolean
      reason: string
      severity: "high" | "moderate" | null
      signalCount: number
    } = {
      sent: false,
      reason: "not_evaluated",
      severity: null,
      signalCount: 0,
    }

    try {
      riskAlertNotification = await sendCriticalReportAlertIfNeeded({
        serviceClient,
        userId: user.id,
        reportId,
        fileName: String(reportRow?.file_name || ""),
        analysis: {
          summary: parsed.summary,
          patient_friendly_explanation: parsed.patient_friendly_explanation,
          key_points: parsed.key_points,
          caution_flags: parsed.caution_flags,
          suggested_followups: parsed.suggested_followups,
          next_24h_actions: parsed.next_24h_actions,
          abnormal_findings: parsed.abnormal_findings,
        },
        traceId,
      })
    } catch (riskAlertError: any) {
      riskAlertNotification = {
        sent: false,
        reason: "notification_exception",
        severity: null,
        signalCount: 0,
      }
      traceLog("warn", traceId, "report_alert_notification_failed_non_fatal", {
        error: clipText(riskAlertError?.message || "report_alert_notification_failed", 220),
      })
    }

    traceLog("log", traceId, "db_updates_completed", {
      provider,
      model: selectedModel,
      extractionMs,
      aiOcrUsed,
      aiOcrModel,
      aiOcrTextLength,
      aiOcrError,
      aiMs,
      ragMs,
      dbMs,
      riskAlertNotification,
      processingMs: Date.now() - requestStartedAt,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: "Report analyzed successfully.",
        data: {
          reportId,
          summary: parsed.summary,
          keyPoints: parsed.key_points,
          reportType: parsed.report_type,
          cautionFlags: parsed.caution_flags,
          followUps: parsed.suggested_followups,
          prescriptionDetails: parsed.prescription_details,
          reportIdentity: parsed.report_identity,
          parameterHighlights: parsed.parameter_highlights,
          abnormalFindings: parsed.abnormal_findings,
          normalFindings: parsed.normal_findings,
          missingSections: parsed.missing_sections,
          confidenceNote: parsed.confidence_note,
          patientExplanation: parsed.patient_friendly_explanation,
          provider,
          model: selectedModel,
          timings: {
            extractionMs,
            aiOcrUsed,
            aiOcrModel,
            aiOcrTextLength,
            aiMs,
            ragMs,
            dbMs,
            processingMs: Date.now() - requestStartedAt,
          },
          rag: {
            enabled: ragIngestion.enabled,
            skippedReason: ragIngestion.skippedReason,
            chunkCount: ragIngestion.chunkCount,
            embeddingModel: ragIngestion.embeddingModel,
          },
          riskAlertNotification,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (error) {
    const normalizedError = normalizeProviderError(error?.message || "Failed to analyze report.")
    traceLog("error", traceId, "analyze_failed", {
      reportId: maskId(currentReportId),
      userId: maskId(currentUserId),
      error: clipText(normalizedError, 300),
      processingMs: Date.now() - requestStartedAt,
    })

    if (serviceClient && currentReportId && currentUserId) {
      try {
        await serviceClient
          .from("medical_reports")
          .update({
            analysis_status: "failed",
            analysis_error: clipText(normalizedError || "analysis_failed", 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", currentReportId)
          .eq("patient_id", currentUserId)
        traceLog("log", traceId, "failure_state_persisted", {
          reportId: maskId(currentReportId),
        })
      } catch (updateError) {
        traceLog("error", traceId, "failure_state_persist_error", {
          reportId: maskId(currentReportId),
          error: clipText(updateError?.message || "persist_failed", 220),
        })
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        message: normalizedError || "Failed to analyze report.",
        traceId,
      }),
      {
        status: normalizedError.toLowerCase().includes("temporarily busy") ? 429 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
