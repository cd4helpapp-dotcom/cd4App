// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"
import {
  DepartmentConfig,
  DEPARTMENT_CATALOG,
  DOCTOR_SEARCH_INTENT_TERMS,
  GENERIC_SEARCH_FOLLOWUP_TERMS,
  BOOKING_PREPARE_INTENT_TERMS,
  BOOKING_CONFIRMATION_TERMS,
  BOOKING_DECLINE_TERMS,
  AutonomousToolStep,
  DoctorSearchMeta,
  BookingPreparation,
  BookingSlotOption,
  PendingBookingProposal,
  BookingPreparationResult,
  BookingConfirmationResult,
  EscalationPlan,
  ClinicalProfileSnapshot,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_FALLBACK_MODEL,
  GEMINI_TIMEOUT_MS,
  GEMINI_MAX_ATTEMPTS,
  GEMINI_MAX_OUTPUT_TOKENS,
  AI_MESSAGE_LIMIT_PER_WINDOW,
  AI_RATE_LIMIT_TZ_OFFSET_MINUTES,
  AI_FIRST_BLOCK_MS,
  AI_SECOND_BLOCK_MS,
  AI_BURST_LIMIT_MESSAGES,
  AI_BURST_WINDOW_MS,
  parseEnvInt,
  normalize,
  hasAnyTerm,
  clipText,
  normalizeCityInput,
  hasSymptomSignal,
  hasPersonalHealthContext,
  isAssistantConcern,
  escapePostgrestLike,
  isUuid,
  sleep,
  looksDevanagari,
  parseIsoToMs,
  formatBookingSlotLabel,
  getMissingTriageQuestions,
  getConcernTriageProfile,
  getConcernSpecificTriageGuidance,
  buildTriageQuestionBlueprint,
  hasSmartBookingConfirmationSignal,
  hasSmartSlotReferenceSignal
} from "./shared.ts"

// App-only policy: doctor recommendations must stay inside the verified CD4 database.

const PRO_AI_MESSAGE_LIMIT_PER_WINDOW = (() => {
  const recommendedProFloor = Math.max(60, AI_MESSAGE_LIMIT_PER_WINDOW * 3)
  const configured = parseEnvInt('CHAT_AI_PRO_MESSAGE_LIMIT_PER_WINDOW', recommendedProFloor)
  const normalized = Math.min(3000, configured)
  // Never allow Pro quota to collapse to free-tier quota due env misconfiguration.
  return Math.max(AI_MESSAGE_LIMIT_PER_WINDOW + 1, normalized)
})()

const PRO_AI_BURST_LIMIT_MESSAGES = (() => {
  const recommendedProBurstFloor = Math.max(12, AI_BURST_LIMIT_MESSAGES * 2)
  const configured = parseEnvInt('CHAT_AI_PRO_BURST_LIMIT_MESSAGES', recommendedProBurstFloor)
  const normalized = Math.min(200, configured)
  return Math.max(AI_BURST_LIMIT_MESSAGES + 1, normalized)
})()

const BOOKING_COOLDOWN_DAYS = 30
const BOOKING_COOLDOWN_WINDOW_MS = BOOKING_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
const BOOKING_COOLDOWN_STATUSES = ['pending', 'confirmed', 'completed']

const CITY_EXTRACTION_STOP_WORDS = new Set([
  'doctor', 'doc', 'dr', 'doctors', 'hospital', 'clinic', 'specialist',
  'find', 'search', 'show', 'book', 'appointment', 'slot', 'consult',
  'karo', 'kardo', 'kijiye', 'dijiye', 'batao', 'dikhao', 'chahiye',
  'milao', 'dhundo', 'dhundho', 'dhoondho',
  'mujhe', 'mere', 'mera', 'meri', 'hamara', 'humara',
  'ek', 'koi', 'accha', 'achha', 'acha', 'best', 'top', 'good', 'nearest',
  'please', 'want', 'need', 'looking', 'help', 'suggest', 'recommend',
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'from',
  'pain', 'fever', 'cold', 'cough', 'headache', 'stomach', 'heart',
  'skin', 'eye', 'ear', 'nose', 'throat', 'chest', 'back', 'knee',
  'general', 'cardiology', 'dermatology', 'orthopedic', 'pediatric',
  'gynecology', 'psychiatry', 'neurology', 'gastro', 'ent',
  'today', 'tomorrow', 'morning', 'evening', 'night', 'now', 'urgent',
  'aaj', 'kal', 'subah', 'shaam', 'raat', 'abhi',
])

const DEPARTMENT_EXACT_SEARCH_TERMS: Record<string, string[]> = {
  kayachikitsa: ['General Medicine', 'General Physician', 'Internal Medicine', 'Family Medicine'],
  cardiology: ['Cardiology', 'Cardiologist', 'Cardiac', 'Heart Specialist'],
  endocrinology: ['Endocrinology', 'Endocrinologist', 'Diabetology', 'Diabetologist', 'Diabetes Specialist', 'Hormone Specialist'],
  pediatrics: ['Pediatrics', 'Paediatrics', 'Pediatrician', 'Paediatrician', 'Child Specialist'],
  orthopedic: ['Orthopedic', 'Orthopaedic', 'Orthopedist', 'Orthopaedist', 'Bone Specialist', 'Spine Specialist'],
  dermatology: ['Dermatology', 'Dermatologist', 'Derma', 'Skin Specialist'],
  gynecology: ['Gynecology', 'Gynecologist', 'Gynaecology', 'Gynaecologist', 'Obstetrics', 'Women Health Specialist'],
  psychiatry: ['Psychiatry', 'Psychiatrist', 'Mental Health Specialist'],
  pulmonology: ['Pulmonology', 'Pulmonologist', 'Chest Specialist', 'Respiratory Specialist'],
  gastroenterology: ['Gastroenterology', 'Gastroenterologist', 'Gastro Specialist', 'Liver Specialist'],
  nephrology: ['Nephrology', 'Nephrologist', 'Kidney Specialist', 'Renal Specialist'],
  ent: ['ENT', 'Otolaryngology', 'Ear Nose Throat Specialist'],
  urology: ['Urology', 'Urologist', 'Urinary Specialist'],
}

const RELATED_DEPARTMENT_IDS: Record<string, string[]> = {
  kayachikitsa: ['cardiology', 'endocrinology', 'dermatology', 'gastroenterology', 'pulmonology', 'ent'],
  cardiology: ['kayachikitsa', 'endocrinology'],
  endocrinology: ['kayachikitsa', 'gynecology', 'nephrology'],
  pediatrics: ['kayachikitsa', 'ent'],
  orthopedic: ['kayachikitsa'],
  dermatology: ['kayachikitsa', 'ent'],
  gynecology: ['kayachikitsa', 'endocrinology'],
  psychiatry: ['kayachikitsa'],
  pulmonology: ['kayachikitsa', 'ent'],
  gastroenterology: ['kayachikitsa', 'endocrinology'],
  nephrology: ['urology', 'kayachikitsa', 'endocrinology'],
  ent: ['pulmonology', 'kayachikitsa'],
  urology: ['nephrology', 'kayachikitsa'],
}

const GENERIC_RELATED_TERMS = ['General Medicine', 'General Physician', 'Internal Medicine', 'Family Medicine']

const EXPLICIT_DEPARTMENT_ALIASES: Record<string, string[]> = {
  kayachikitsa: [
    'general physician',
    'general doctor',
    'general medicine',
    'family physician',
    'family doctor',
    'internal medicine doctor',
    'internal medicine',
    'gp doctor',
    'medicine specialist',
  ],
  cardiology: ['cardiologist', 'cardiac doctor', 'heart specialist', 'heart doctor'],
  endocrinology: [
    'endocrinologist',
    'endocrine specialist',
    'diabetes specialist',
    'diabetes doctor',
    'diabetologist',
    'sugar specialist',
    'sugar doctor',
    'thyroid specialist',
    'thyroid doctor',
  ],
  pediatrics: ['pediatrician', 'paediatrician', 'child specialist', 'child doctor', 'kids doctor'],
  orthopedic: ['orthopedic doctor', 'orthopaedic doctor', 'orthopedist', 'bone specialist', 'spine specialist'],
  dermatology: ['dermatologist', 'derma doctor', 'skin specialist', 'skin doctor'],
  gynecology: ['gynecologist', 'gynaecologist', 'women specialist', 'obstetrician', 'obgyn'],
  psychiatry: ['psychiatrist', 'mental health doctor', 'mental specialist'],
  pulmonology: ['pulmonologist', 'chest specialist', 'lung specialist', 'respiratory specialist'],
  gastroenterology: ['gastroenterologist', 'gastro specialist', 'stomach specialist', 'liver specialist'],
  nephrology: ['nephrologist', 'kidney specialist', 'renal specialist'],
  ent: ['ent specialist', 'ear nose throat specialist', 'otolaryngologist', 'ent doctor'],
  urology: ['urologist', 'urinary specialist', 'prostate specialist'],
}

const resolveExplicitDepartmentFromMessage = (latestMessageText: string): DepartmentConfig | null => {
  const messageNeedle = normalize(latestMessageText || '')
  if (!messageNeedle) return null

  let bestMatch: { department: DepartmentConfig; score: number } | null = null

  for (const [departmentId, aliases] of Object.entries(EXPLICIT_DEPARTMENT_ALIASES)) {
    const department = DEPARTMENT_CATALOG.find((item) => item.id === departmentId)
    if (!department) continue

    for (const alias of aliases) {
      const normalizedAlias = normalize(alias)
      if (!normalizedAlias || normalizedAlias.length < 5) continue
      if (!messageNeedle.includes(normalizedAlias)) continue

      const tokenScore = normalizedAlias.split(' ').length * 10
      const score = tokenScore + normalizedAlias.length
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { department, score }
      }
    }
  }

  // Handle user typos like "general physical/physicial/physiciian doctor".
  if (!bestMatch && /(general)\s+(physi\w*|physic\w*)/.test(messageNeedle)) {
    const fallbackDepartment = DEPARTMENT_CATALOG.find((item) => item.id === 'kayachikitsa') || null
    if (fallbackDepartment) return fallbackDepartment
  }

  return bestMatch?.department || null
}

const resolveDepartmentFromSuggestion = (departmentSuggestion: any, latestMessageText: string): DepartmentConfig | null => {
  const explicitFromMessage = resolveExplicitDepartmentFromMessage(latestMessageText)
  if (explicitFromMessage) return explicitFromMessage

  const suggestionId = normalize(departmentSuggestion?.id || '')
  if (suggestionId) {
    const byId = DEPARTMENT_CATALOG.find((department) => normalize(department.id) === suggestionId)
    if (byId) return byId
  }

  const suggestionLabel = normalize(departmentSuggestion?.label || '')
  if (suggestionLabel) {
    const byLabel = DEPARTMENT_CATALOG.find((department) =>
      normalize(department.label) === suggestionLabel ||
      normalize(department.label).includes(suggestionLabel) ||
      suggestionLabel.includes(normalize(department.label))
    )
    if (byLabel) return byLabel
  }

  const messageNeedle = normalize(latestMessageText || '')
  if (!messageNeedle) return null
  return DEPARTMENT_CATALOG.find((department) =>
    department.keywords.some((keyword) => messageNeedle.includes(normalize(keyword)))
  ) || null
}

const collectDepartmentTerms = (departmentId: string | null, fallbackLabel: string | null): string[] => {
  const terms = new Set<string>()
  const safeLabel = (fallbackLabel || '').trim()
  if (safeLabel) terms.add(safeLabel)

  if (departmentId) {
    const mappedTerms = DEPARTMENT_EXACT_SEARCH_TERMS[departmentId] || []
    for (const term of mappedTerms) {
      if (term && term.trim()) terms.add(term.trim())
    }
  }

  return Array.from(terms)
}

const buildSpecializationOrFilter = (terms: string[]): string => {
  const clauses = terms
    .map((term) => (term || '').trim())
    .filter((term) => term.length > 1)
    .slice(0, 10)
    .map((term) => `specialization.ilike.%${escapePostgrestLike(term)}%`)
  return clauses.join(',')
}

export const createServiceRoleClient = () => {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim()
  const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

export const getAuthenticatedUser = async (req: Request) => {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
  if (!authHeader) return { userId: null, profile: null, error: 'No authorization header' }
  const token = authHeader.replace('Bearer ', '')
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim()
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim()
  const client = createClient(supabaseUrl, anonKey)
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return { userId: null, profile: null, error: error?.message || 'Invalid user' }

  // Fetch profile for automated booking details
  const { data: profile } = await client
    .from('profiles')
    .select('first_name, last_name, phone_number')
    .eq('id', user.id)
    .maybeSingle();

  const meta = (user.user_metadata || {}) as Record<string, unknown>
  const fallbackPhone =
    (typeof user.phone === 'string' ? user.phone : '') ||
    (typeof meta.phone_number === 'string' ? meta.phone_number : '') ||
    (typeof meta.phoneNumber === 'string' ? meta.phoneNumber : '') ||
    (typeof meta.mobile === 'string' ? meta.mobile : '')

  return {
    userId: user.id,
    profile: {
      firstName: profile?.first_name || '',
      lastName: profile?.last_name || '',
      phone: profile?.phone_number || fallbackPhone || '',
      fullName: `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim()
    },
    error: null
  }
}

export const extractEntitiesWithAI = async (args: {
  text: string
  apiKey: string
  serviceClient: any
  history?: any[]
  fastMode?: boolean
}) => {
  if (!args.apiKey) {
    return {
      city: null,
      specialty: null,
      intent: null,
      urgency: 'routine',
      scope: null,
      scope_reason: null,
      scope_model: null,
    }
  }
  try {
    const historyText = (args.history || [])
      .slice(args.fastMode ? -2 : -3)
      .map(h => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`)
      .join('\n');

    const prompt = args.fastMode
      ? `Classify medical assistant intent from user text. Interpret meaning semantically, not by exact keywords only.

    Context:
    ${historyText || 'No prior context.'}

    User: "${args.text}"

    Intents:
    - "search": User wants doctor discovery/options.
    - "book": User is asking to book/schedule/reserve.
    - "confirm": User confirms slot/booking (examples: "yes do it", "this slot", "go ahead", "book this one", "haan kar do").
    - "triage": Symptoms/medical guidance.
    - "casual": Greeting/non-medical.

    Scope:
    - "medical": health, symptoms, reports, medicines, wellness, doctor search, appointment booking, slot follow-up, teleconsultation-related help.
    - "greeting": simple hello/hi/thanks without any real non-medical question.
    - "non_medical": geography, politics, coding, entertainment, finance, shopping, trivia, or unrelated chat.

    Natural-language search examples that MUST be "search":
    - "doctors in patna"
    - "patna me kaun doctor hai"
    - "who should i consult for this in delhi"
    - "mujhe iske liye kaunsa specialist chahiye"

    IMPORTANT:
    - Short follow-ups like "book it", "first slot", "yes continue", or "show more options" should be treated as "medical" only if they clearly refer to prior healthcare context.
    - If the user suddenly asks something unrelated like geography or politics, mark scope as "non_medical" even if previous messages were medical.

    Return valid JSON only:
    {"city": "CityName"|null, "specialty": "Specialty"|null, "intent": "search"|"book"|"confirm"|"triage"|"casual", "urgency": "urgent"|"routine", "scope": "medical"|"greeting"|"non_medical", "scope_reason": "short_reason"}`
      : `Classify user intent and extract medical entities from the user's message. Interpret meaning semantically, not by exact keywords only.

    Context (Last 3 messages):
    ${historyText || 'No prior context.'}

    User Message: "${args.text}"

    Intents:
    - "search": Finding doctors/specialists.
    - "book": Starting/asking about booking/slots.
    - "confirm": Explicitly confirming a slot/booking OR providing details (name/phone) requested by the assistant for a booking.
    - "triage": Discussing symptoms/medical advice.
    - "casual": Greetings/unrelated chat.

    Scope:
    - "medical": health, symptoms, reports, medicines, wellness, doctor search, appointment booking, slot follow-up, teleconsultation-related help.
    - "greeting": simple hello/hi/thanks without any actual non-medical request.
    - "non_medical": geography, politics, coding, entertainment, finance, shopping, general trivia, or unrelated chat.

    Natural-language search examples that MUST be "search":
    - "doctors in patna"
    - "patna me kaun doctor hai"
    - "who should i consult for this in delhi"
    - "mujhe iske liye kaunsa specialist chahiye"
    
    CRITICAL: If the User is providing their name or phone number in response to an Assistant's question about booking details, classify as "confirm".
    CRITICAL: If the user suddenly switches to a non-health topic, classify scope as "non_medical" even if the conversation earlier was about symptoms or doctors.

    Respond with valid JSON only:
    {"city": "CityName"|null, "specialty": "Specialty"|null, "intent": "search"|"book"|"confirm"|"triage"|"casual", "urgency": "urgent"|"routine", "scope": "medical"|"greeting"|"non_medical", "scope_reason": "short_reason"}
    Do not include any other text.
    NOTE: Be very smart about typos. Even if the user types "sinoatna" or "inpatna", extract "Patna".`

    const result = await invokeOpenAIWithRetry({
      apiKey: args.apiKey,
      messages: [{ role: 'system', content: 'You are a precise medical intent classifier.' }, { role: 'user', content: prompt }],
      messageText: args.text,
      maxTokens: args.fastMode ? 120 : 220,
      temperature: 0.1,
    })

    const cleaned = result?.reply?.replace(/```json|```/g, '').trim() || '{}'
    const parsed = JSON.parse(cleaned)
    return {
      city: typeof parsed?.city === 'string' ? parsed.city : null,
      specialty: typeof parsed?.specialty === 'string' ? parsed.specialty : null,
      intent: typeof parsed?.intent === 'string' ? parsed.intent : null,
      urgency: typeof parsed?.urgency === 'string' ? parsed.urgency : 'routine',
      scope: typeof parsed?.scope === 'string' ? parsed.scope : null,
      scope_reason: typeof parsed?.scope_reason === 'string' ? parsed.scope_reason : null,
      scope_model: result?.selectedModel || null,
    }
  } catch (e) {
    console.error("OpenAI Entity Extraction failed", e)
    return {
      city: null,
      specialty: null,
      intent: null,
      urgency: 'routine',
      scope: null,
      scope_reason: null,
      scope_model: null,
    }
  }
}

const ACTIVE_PRO_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'grace'])

const hasActiveProSubscriptionWindow = (row: any, nowMs: number): boolean => {
  if (!row || typeof row !== 'object') return false
  const status = normalize(String(row?.status || ''))
  if (!ACTIVE_PRO_SUBSCRIPTION_STATUSES.has(status)) return false
  const expiresMs = parseIsoToMs(row?.expires_at)
  return expiresMs === null || expiresMs > nowMs
}

const resolveUserAiPlanTier = async (args: {
  serviceClient: any
  userId: string
  nowMs: number
}) => {
  if (!args.serviceClient || !args.userId) {
    return { plan: 'free', isPro: false, subscriptionId: null, billingCycle: null, paymentId: null }
  }

  try {
    const { data, error } = await args.serviceClient
      .from('user_subscriptions')
      .select('id, status, expires_at, billing_cycle, payment_id')
      .eq('user_id', args.userId)
      .eq('plan_code', 'pro')
      .in('status', ['active', 'trialing', 'grace'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data || !hasActiveProSubscriptionWindow(data, args.nowMs)) {
      return { plan: 'free', isPro: false, subscriptionId: null, billingCycle: null, paymentId: null }
    }

    return {
      plan: 'pro',
      isPro: true,
      subscriptionId: data.id || null,
      billingCycle: data.billing_cycle || null,
      paymentId: data.payment_id || null,
    }
  } catch (tierError) {
    console.warn('[chat-ai] plan tier lookup failed, defaulting to free:', tierError)
    return { plan: 'free', isPro: false, subscriptionId: null, billingCycle: null, paymentId: null }
  }
}

export const evaluateAiMessageRateLimit = async (args: { serviceClient: any, userId: string, conversationId: string | null }) => {
  if (!args.serviceClient) {
    return {
      blocked: false,
      blockType: 'none',
      limit: AI_MESSAGE_LIMIT_PER_WINDOW,
      used: 0,
      remaining: AI_MESSAGE_LIMIT_PER_WINDOW,
      retryAfterMs: 0,
      burstLimit: AI_BURST_LIMIT_MESSAGES,
      burstWindowMs: AI_BURST_WINDOW_MS,
      burstUsed: 0,
      dayKey: new Date().toISOString().split('T')[0],
      plan: 'free',
      isPro: false,
      subscriptionId: null,
      billingCycle: null,
      paymentId: null,
      blockLevel: 0,
      blockHours: 0,
      blockUntil: null,
      isDailyLimitReached: false,
      isBurstLimitReached: false,
    }
  }

  const tzOffset = AI_RATE_LIMIT_TZ_OFFSET_MINUTES
  const now = new Date()
  const nowMs = now.getTime()
  const localNow = new Date(now.getTime() + tzOffset * 60 * 1000)
  const dayKey = localNow.toISOString().split('T')[0]
  const dayStartMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
    0,
    0,
    0,
    0
  ) - tzOffset * 60 * 1000
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000
  const tier = await resolveUserAiPlanTier({
    serviceClient: args.serviceClient,
    userId: args.userId,
    nowMs,
  })
  const limit = tier.isPro ? PRO_AI_MESSAGE_LIMIT_PER_WINDOW : AI_MESSAGE_LIMIT_PER_WINDOW
  const burstLimit = tier.isPro ? PRO_AI_BURST_LIMIT_MESSAGES : AI_BURST_LIMIT_MESSAGES

  const { data: usage, error: fetchError } = await args.serviceClient
    .from('ai_usage_stats')
    .select('*')
    .eq('user_id', args.userId)
    .eq('day_key', dayKey)
    .maybeSingle()

  if (fetchError) {
    console.error("Rate limit fetch error:", fetchError)
    return {
      blocked: false,
      blockType: 'none',
      limit,
      used: 0,
      remaining: limit,
      retryAfterMs: 0,
      burstLimit,
      burstWindowMs: AI_BURST_WINDOW_MS,
      burstUsed: 0,
      dayKey,
      plan: tier.plan,
      isPro: tier.isPro,
      subscriptionId: tier.subscriptionId,
      billingCycle: tier.billingCycle,
      paymentId: tier.paymentId,
      blockLevel: 0,
      blockHours: 0,
      blockUntil: null,
    }
  }

  const used = usage?.message_count || 0
  const burstUsed = usage?.burst_count || 0
  const burstWindowStartedAt = usage?.burst_window_started_at || now.toISOString()

  // Apply higher quota for active Pro users while keeping free-tier defaults.
  const isDailyLimitReached = used >= limit
  const isBurstLimitReached = burstUsed >= burstLimit && (nowMs - new Date(burstWindowStartedAt).getTime()) < AI_BURST_WINDOW_MS

  const blocked = isDailyLimitReached || isBurstLimitReached
  const blockType = isBurstLimitReached ? 'burst' : isDailyLimitReached ? 'daily' : 'none'
  const retryAfterMs = isBurstLimitReached
    ? Math.max(1000, AI_BURST_WINDOW_MS - Math.max(0, nowMs - new Date(burstWindowStartedAt).getTime()))
    : isDailyLimitReached
      ? Math.max(1000, dayEndMs - nowMs)
      : 0
  const blockHours = retryAfterMs > 0 ? Math.ceil(retryAfterMs / (60 * 60 * 1000)) : 0
  const blockUntil = retryAfterMs > 0 ? new Date(nowMs + retryAfterMs).toISOString() : null

  // Update the count for the next time (moved to persistence step in index.ts normally, 
  // but here we just return the current state for evaluation)
  // Actually index.ts handles the persistence if the request is NOT blocked.

  return {
    blocked,
    blockType,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    retryAfterMs,
    burstLimit,
    burstWindowMs: AI_BURST_WINDOW_MS,
    burstUsed,
    plan: tier.plan,
    isPro: tier.isPro,
    subscriptionId: tier.subscriptionId,
    billingCycle: tier.billingCycle,
    paymentId: tier.paymentId,
    blockLevel: isDailyLimitReached ? 1 : 0,
    blockHours,
    blockUntil,
    isDailyLimitReached,
    isBurstLimitReached,
    dayKey
  }
}

export const invokeOpenAIWithRetry = async (args: {
  apiKey: string
  messages: any[]
  messageText: string
  maxTokens?: number
  temperature?: number
  preferredModels?: string[]
}) => {
  const models = Array.from(new Set([
    ...(Array.isArray(args.preferredModels) ? args.preferredModels : []),
    DEFAULT_OPENAI_MODEL,
    DEFAULT_OPENAI_FALLBACK_MODEL,
    'gpt-4o-mini',
  ].filter(Boolean)))
  let lastError = null
  const maxTokens = Number.isFinite(Number(args.maxTokens)) ? Math.max(80, Math.min(900, Number(args.maxTokens))) : 800
  const temperature = Number.isFinite(Number(args.temperature)) ? Math.max(0, Math.min(1.2, Number(args.temperature))) : 0.7
  for (const model of models) {
    try {
      const isGpt56 = /^gpt-5\.6(?:-|$)/i.test(model)
      const requestBody = isGpt56
        ? {
            model,
            messages: args.messages,
            reasoning_effort: 'none',
            max_completion_tokens: maxTokens,
          }
        : {
            model,
            messages: args.messages,
            temperature,
            max_tokens: maxTokens,
          }
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${args.apiKey}`
        },
        body: JSON.stringify(requestBody)
      })
      if (res.ok) {
        const data = await res.json()
        console.log(`[AI-Log] Chat Response Success. Model: ${model}, Source: openai`)
        return { reply: data.choices[0].message.content, source: 'openai', selectedModel: model }
      }
      lastError = await res.text()
      console.error(`[AI-Log] OpenAI model failed: ${model}. Error: ${lastError}`)
    } catch (e) {
      lastError = e.message
      console.error(`[AI-Log] OpenAI request threw for model ${model}:`, e)
    }
  }
  throw new Error(`OpenAI failed: ${lastError}`)
}

export const invokeGeminiWithRetry = async (args: { apiKey: string, body: any, messageText: string }) => {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${args.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args.body)
    })
    if (res.ok) {
      const data = await res.json()
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (reply) {
        console.log(`[AI-Log] Chat Response Success. Model: gemini-2.0-flash, Source: gemini`)
        return { reply, source: 'gemini', selectedModel: 'gemini-2.0-flash' }
      }
    }
  } catch (e) {
    console.error("Gemini failed", e)
  }
  return null
}

export const buildSystemPrompt = (args: any) => {
  const isBookingSuccess = args.bookingConfirmation?.status === 'confirmed';
  const isListingSlots = args.bookingPrep?.status === 'ready' && args.bookingPrep?.slotOptions?.length > 0;
  const userIdentity = args.userProfile?.fullName ? `${args.userProfile.fullName}${args.userProfile.phone ? ` (${args.userProfile.phone})` : ''}` : null;
  const latestTriageText = `${args.latestMessageText || ''}`.trim();
  const historyTriageText = `${args.combinedUserText || ''}`.trim();
  const latestTriageProfile = getConcernTriageProfile(latestTriageText);
  const historyTriageProfile = getConcernTriageProfile(historyTriageText);
  const triageQuestionBasis =
    latestTriageProfile.id !== 'general'
      ? latestTriageText
      : historyTriageProfile.id !== 'general'
        ? historyTriageText
        : `${latestTriageText} ${historyTriageText} ${args.concern || ''}`.trim();

  return `You are CD4, a premium Health Assistant. 
Concern: ${args.concern}
Mode: ${args.assistantMode ? 'Professional' : 'Supportive'}
Memory: ${args.memorySummary || 'New conversation'}
User Identity (FOR BOOKING): ${userIdentity || 'Anonymous/Not provided'}
Language Instruction: ${args.languageInstruction}
Tool Context: ${args.toolContext}
Dynamic Triage Guidance: ${getConcernSpecificTriageGuidance(triageQuestionBasis, args.triageCoverage || {})}
Triage Blueprint: ${buildTriageQuestionBlueprint(triageQuestionBasis, args.triageCoverage || {})}
Missing Info: ${getMissingTriageQuestions(args.triageCoverage || {}, triageQuestionBasis).join(', ')}

Guidelines:
1. Be warm, calm, and clinically precise, like a careful junior doctor taking history before senior review.
2. **LANGUAGE MIRRORING (CRITICAL)**: You MUST respond in the SAME language the user is typing in. If user writes in English, respond fully in English. If user writes in Hindi, respond in Hindi. If user writes in Hinglish, respond in Hinglish. NEVER default to any fixed language. Always detect and match the user's language automatically.
3. **CLINICAL INTAKE FORMAT**: While triage is active, return exactly one clinically focused question and nothing else. Do not add acknowledgement, empathy, advice, diagnosis, treatment, warning, recap, heading, bullet, numbered list, emoji, or extra sentence.
4. **HEALTH-ONLY SCOPE**: Only answer health, symptoms, reports, medicines, wellness, doctor discovery, appointments, slots, and teleconsultation-related questions. If the user asks unrelated things like geography, politics, coding, or trivia, politely refuse and redirect them to medical/health help only.
5. **SLOT LISTING**: ${isListingSlots
      ? 'You MUST list each available slot EXACTLY as provided in the label. Do NOT remove the Day/Date part. Example: "- **📅 Monday, 19 Apr [10:00 AM - 10:30 AM]**"'
      : args.bookingPrep?.status === 'no_slots'
        ? 'STRICT: No slots found in DB. Tell user no future slots are available for this specific doctor currently. DO NOT hallucinate times.'
        : 'Focus on the current query.'}
6. **CONFIRMATION**: ${isBookingSuccess ? `Warmly confirm the booking. Use emojis like 🎉. Do NOT offer to book again. **STRICT FORMAT**: In the "Appointment Details" section, you MUST use the exact Date and Time provided in the Slot Info (${args.bookingConfirmation?.slotLabel}). Do NOT use relative terms like "Today", "Tomorrow", or "Kal"; always use the actual date string provided.` : 'Follow standard medical guidance.'}
7. **IDENTITY DETAILS**: We automatically have the user's details: ${userIdentity || 'None'}. Use these details to complete the booking. DO NOT ask the user for their name or phone if we already have them.
8. **DOCTOR LISTS**: Ensure lists are numbered clearly (1, 2, 3) and do NOT cut off descriptions. Use bolding for doctor names.
9. **TIME INTEGRITY**: Always use the exact 12-hour (AM/PM) format provided in slot labels. If a slot says 10:00 PM, do NOT say 10:00 AM.
10. **STRICT NO PLACEHOLDERS**: NEVER use bracketed text like "[Name]", "[Doctor]", or "[Specialty]". If you do not have a piece of information, use a natural fallback like "the specialist" or "the selected time".
11. **APP-ONLY DOCTOR POLICY**: Recommend ONLY doctors provided in Tool Context from the CD4 app database. NEVER invent names and NEVER use web/external doctors. If no doctor is available in Tool Context, explicitly say no verified CD4 doctor is currently available.
12. **DOCTOR TONE**: Be empathetic and natural without sounding casual, robotic, decorative, or alarmist. Acknowledge the specific symptom briefly, then ask the next clinically useful question in the user's language.
13. **DYNAMIC TRIAGE QUESTIONS**: The question must match the user's active concern. Example: cough asks about breathlessness/phlegm/fever; headache asks sudden onset/vision/vomiting/weakness; chest pain asks radiation/sweating/breathlessness; injury/fracture asks about swelling, deformity, bleeding, numbness, and movement. Never reuse a fixed generic question when the concern needs a more specific one.
14. **NO REPETITIVE QUESTIONS (STRICT)**: Never ask for the same information twice. This is especially critical for booking slots, appointment confirmations, and clinical/AI snapshot details. If the user has already selected a slot, or if the clinical details for the triage snapshot (symptoms, duration, severity, medicines) are already present in the history, do NOT re-ask or re-prompt for confirmation. Immediately perform the requested action (such as booking the slot or proceeding to final confirmation).
15. **BOOKING SAFETY**: Never claim booking success unless Booking Confirmation says confirmed. If multiple slots are shown and the user only says "yes" or "go ahead", ask for the exact slot number/time; do not pick the first slot yourself.
16. **TRIAGE COMPLETION**: For any concern, gather the clinically relevant missing domains: onset/progression, severity, associated symptoms and red flags, triggers/pattern, functional impact, and medicine/allergy/relevant history. Ask only one domain per turn and skip anything already answered. Stop when the history is clinically adequate or six distinct domains have been covered, then provide a short objective recap suitable for the AI snapshot or continue to doctor search/booking when requested.
17. **QUESTION-ONLY MODE**: When you are asking a follow-up question, output only the short question itself. Do NOT include "What to do", "Watch for", "Next steps", home-care advice, medication suggestions, summary sections, or any explanatory bullets until the question phase is complete.`
}

const TRIAGE_ADVICE_SECTION_PATTERNS = [
  /^\s*(what to do|watch for|next steps|key details|symptoms check|advice|plan|management)\s*:?\s*$/i,
  /^\s*[-•]\s*(what to do|watch for|next steps|key details|symptoms check|advice|plan|management)\b/i,
]

const TRIAGE_QUESTION_HEADINGS = [
  'next question',
  'next question:',
  'next question?',
  'next question only when needed',
  'next questions',
]

export const stripTriageAdviceSections = (reply: string): string => {
  const text = String(reply || '').replace(/\r\n/g, '\n').trim()
  if (!text) return text

  const lines = text.split('\n')
  const kept: string[] = []
  let sawQuestion = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('')
      continue
    }

    if (TRIAGE_ADVICE_SECTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      break
    }

    if (TRIAGE_QUESTION_HEADINGS.some((heading) => normalize(trimmed).startsWith(normalize(heading)))) {
      kept.push(trimmed)
      sawQuestion = true
      continue
    }

    kept.push(trimmed)
    if (trimmed.includes('?')) {
      sawQuestion = true
    }
  }

  const cleaned = kept.join('\n').trim()
  if (!cleaned) return text

  const questionSentences = cleaned.match(/[^?]{0,220}\?/g)
  if (sawQuestion && questionSentences && questionSentences.length > 0) {
    return questionSentences.slice(0, 2).join(' ').trim()
  }

  return cleaned
}

/**
 * Helper to safely extract and normalize first, last, and full names of a doctor
 */
export const getDoctorNameObj = (doc: any) => {
  const profile = Array.isArray(doc?.profiles) ? doc.profiles[0] : doc?.profiles
  const firstName = doc?.firstName || doc?.first_name || profile?.first_name || ''
  const lastName = doc?.lastName || doc?.last_name || profile?.last_name || ''
  return {
    firstName: normalize(firstName),
    lastName: normalize(lastName),
    fullName: normalize(`${firstName} ${lastName}`.trim())
  }
}

/**
 * Tries to find a doctor ID from a name mentioned in the message text.
 */
export const resolveDoctorIdByText = async (args: { serviceClient: any, text: string, pool?: any[] }) => {
  const normalized = normalize(args.text);
  if (normalized.length < 3) return null;

  const { data, error } = await args.serviceClient
    .from('doctors')
    .select('id, city, specialization, profiles(first_name, last_name)')
    .eq('is_verified', true)
    .limit(100);

  if (error || !data) return null;

  const matches: any[] = [];

  for (const doctor of data) {
    const names = getDoctorNameObj(doctor);
    if (!names.firstName) continue;

    // 1. Check full name match
    if (names.fullName && names.fullName.length >= 4 && normalized.includes(names.fullName)) {
      matches.push(doctor);
      continue;
    }

    // 2. Check first name + last name match (even if not contiguous, e.g. "Amit ... Sharma")
    if (names.firstName.length >= 3 && names.lastName.length >= 3) {
      if (normalized.includes(names.firstName) && normalized.includes(names.lastName)) {
        matches.push(doctor);
        continue;
      }
    }

    // 3. Check first name match only (if it is distinct and not a common stop word)
    const commonWords = new Set([
      'doctor', 'doc', 'dr', 'karo', 'kardo', 'appointment', 'slot', 'book', 'yes', 'haan', 'han', 'ok', 'okay',
      'fever', 'cough', 'pain', 'city', 'delhi', 'patna', 'mumbai', 'hospital', 'clinic', 'care'
    ]);
    if (names.firstName.length >= 3 && !commonWords.has(names.firstName)) {
      const regex = new RegExp(`\\b${names.firstName}\\b`);
      if (regex.test(normalized)) {
        matches.push(doctor);
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].id;

  // If there are multiple matches, prioritize the one in the recommendation pool
  if (Array.isArray(args.pool) && args.pool.length > 0) {
    const poolIds = new Set(args.pool.map(d => d.id || d._id).filter(Boolean));
    const poolMatches = matches.filter(d => poolIds.has(d.id));
    if (poolMatches.length === 1) {
      return poolMatches[0].id;
    }
  }

  return matches[0].id;
}

/**
 * Tries to find a doctor ID from the names in the current recommendation list.
 */
export const identifyDoctorFromResults = (text: string, recommendations: any[]) => {
  const normalized = normalize(text);
  const orderedRecommendations = Array.isArray(recommendations) ? recommendations.filter(Boolean) : []

  if (/\b(first|1st|pehla|pahla)\b/.test(normalized)) {
    return orderedRecommendations[0]?.id || orderedRecommendations[0]?._id || null
  }
  if (/\b(second|2nd|dusra|doosra)\b/.test(normalized)) {
    return orderedRecommendations[1]?.id || orderedRecommendations[1]?._id || null
  }
  if (/\b(third|3rd|teesra|tisra)\b/.test(normalized)) {
    return orderedRecommendations[2]?.id || orderedRecommendations[2]?._id || null
  }
  if (/\b(last|latest|final)\b/.test(normalized)) {
    return orderedRecommendations[orderedRecommendations.length - 1]?.id || orderedRecommendations[orderedRecommendations.length - 1]?._id || null
  }

  for (const doc of recommendations) {
    const names = getDoctorNameObj(doc);
    if (names.fullName && names.fullName.length >= 4 && normalized.includes(names.fullName)) {
      return doc.id || doc._id;
    }
    if (names.firstName && names.firstName.length >= 3 && normalized.includes(names.firstName)) {
      return doc.id || doc._id;
    }
    if (names.lastName && names.lastName.length >= 3 && normalized.includes(names.lastName)) {
      return doc.id || doc._id;
    }
  }
  return null;
}

const parseSlotTimeToMinutes = (value: string): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

const parseMentionedTimeToMinutes = (normalizedText: string): number | null => {
  if (/\b\d{1,2}(st|nd|rd|th)\b/.test(normalizedText)) return null
  const timeMatch = normalizedText.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (!timeMatch) return null
  const rawHour = Number(timeMatch[1])
  const rawMinute = Number(timeMatch[2] || '0')
  const meridian = (timeMatch[3] || '').toLowerCase()
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) return null
  if (rawMinute < 0 || rawMinute > 59) return null

  if (meridian) {
    if (rawHour < 1 || rawHour > 12) return null
    const hour24 = meridian === 'pm' ? (rawHour % 12) + 12 : (rawHour % 12)
    return hour24 * 60 + rawMinute
  }

  if (rawHour < 0 || rawHour > 23) return null
  return rawHour * 60 + rawMinute
}

const resolveSlotByHeuristics = (args: { text: string, slots: any[], historyBookingSlotOptions?: any[] }): string | null => {
  const normalizedText = normalize(args.text || '')
  const slots = Array.isArray(args.slots) ? args.slots : []
  if (!normalizedText || slots.length === 0) return null

  const availableById = new Map(slots.map((slot) => [slot._id, slot]))
  const historicalOrderedSlots = (Array.isArray(args.historyBookingSlotOptions) ? args.historyBookingSlotOptions : [])
    .map((slot: any) => (typeof slot?.id === 'string' ? slot.id : typeof slot?._id === 'string' ? slot._id : ''))
    .map((slotId: string) => availableById.get(slotId))
    .filter(Boolean)
  const pool = historicalOrderedSlots.length > 0 ? historicalOrderedSlots : slots

  const slotNumberMatch = normalizedText.match(/\bslot\s*(?:no\.?\s*)?([1-9])\b/)
  if (slotNumberMatch?.[1]) {
    const slotIndex = Number(slotNumberMatch[1]) - 1
    if (slotIndex >= 0 && slotIndex < pool.length) {
      return pool[slotIndex]?._id || null
    }
    if (slotIndex >= 0 && slotIndex < slots.length) {
      return slots[slotIndex]?._id || null
    }
  }

  if (/\b(earliest|first|1st|pehla|pahla)\b/.test(normalizedText)) return pool[0]?._id || null
  if (/\b(second|2nd|dusra|doosra)\b/.test(normalizedText)) return pool[1]?._id || null
  if (/\b(third|3rd|teesra|tisra)\b/.test(normalizedText)) return pool[2]?._id || null
  if (/\b(last|latest|final)\b/.test(normalizedText)) return pool[pool.length - 1]?._id || null

  // "this slot", "is slot", "ye slot", "same slot" is only safe when there is a single prior choice.
  if (/\b(this|that|is|ye|wahi|isi|same)\b.*\b(slot|time|one)\b/.test(normalizedText)) {
    if (historicalOrderedSlots.length === 1) {
      return historicalOrderedSlots[0]?._id || null
    }
    if (slots.length === 1) {
      return slots[0]?._id || null
    }
    return null
  }

  const nowInIst = new Date(Date.now() + (330 * 60 * 1000))
  const todayKey = nowInIst.toISOString().split('T')[0]
  const tomorrow = new Date(nowInIst.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowKey = tomorrow.toISOString().split('T')[0]

  if (/\b(today|aaj)\b/.test(normalizedText)) {
    const todaySlot = pool.find((slot: any) => slot?.date === todayKey)
    if (todaySlot?._id) return todaySlot._id
  }
  if (/\b(tomorrow|kal)\b/.test(normalizedText)) {
    const tomorrowSlot = pool.find((slot: any) => slot?.date === tomorrowKey)
    if (tomorrowSlot?._id) return tomorrowSlot._id
  }

  const dayPart =
    /\b(morning|subah)\b/.test(normalizedText) ? 'morning'
      : /\b(afternoon|dopahar)\b/.test(normalizedText) ? 'afternoon'
        : /\b(evening|night|shaam|raat)\b/.test(normalizedText) ? 'evening'
          : null

  if (dayPart) {
    const inDayPart = pool.find((slot: any) => {
      const minutes = parseSlotTimeToMinutes(slot?.startTime)
      if (minutes === null) return false
      const hour = Math.floor(minutes / 60)
      if (dayPart === 'morning') return hour >= 5 && hour < 12
      if (dayPart === 'afternoon') return hour >= 12 && hour < 17
      return hour >= 17 || hour < 5
    })
    if (inDayPart?._id) return inDayPart._id
  }

  const mentionedMinutes = parseMentionedTimeToMinutes(normalizedText)
  if (mentionedMinutes !== null) {
    let bestSlotId: string | null = null
    let bestDiff = Number.POSITIVE_INFINITY
    for (const slot of pool) {
      const slotMinutes = parseSlotTimeToMinutes(slot?.startTime)
      if (slotMinutes === null) continue
      const diff = Math.abs(slotMinutes - mentionedMinutes)
      if (diff < bestDiff) {
        bestDiff = diff
        bestSlotId = slot._id
      }
    }
    if (bestSlotId && bestDiff <= 120) return bestSlotId
  }

  if (hasSmartSlotReferenceSignal(normalizedText) && historicalOrderedSlots.length === 1) {
    return historicalOrderedSlots[0]?._id || null
  }

  return null
}

const getSlotOptionSignature = (slotOptions: any[]): string => {
  if (!Array.isArray(slotOptions) || slotOptions.length === 0) return ''
  return slotOptions
    .map((slot: any) => {
      const id = typeof slot?.id === 'string' ? slot.id : typeof slot?._id === 'string' ? slot._id : ''
      const label = typeof slot?.label === 'string' ? slot.label.trim() : ''
      return `${id || label}`
    })
    .filter((value: string) => value.length > 0)
    .join('|')
}

const countRepeatedBookingSlotPrompts = (history: any[], currentSlotOptions: any[]): number => {
  const currentSignature = getSlotOptionSignature(currentSlotOptions)
  if (!currentSignature) return 0

  let repeatedCount = 0
  for (let index = (Array.isArray(history) ? history.length : 0) - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item?.role !== 'assistant') continue

    const itemSignature = getSlotOptionSignature(Array.isArray(item?.bookingSlotOptions) ? item.bookingSlotOptions : [])
    const looksLikeSlotPrompt =
      typeof item?.bookingPrompt === 'string' && item.bookingPrompt.trim().length > 0 &&
      /\b(slot|time|book)\b/i.test(item.bookingPrompt)

    if (!itemSignature || !looksLikeSlotPrompt) continue
    if (itemSignature !== currentSignature) continue

    repeatedCount += 1
    if (repeatedCount >= 2) break
  }

  return repeatedCount
}

const hasStrongBookingExecutionSignal = (normalizedText: string): boolean => {
  if (!normalizedText) return false
  return (
    /\b(book|confirm|schedule|reserve)\b/.test(normalizedText) ||
    /\b(book|confirm|appointment|slot)\s+(kar do|kardo|kr do|krdo|kara do|karwa do|confirm kar do|confirm kardo)\b/.test(normalizedText) ||
    /\b(haan|han|yes|ok|okay)\b.*\b(book|confirm|schedule|reserve)\b/.test(normalizedText)
  )
}

const hasSameDoctorReferenceSignal = (normalizedText: string): boolean =>
  /\b(same doctor|this doctor|that doctor|selected doctor|wahi doctor|isi doctor|is doctor|ye doctor|unhi doctor|doctor hi)\b/.test(
    normalizedText || '',
  )

const getCurrentIstSlotWindow = () => {
  const nowIst = new Date(Date.now() + 330 * 60 * 1000)
  return {
    dateKey: nowIst.toISOString().split('T')[0],
    minutes: nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes(),
  }
}

const isFutureAvailableSlotTime = (
  slot: { date?: string | null, startTime?: string | null, start_time?: string | null },
  leadMinutes = 0,
): boolean => {
  const date = typeof slot?.date === 'string' ? slot.date : ''
  const startTime =
    typeof slot?.startTime === 'string'
      ? slot.startTime
      : typeof slot?.start_time === 'string'
        ? slot.start_time
        : ''
  if (!date || !startTime) return false

  const now = getCurrentIstSlotWindow()
  if (date < now.dateKey) return false
  if (date > now.dateKey) return true

  const startMinutes = parseSlotTimeToMinutes(startTime)
  return startMinutes !== null && startMinutes > now.minutes + Math.max(0, leadMinutes)
}

export const runAutonomousToolLoop = async (args: any) => {
  const steps: AutonomousToolStep[] = []

  let doctorRecommendations = []
  let recommendationMode = null
  let doctorSearchMeta = null
  let bookingPrep = null
  let bookingConfirmation = null
  let resolvedDoctorId: string | null = null

  if (args.hasDoctorSearchIntent) {
    steps.push({
      thought: 'User asked for doctor discovery, running database retrieval by city/specialty.',
      action: 'search_doctors_db',
      input: { city: args.searchAreaCity || null, specialty: args.departmentSuggestion?.label || null },
      observation: 'started',
      status: 'success',
    })

    let search = args.speculativeDoctorsResult;
    if (search) {
      console.log('[AI Speculative Prefetch] Reusing speculative doctor recommendations result in runAutonomousToolLoop');
    } else {
      search = await resolveDoctorRecommendationsWithFallback({
        serviceClient: args.serviceClient,
        departmentSuggestion: args.departmentSuggestion,
        locationCity: args.locationCity,
        searchAreaCity: args.searchAreaCity,
        latestMessageText: args.latestMessageText
      })
    }

    // Hard boundary: only verified doctors returned from the CD4 database may
    // enter the response or booking flow. Reject legacy web-shaped results.
    if (search.recommendationMode === 'web' || search.meta?.source !== 'database') {
      search = {
        ...search,
        doctors: [],
        recommendationMode: 'none',
        meta: {
          ...search.meta,
          source: 'database',
          externalSearchUsed: false,
          externalSearchBlocked: true,
        },
      }
    } else if (search.doctors.length === 0) {
      search = {
        ...search,
        recommendationMode: search.recommendationMode || 'all_app',
        meta: {
          ...search.meta,
          externalSearchUsed: false,
          externalSearchObservation: 'app_only_doctor_search',
        },
      }
    }

    if (Array.isArray(search.doctors) && search.doctors.length > 0) {
      doctorRecommendations = search.doctors
    }
    recommendationMode = search.recommendationMode
    doctorSearchMeta = search.meta
  }

  const missingTriage = getMissingTriageQuestions(args.triageCoverage || {}, args.concernText || args.latestMessageText || '')
  const isTriageComplete = missingTriage.length === 0

  if (args.hasBookingIntent) {
    steps.push({
      thought: 'User is asking to book; resolving doctor + slot from DB.',
      action: 'book_slot_flow',
      input: { message: args.latestMessageText },
      observation: 'started',
      status: 'success',
    })

    // Collect applicant details from pre-filled profile or previous context
    const preFilledName = args.userProfile?.fullName || '';
    const preFilledPhone = args.userProfile?.phone || '';
    const nameInChat = (args.combinedUserText.match(/(?:my name is|mera naam|i am)\s+([a-zA-Z\s]+)/i) || [])[1]?.trim();
    const phoneInChat = (args.combinedUserText.match(/(?:\b\d{10}\b|\b\d{5}\s\d{5}\b)/) || [])[0]?.trim();

    const applicantName = nameInChat || preFilledName;
    const applicantPhone = phoneInChat || preFilledPhone;
    const normalizedLatestMessage = normalize(args.latestMessageText || '')
    const historicalRecommendationPool = Array.isArray(args.doctorRecommendations) ? args.doctorRecommendations : []
    const pendingProposalSlotOptions = Array.isArray(args.pendingBookingProposal?.slotOptions)
      ? args.pendingBookingProposal.slotOptions
      : []
    const pendingProposalDoctorId = typeof args.pendingBookingProposal?.doctorId === 'string'
      ? args.pendingBookingProposal.doctorId
      : ''
    const pendingProposalSelectedSlotId = typeof args.pendingBookingProposal?.selectedSlotId === 'string'
      ? args.pendingBookingProposal.selectedSlotId
      : ''
    const pendingProposalSelectedSlotLabel = typeof args.pendingBookingProposal?.selectedSlotLabel === 'string'
      ? args.pendingBookingProposal.selectedSlotLabel
      : ''
    if (doctorRecommendations.length === 0 && historicalRecommendationPool.length > 0) {
      doctorRecommendations = historicalRecommendationPool.slice(0, 6)
    }
    const recommendationPool = historicalRecommendationPool.length > 0
      ? historicalRecommendationPool
      : doctorRecommendations

    // Resolve which doctor we are booking for
    let targetDoctorId = args.targetDoctorId
    if (!targetDoctorId) {
      // SMART MATCH: Try to find name in current recommendations first
      targetDoctorId = identifyDoctorFromResults(args.latestMessageText, recommendationPool)
    }

    if (!targetDoctorId) {
      // SMART MATCH: Try database lookup by name
      targetDoctorId = await resolveDoctorIdByText({ serviceClient: args.serviceClient, text: args.latestMessageText, pool: recommendationPool })
    }

    const userWantsChange = /\b(change|different|other|another|dusra|doosra|badlo|change doctor|dusra doctor|other doctor)\b/.test(normalizedLatestMessage)

    // Check if user mentioned another name that we failed to resolve (to avoid wrong doctor fallback)
    const mentionsOtherName = () => {
      if (recommendationPool.length === 1) {
        const recNames = getDoctorNameObj(recommendationPool[0])
        const words = normalizedLatestMessage.split(/\s+/)
        const drIndex = words.findIndex(w => w === 'dr' || w === 'doctor')
        if (drIndex !== -1 && drIndex + 1 < words.length) {
          const nextWord = words[drIndex + 1]
          if (nextWord !== recNames.firstName && nextWord !== recNames.lastName) {
            return true
          }
        }
      }
      return false
    }

    if (!targetDoctorId && !userWantsChange && !mentionsOtherName()) {
      if (recommendationPool.length === 1) {
        targetDoctorId = recommendationPool[0].id || recommendationPool[0]._id
      }
    }

    if (!targetDoctorId && !userWantsChange && !mentionsOtherName()) {
      const pendingProposalDoctorId = typeof args.pendingBookingProposal?.doctorId === 'string'
        ? args.pendingBookingProposal.doctorId
        : ''
      if (pendingProposalDoctorId) {
        targetDoctorId = pendingProposalDoctorId
      }
    }

    if (!targetDoctorId && !userWantsChange && hasSameDoctorReferenceSignal(normalizedLatestMessage)) {
      // Try to find in memory
      const memory = await readConversationMemory({ serviceClient: args.serviceClient, conversationId: args.conversationId, userId: args.userId })
      const lastDoctorFact = (memory.keyFacts || []).find((f: any) => f.key === 'last_doctor_recommended')
      if (lastDoctorFact?.value) {
        targetDoctorId = lastDoctorFact.value
      }
    }

    const pendingProposalMatchesTargetDoctor = Boolean(
      pendingProposalDoctorId &&
      targetDoctorId &&
      pendingProposalDoctorId === targetDoctorId
    )

    if (!targetDoctorId) {
      bookingPrep = { status: 'incomplete', message: 'Please tell me which doctor you want to book with.' }
    } else {
      resolvedDoctorId = targetDoctorId
      let selectedDoctor =
        recommendationPool.find((doctor: any) => (doctor?.id || doctor?._id) === targetDoctorId) ||
        doctorRecommendations.find((doctor: any) => (doctor?.id || doctor?._id) === targetDoctorId) ||
        null

      if (!selectedDoctor) {
        const { data, error } = await args.serviceClient
          .from('doctors')
          .select('*, profiles(first_name, last_name, profile_picture)')
          .eq('id', targetDoctorId)
          .eq('is_verified', true)
          .maybeSingle()
        if (!error && data) {
          selectedDoctor = data
        }
      }

      if (selectedDoctor) {
        doctorRecommendations = [selectedDoctor]
      } else {
        doctorRecommendations = []
      }
      // Resolve specific slot or list options
      const slots = await fetchAvailableSlots({ doctorId: targetDoctorId, serviceClient: args.serviceClient })
      const slotHistoryPool = pendingProposalMatchesTargetDoctor && Array.isArray(args.historyBookingSlotOptions) && args.historyBookingSlotOptions.length > 0
        ? args.historyBookingSlotOptions
        : pendingProposalMatchesTargetDoctor
          ? pendingProposalSlotOptions
          : []
      const hasPriorSlotContext = slotHistoryPool.length > 0 || Boolean(pendingProposalSelectedSlotId)
      const hasExplicitFirstSlotSignal = /\b(first|1st|earliest|pehla|pahla|sabse pehla|pehle wala)\b/.test(normalizedLatestMessage)

      if (slots.length === 0) {
        bookingPrep = { status: 'no_slots' }
      } else {
        // Resolve slot from explicit mention first, then from confirmation context.
        let mentionedSlotId = await extractSlotIdFromText(
          args.latestMessageText,
          slots,
          args.openAiApiKey,
          slotHistoryPool
        )
        const confirmationLike = Boolean(
          args.isConfirmation ||
          hasAnyTerm(normalizedLatestMessage, BOOKING_CONFIRMATION_TERMS) ||
          hasSmartBookingConfirmationSignal(normalizedLatestMessage)
        )

        if (!mentionedSlotId && confirmationLike && Array.isArray(slotHistoryPool)) {
          const priorSlotIdsOrdered = slotHistoryPool
            .map((slot: any) => (typeof slot?.id === 'string' ? slot.id : typeof slot?._id === 'string' ? slot._id : ''))
            .filter((id: string) => id.length > 0)

          if (priorSlotIdsOrdered.length > 0) {
            const currentSlotById = new Map<string, any>(
              slots.map((slot: any) => [slot._id, slot])
            )
            const orderedMatches = priorSlotIdsOrdered
              .map((id: string) => currentSlotById.get(id))
              .filter(Boolean)

            if (orderedMatches.length === 1) {
              mentionedSlotId = orderedMatches[0]._id
            }
          }
        }

        if (!mentionedSlotId && confirmationLike && pendingProposalSelectedSlotId) {
          const pendingSelectedSlot = slots.find((slot: any) => slot._id === pendingProposalSelectedSlotId)
          if (pendingSelectedSlot) {
            mentionedSlotId = pendingSelectedSlot._id
          }
        }

        // Only auto-pick the first slot when the user explicitly asks for the first/earliest option.
        if (!mentionedSlotId && confirmationLike && hasExplicitFirstSlotSignal && slots.length > 0) {
          mentionedSlotId = slots[0]._id
        }

        const confirmingPendingSelectedSlot = Boolean(
          confirmationLike &&
          pendingProposalSelectedSlotId &&
          mentionedSlotId &&
          mentionedSlotId === pendingProposalSelectedSlotId
        )
        const hasExplicitSelectedSlotConfirmation =
          confirmingPendingSelectedSlot ||
          (
            Boolean(mentionedSlotId) &&
            Boolean(confirmationLike) &&
            Boolean(hasPriorSlotContext) &&
            Boolean(hasStrongBookingExecutionSignal(normalizedLatestMessage))
          )
        const canExecuteBooking = Boolean(
          mentionedSlotId &&
          confirmationLike &&
          (
            hasExplicitSelectedSlotConfirmation ||
            (
              isTriageComplete &&
              hasPriorSlotContext &&
              hasStrongBookingExecutionSignal(normalizedLatestMessage)
            )
          )
        )

        if (canExecuteBooking && mentionedSlotId) {
          const selectedSlot = slots.find((slot: any) => slot._id === mentionedSlotId)
          const doctorNameParts = selectedDoctor ? getDoctorNameObj(selectedDoctor) : null
          bookingConfirmation = {
            status: 'payment_required',
            message: 'Your slot is selected. Continue on the secure payment screen to complete the appointment.',
            doctorId: targetDoctorId,
            slotId: mentionedSlotId,
            doctorName: doctorNameParts?.fullName ? `Dr. ${doctorNameParts.fullName}` : 'Selected Doctor',
            doctorSpecialization: selectedDoctor?.specialization || '',
            doctorCity: selectedDoctor?.city || '',
            doctorFee: selectedDoctor?.fee || '',
            slotDate: selectedSlot?.date || '',
            slotStartTime: selectedSlot?.startTime || '',
            slotEndTime: selectedSlot?.endTime || '',
            slotLabel: selectedSlot
              ? formatBookingSlotLabel(selectedSlot.date, selectedSlot.startTime, selectedSlot.endTime)
              : pendingProposalSelectedSlotLabel,
          }
        } else if (mentionedSlotId) {
          const selectedSlot = slots.find((slot: any) => slot._id === mentionedSlotId)
          const selectedSlotLabel = selectedSlot
            ? formatBookingSlotLabel(selectedSlot.date, selectedSlot.startTime, selectedSlot.endTime)
            : pendingProposalSelectedSlotLabel
          bookingPrep = {
            status: 'confirm_pending',
            proposal: {
              doctorId: targetDoctorId,
              selectedSlotId: mentionedSlotId,
              selectedSlotLabel,
            },
            message: selectedSlotLabel
              ? `I found **${selectedSlotLabel}** for the selected doctor. Would you like me to confirm this booking?`
              : 'I found the selected slot for this doctor. Would you like me to confirm the booking?',
          }
        } else if (confirmationLike && hasPriorSlotContext) {
          bookingPrep = {
            status: 'incomplete',
            message: 'I still need the exact slot before booking. Please reply with the slot number already shown (for example, slot 1 or slot 2) or its exact time.',
          }
        }

        if (!bookingConfirmation) {
          if (!bookingPrep) {
            bookingPrep = {
              status: 'ready',
              slotOptions: slots.map(s => ({
                id: s._id,
                date: s.date,
                startTime: s.startTime,
                endTime: s.endTime,
                label: formatBookingSlotLabel(s.date, s.startTime, s.endTime)
              }))
            }
          }
        }

        const repeatedBookingPromptCount = countRepeatedBookingSlotPrompts(
          Array.isArray(args.history) ? args.history : [],
          bookingPrep?.status === 'ready' ? (bookingPrep?.slotOptions || []) : [],
        )

        if (
          bookingPrep?.status === 'ready' &&
          repeatedBookingPromptCount >= 2 &&
          !confirmingPendingSelectedSlot &&
          !mentionedSlotId
        ) {
          bookingPrep = {
            status: 'incomplete',
            message: 'I already shared these slots a couple of times. Please reply with slot 1, slot 2, or ask me to suggest another verified doctor.',
          }
        }
      }
    }
  }

  return {
    steps,
    doctorRecommendations,
    recommendationMode,
    doctorSearchMeta,
    bookingPrep,
    bookingConfirmation,
    resolvedDoctorId,
  }
}

export const fetchAvailableSlots = async (args: { doctorId: string, serviceClient: any }) => {
  // Use Indian Standard Time for the date filter (UTC + 5:30)
  const today = new Date(new Date().getTime() + 330 * 60 * 1000).toISOString().split('T')[0];
  console.log(`[Slot-Debug] Fetching available slots for Doctor: ${args.doctorId} from date: ${today}`);

  const { data, error } = await args.serviceClient
    .from('slots')
    .select('*')
    .eq('doctor_id', args.doctorId)
    .eq('is_booked', false)
    .gte('date', today)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(5)

  if (error) return []
  return (data || [])
    .filter((s: any) => isFutureAvailableSlotTime({ date: s.date, start_time: s.start_time }, 5))
    .map(s => ({
      _id: s.id,
      date: s.date,
      startTime: s.start_time,
      endTime: s.end_time,
      isBooked: s.is_booked
    }))
}

const extractSlotIdFromText = async (
  text: string,
  slots: any[],
  openAiApiKey?: string,
  historyBookingSlotOptions?: any[]
) => {
  const normalized = normalize(text)
  // 1. Precise Match (ID)
  for (const slot of slots) {
    if (normalized.includes(slot._id.toLowerCase())) return slot._id
  }

  // 2. Deterministic heuristic matching (first slot, today, morning, "this slot", etc.)
  const heuristicMatch = resolveSlotByHeuristics({
    text,
    slots,
    historyBookingSlotOptions
  })
  if (heuristicMatch) return heuristicMatch

  // 3. AI Smart Match (fallback)
  if (openAiApiKey && slots.length > 0) {
    const matchedId = await matchSlotWithAI(text, slots, openAiApiKey)
    if (matchedId) return matchedId
  }

  return null
}

export const matchSlotWithAI = async (text: string, slots: any[], apiKey: string) => {
  try {
    const slotContext = slots.map(s => `ID: ${s._id}, Time: ${s.startTime}, Date: ${s.date}`).join(' | ')
    const prompt = `Given the user message: "${text}" and the list of available doctor slots: [${slotContext}].
    Analyze the user's intent to find if they specified a day, date, or time (including Hinglish/Hindi terms like 'kal', 'parso', 'somvar', 'mangalvar', 'subah', 'dopahar', 'shaam', 'aaj', 'tarikh', or numbers like '10 baje', '2 o'clock').
    Identify which slot ID they are referring to.
    If they did not specify any date/time and just said 'book the slot' or 'yes confirm' or 'slots book kr do', respond with "null".
    Respond with ONLY the matching Slot ID or "null".`

    const result = await invokeOpenAIWithRetry({
      apiKey,
      messages: [{ role: 'system', content: 'You are a smart time-slot matcher.' }, { role: 'user', content: prompt }],
      messageText: text
    })

    const reply = result?.reply?.trim()
    return slots.some(s => s._id === reply) ? reply : null
  } catch (e) {
    console.error("AI Slot Match failed", e)
    return null
  }
}

export const executeSlotBooking = async (args: {
  serviceClient: any,
  userId: string,
  doctorId: string,
  slotId: string,
  accessToken: string,
  concern?: string,
  conversationId?: string | null,
  history?: Array<{ role: string, content: string }>,
  patientName?: string,
  patientPhone?: string
}) => {
  try {
    let notificationStatus: 'pending' | 'sent' | 'failed' | 'skipped' = 'skipped'
    let notificationErrorMessage: string | null = null

    // 1. Validate slot belongs to requested doctor and is currently free.
    const { data: slot, error: slotFetchError } = await args.serviceClient
      .from('slots')
      .select('id, doctor_id, is_booked, date, start_time, end_time')
      .eq('id', args.slotId)
      .eq('doctor_id', args.doctorId)
      .maybeSingle()

    if (slotFetchError || !slot || slot.is_booked) {
      return { status: 'conflict', message: 'This slot is no longer available.' }
    }

    if (!isFutureAvailableSlotTime({ date: slot.date, start_time: slot.start_time }, 0)) {
      return { status: 'conflict', message: 'This slot time has already passed.' }
    }

    const cooldownStartIso = new Date(Date.now() - BOOKING_COOLDOWN_WINDOW_MS).toISOString()
    const { data: recentAppointment, error: recentAppointmentError } = await args.serviceClient
      .from('appointments')
      .select('id, created_at')
      .eq('patient_id', args.userId)
      .eq('doctor_id', args.doctorId)
      .in('status', BOOKING_COOLDOWN_STATUSES)
      .gte('created_at', cooldownStartIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentAppointmentError) {
      throw recentAppointmentError
    }

    if (recentAppointment?.created_at) {
      const nextBookingMs = new Date(recentAppointment.created_at).getTime() + BOOKING_COOLDOWN_WINDOW_MS
      const nextBookingLabel = Number.isFinite(nextBookingMs)
        ? new Date(nextBookingMs).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
        : `after ${BOOKING_COOLDOWN_DAYS} days`

      return {
        status: 'error',
        message: `You can book the same doctor only once in ${BOOKING_COOLDOWN_DAYS} days. Next booking available on ${nextBookingLabel}.`,
      }
    }

    // 2. Atomically claim the slot before creating the appointment.
    const { data: claimedSlot, error: claimError } = await args.serviceClient
      .from('slots')
      .update({ is_booked: true })
      .eq('id', args.slotId)
      .eq('doctor_id', args.doctorId)
      .eq('is_booked', false)
      .select('id, date, start_time, end_time')
      .maybeSingle()

    if (claimError || !claimedSlot) {
      return { status: 'conflict', message: 'This slot was just booked by someone else.' }
    }

    // 3. Create confirmed appointment
    const { data: appointment, error: aptError } = await args.serviceClient
      .from('appointments')
      .insert({
        patient_id: args.userId,
        doctor_id: args.doctorId,
        slot_id: args.slotId,
        status: 'confirmed'
      })
      .select()
      .single()

    if (aptError) {
      // Best-effort rollback if appointment creation fails after slot claim.
      await args.serviceClient
        .from('slots')
        .update({ is_booked: false })
        .eq('id', args.slotId)
        .eq('doctor_id', args.doctorId)
      throw aptError
    }

    // 4. Attach appointment id to claimed slot
    await args.serviceClient
      .from('slots')
      .update({ is_booked: true, appointment_id: appointment.id })
      .eq('id', args.slotId)
      .eq('doctor_id', args.doctorId)

    // 5. Get doctor name for confirmation
    const { data: docData } = await args.serviceClient
      .from('doctors')
      .select('profiles(first_name, last_name)')
      .eq('id', args.doctorId)
      .single()

    const profiles = Array.isArray(docData?.profiles) ? docData.profiles[0] : docData?.profiles
    const doctorName = profiles ? `Dr. ${profiles.first_name} ${profiles.last_name}` : 'the doctor'

    // Trigger doctor notification + AI PDF enrichment in background.
    // Prefer runtime waitUntil when available so the task survives after the
    // booking response is returned. If waitUntil is unavailable, fire-and-forget
    // so voice confirmation is not blocked by PDF/notification work.
    if (args.accessToken) {
      const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim()
      const invokeKey = (Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
      if (supabaseUrl && invokeKey) {
        notificationStatus = 'pending'
        const compactHistory = (Array.isArray(args.history) ? args.history : [])
          .map((item: any) => ({
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            content: clipText(typeof item?.content === 'string' ? item.content : '', 320),
          }))
          .filter((item: any) => item.content.length > 0)
          .slice(-20)

        const notificationBody: any = { appointmentId: appointment.id }
        if (typeof args.concern === 'string' && args.concern.trim()) {
          notificationBody.concern = clipText(args.concern.trim(), 120)
        }
        if (typeof args.conversationId === 'string' && isUuid(args.conversationId)) {
          notificationBody.conversationId = args.conversationId
        }
        if (compactHistory.length > 0) {
          notificationBody.history = compactHistory
        }

        const notificationTask = (async () => {
          const maxAttempts = 2
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
              const response = await fetch(`${supabaseUrl}/functions/v1/send-appointment-notification`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${args.accessToken}`,
                  apikey: invokeKey,
                },
                body: JSON.stringify(notificationBody),
              })

              const payload = await response.json().catch(() => null)

              if (
                response.ok &&
                payload?.success !== false &&
                (payload?.aiReport === undefined || payload?.aiReport?.pdfUrl || payload?.aiReport?.reportId)
              ) {
                notificationStatus = 'sent'
                return
              }

              const message =
                typeof payload?.error === 'string' && payload.error
                  ? payload.error
                  : typeof payload?.reason === 'string' && payload.reason
                    ? payload.reason
                    : typeof payload?.message === 'string' && payload.message
                      ? payload.message
                      : 'unknown_notification_failure'
              if (attempt >= maxAttempts) {
                throw new Error(`status=${response.status} body=${message || 'empty'}`)
              }

              await sleep(500 * attempt)
            } catch (notificationError) {
              if (attempt >= maxAttempts) {
                throw notificationError
              }
              await sleep(500 * attempt)
            }
          }
        })()

        const backgroundNotificationTask = notificationTask.catch((notificationError) => {
          notificationStatus = 'failed'
          notificationErrorMessage =
            notificationError instanceof Error ? notificationError.message : String(notificationError || 'unknown_notification_failure')
          console.warn(
            `[Booking] send-appointment-notification failed for appointment ${appointment.id}:`,
            notificationError,
          )
        })

        const runtime = (globalThis as any)?.EdgeRuntime
        if (runtime && typeof runtime.waitUntil === 'function') {
          runtime.waitUntil(backgroundNotificationTask)
        } else {
          void backgroundNotificationTask
        }
      } else {
        notificationStatus = 'failed'
        notificationErrorMessage = 'notification_env_missing'
      }
    } else {
      notificationStatus = 'failed'
      notificationErrorMessage = 'missing_access_token_for_notification'
    }

    return {
      status: 'confirmed',
      appointmentId: appointment.id,
      doctorName,
      slotLabel: formatBookingSlotLabel(claimedSlot.date, claimedSlot.start_time, claimedSlot.end_time),
      notificationStatus,
      notificationErrorMessage,
    }
  } catch (e) {
    console.error("Booking failed", e)
    return { status: 'error', message: e.message }
  }
}

export const logAgentAction = async (args: any) => {
  await args.serviceClient.from('ai_agent_logs').insert({
    user_id: args.userId,
    conversation_id: args.conversationId,
    action: args.action,
    status: args.status,
    payload: args.payload
  })
}

// Re-exporting legacy functions that were already in the file
export const extractAndValidateCityFromText = async (text: string, serviceClient: any): Promise<string | null> => {
  if (!text) return null
  const normalized = normalize(text)

  // Fuzzy discovery for major cities (handles typos and concatenation like 'inpatna' or 'dinpatna')
  const cities = ['patna', 'chandigarh', 'delhi', 'mumbai', 'lucknow', 'bangalore', 'jaipur', 'ahmedabad', 'pune', 'hyderabad', 'chennai', 'kolkata', 'guwahati', 'bhopal', 'indore', 'surat', 'kanpur', 'nagpur', 'kochi', 'rosera', 'samastipur'];

  for (const c of cities) {
    if (normalized.includes(c)) {
      return toTitleCase(c)
    }
  }

  return null
}

const toTitleCase = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()

export const incrementAiUsageStats = async (args: { serviceClient: any, userId: string, dayKey: string }) => {
  try {
    const now = new Date()
    const nowIso = now.toISOString()
    const nowMs = now.getTime()

    const { data: current } = await args.serviceClient
      .from('ai_usage_stats')
      .select('message_count, burst_count, burst_window_started_at')
      .eq('user_id', args.userId)
      .eq('day_key', args.dayKey)
      .maybeSingle()

    const nextCount = (current?.message_count || 0) + 1
    const existingBurstCount = Math.max(0, Number(current?.burst_count || 0))
    const burstWindowStartedAtRaw =
      typeof current?.burst_window_started_at === 'string' ? current.burst_window_started_at : ''
    const burstWindowStartedMs = burstWindowStartedAtRaw ? new Date(burstWindowStartedAtRaw).getTime() : NaN
    const isWithinBurstWindow =
      Number.isFinite(burstWindowStartedMs) &&
      nowMs >= burstWindowStartedMs &&
      nowMs - burstWindowStartedMs < AI_BURST_WINDOW_MS
    const nextBurstCount = isWithinBurstWindow ? existingBurstCount + 1 : 1
    const nextBurstWindowStartedAt = isWithinBurstWindow ? burstWindowStartedAtRaw || nowIso : nowIso

    await args.serviceClient
      .from('ai_usage_stats')
      .upsert({
        user_id: args.userId,
        day_key: args.dayKey,
        message_count: nextCount,
        burst_count: nextBurstCount,
        burst_window_started_at: nextBurstWindowStartedAt,
        updated_at: nowIso
      }, { onConflict: 'user_id,day_key' })

  } catch (e) {
    console.error("Failed to increment usage stats", e)
  }
}

export const resolveDoctorRecommendationsWithFallback = async (args: {
  serviceClient: any,
  departmentSuggestion: any,
  locationCity: string | null,
  searchAreaCity: string | null,
  latestMessageText: string
}) => {
  const resolvedDepartment = resolveDepartmentFromSuggestion(args.departmentSuggestion, args.latestMessageText)
  const specialty = resolvedDepartment?.label || args.departmentSuggestion?.label || null
  // `searchAreaCity` is already resolved upstream. Do not silently fall back to the
  // device/location city here, otherwise generic doctor searches keep snapping back
  // to the current city (for example Patna) even when the user did not ask for local results.
  const city = normalizeCityInput(args.searchAreaCity || null)
  const cityLike = city ? `%${escapePostgrestLike(city)}%` : null

  let doctors = []
  let recommendationMode = 'exact'
  const meta: DoctorSearchMeta = { source: 'database', localCity: city }
  const exactDepartmentTerms = collectDepartmentTerms(resolvedDepartment?.id || null, specialty)

  // Step 1: Specific City + Specialty (Robust Match)
  if (city && specialty) {
    const specialtyFilter = buildSpecializationOrFilter(exactDepartmentTerms)
    let query = args.serviceClient
      .from('doctors')
      .select('*, profiles(first_name, last_name, profile_picture)')
      .eq('is_verified', true)
      .ilike('city', cityLike!)
      .order('is_verified', { ascending: false })
      .limit(6)

    if (specialtyFilter) {
      query = query.or(specialtyFilter)
    } else {
      query = query.ilike('specialization', `%${specialty}%`)
    }

    const { data } = await query

    if (data && data.length > 0) {
      doctors = data
    }
  }

  // Step 2: Related Specialty fallback inside the same city.
  // If the exact specialty is unavailable locally, try the closest related local specialists next.
  if (doctors.length === 0 && city && resolvedDepartment?.id) {
    const relatedIds = RELATED_DEPARTMENT_IDS[resolvedDepartment.id] || ['kayachikitsa']
    const relatedTerms = relatedIds.flatMap((departmentId) => {
      const relatedLabel = DEPARTMENT_CATALOG.find((department) => department.id === departmentId)?.label || null
      return collectDepartmentTerms(departmentId, relatedLabel)
    })
    const relatedTermPool = Array.from(new Set([...relatedTerms, ...GENERIC_RELATED_TERMS]))
    const relatedFilter = buildSpecializationOrFilter(relatedTermPool)

    if (relatedFilter) {
      recommendationMode = 'related_specialty'
      const { data } = await args.serviceClient
        .from('doctors')
        .select('*, profiles(first_name, last_name, profile_picture)')
        .eq('is_verified', true)
        .ilike('city', cityLike!)
        .or(relatedFilter)
        .order('is_verified', { ascending: false })
        .limit(6)

      if (data && data.length > 0) {
        doctors = data
        meta.relatedFallback = true
      }
    }
  }

  // Step 3: Specialty-only fallback across the app.
  // If the requested specialist is not available in this city, prefer the same
  // specialty from another city over unrelated local doctors.
  if (doctors.length === 0 && specialty) {
    const specialtyFilter = buildSpecializationOrFilter(exactDepartmentTerms)
    let query = args.serviceClient
      .from('doctors')
      .select('*, profiles(first_name, last_name, profile_picture)')
      .eq('is_verified', true)
      .order('is_verified', { ascending: false })
      .limit(6)

    if (specialtyFilter) {
      query = query.or(specialtyFilter)
    } else {
      query = query.ilike('specialization', `%${specialty}%`)
    }

    const { data } = await query
    if (data && data.length > 0) {
      doctors = data
      recommendationMode = 'all_app_specialty'
      meta.usedAppWideFallback = true
    }
  }

  // Step 4: City-only fallback.
  // Only if there is still no exact/related/app-wide specialist match, show other local doctors.
  if (doctors.length === 0 && city) {
    recommendationMode = 'local_any'
    const { data } = await args.serviceClient
      .from('doctors')
      .select('*, profiles(first_name, last_name, profile_picture)')
      .eq('is_verified', true)
      .ilike('city', cityLike!)
      .order('is_verified', { ascending: false })
      .limit(6)

    if (data && data.length > 0) {
      doctors = data
      meta.localCityVisible = true
    }
  }

  // Step 5: Global App Fallback (if nothing specialty-matched or local exists, show all verified doctors).
  if (doctors.length === 0) {
    recommendationMode = 'all_app'
    const { data } = await args.serviceClient
      .from('doctors')
      .select('*, profiles(first_name, last_name, profile_picture)')
      .eq('is_verified', true)
      .order('is_verified', { ascending: false })
      .limit(6)

    if (data && data.length > 0) {
      doctors = data
      meta.usedAppWideFallback = true
    }
  }

  // Map and flatten profiles data to match frontend expectations (firstName, lastName)
  const flattenedDoctors = doctors.map(d => {
    const profiles = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    return {
      ...d,
      firstName: profiles?.first_name || d.firstName || '',
      lastName: profiles?.last_name || d.lastName || '',
      image: profiles?.profile_picture || d.image || ''
    };
  });

  return {
    doctors: flattenedDoctors,
    recommendationMode,
    meta: {
      ...meta,
      source: 'database',
      externalSearchUsed: false,
    },
  }
}

export const readConversationMemory = async (args: any) => {
  if (!args.conversationId || !isUuid(args.conversationId)) return { summary: '', keyFacts: [] }
  const { data } = await args.serviceClient.from('ai_chat_conversation_memory').select('summary, key_facts').eq('conversation_id', args.conversationId).maybeSingle()
  return { summary: data?.summary || '', keyFacts: data?.key_facts || [] }
}

export const upsertConversationMemory = async (args: any) => {
  if (!args.conversationId || !isUuid(args.conversationId)) return
  await args.serviceClient.from('ai_chat_conversation_memory').upsert({
    conversation_id: args.conversationId, user_id: args.userId, summary: args.summary, key_facts: args.keyFacts, updated_at: new Date().toISOString()
  }, { onConflict: 'conversation_id' })
}
