// @ts-nocheck

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const APPOINTMENT_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed'
}

export const parseEnvInt = (key: string, fallback: number): number => {
  const raw = Number((Deno.env.get(key) || '').trim())
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

export const parseEnvBool = (key: string, fallback: boolean): boolean => {
  const raw = (Deno.env.get(key) || '').trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

export const parseEnvFloat = (key: string, fallback: number): number => {
  const raw = Number((Deno.env.get(key) || '').trim())
  return Number.isFinite(raw) ? raw : fallback
}

export const DEFAULT_OPENAI_MODEL = (Deno.env.get('CHAT_AI_OPENAI_MODEL') || 'gpt-5.4').trim() || 'gpt-5.4'
export const DEFAULT_OPENAI_FALLBACK_MODEL = (Deno.env.get('CHAT_AI_OPENAI_FALLBACK_MODEL') || 'gpt-5-mini').trim() || 'gpt-5-mini'
export const GEMINI_TIMEOUT_MS = Math.max(8_000, parseEnvInt('CHAT_AI_GEMINI_TIMEOUT_MS', 12_000))
export const GEMINI_MAX_ATTEMPTS = Math.max(1, Math.min(2, parseEnvInt('CHAT_AI_GEMINI_MAX_ATTEMPTS', 1)))
export const GEMINI_MAX_OUTPUT_TOKENS = Math.max(180, Math.min(900, parseEnvInt('CHAT_AI_GEMINI_MAX_OUTPUT_TOKENS', 420)))
export const AUTONOMOUS_AGENT_ENABLED = parseEnvBool('CHAT_AI_AUTONOMOUS_ENABLED', true)
export const PREFETCH_DOCTORS_BEFORE_AI = parseEnvBool('CHAT_AI_PREFETCH_DOCTORS_BEFORE_AI', false)
export const INCLUDE_TOP_DOCTORS_IN_PROMPT = parseEnvBool('CHAT_AI_INCLUDE_TOP_DOCTORS_IN_PROMPT', false)
export const SYSTEM_PROMPT_MEMORY_CLIP = Math.max(200, Math.min(900, parseEnvInt('CHAT_AI_MEMORY_PROMPT_CLIP', 420)))
export const SYSTEM_PROMPT_TOOL_CONTEXT_CLIP = Math.max(200, Math.min(900, parseEnvInt('CHAT_AI_TOOL_PROMPT_CLIP', 420)))
export const DOCTOR_RECOMMENDATION_LIMIT = 6

// USER REQUEST: Limit to 20 chats per user per window
export const AI_MESSAGE_LIMIT_PER_WINDOW = Math.max(10, Math.min(1000, parseEnvInt('CHAT_AI_MESSAGE_LIMIT_PER_WINDOW', 20)))
export const AI_RATE_LIMIT_TZ_OFFSET_MINUTES = 330
export const AI_FIRST_BLOCK_MS = Math.max(5 * 60 * 1000, parseEnvInt('CHAT_AI_FIRST_BLOCK_MS', 2 * 60 * 60 * 1000))
export const AI_SECOND_BLOCK_MS = Math.max(10 * 60 * 1000, parseEnvInt('CHAT_AI_SECOND_BLOCK_MS', 4 * 60 * 60 * 1000))
export const AI_BURST_LIMIT_MESSAGES = Math.max(2, Math.min(50, parseEnvInt('CHAT_AI_BURST_LIMIT_MESSAGES', 6)))
export const AI_BURST_WINDOW_MS = Math.max(10 * 1000, parseEnvInt('CHAT_AI_BURST_WINDOW_MS', 60 * 1000))

export const CHAT_HISTORY_SEND_ITEMS = Math.max(
  1,
  Math.min(20, parseEnvInt('CHAT_AI_HISTORY_SEND_ITEMS', 5))
)
export const CHAT_HISTORY_MAX_CHARS = 520

export type ReplyLanguageStyle = 'auto'

export type DepartmentConfig = {
  id: string
  label: string
  keywords: string[]
}

export const DEPARTMENT_CATALOG: DepartmentConfig[] = [
  { id: 'kayachikitsa', label: 'Kayachikitsa', keywords: ['kayachikitsa', 'general', 'physician', 'internal medicine', 'family medicine', 'fever', 'bukhar', 'cold', 'cough', 'viral', 'infection', 'headache', 'body ache', 'weakness'] },
  { id: 'cardiology', label: 'Cardiology', keywords: ['cardio', 'cardiac', 'heart', 'chest pain', 'palpitations', 'bp', 'hypertension', 'blood pressure', 'tachycardia', 'angina'] },
  { id: 'endocrinology', label: 'Endocrinology', keywords: ['endo', 'diabetes', 'thyroid', 'hormone', 'sugar', 'glucose', 'insulin', 'hba1c', 'pcos metabolism'] },
  { id: 'pediatrics', label: 'Pediatrics', keywords: ['pediatric', 'paediatric', 'child', 'kids', 'newborn', 'baby', 'infant', 'child fever'] },
  { id: 'orthopedic', label: 'Orthopedic', keywords: ['ortho', 'orthopedic', 'orthopaedic', 'joint', 'bone', 'spine', 'back pain', 'knee pain', 'fracture', 'shoulder pain'] },
  { id: 'dermatology', label: 'Dermatology', keywords: ['derma', 'skin', 'rash', 'acne', 'eczema', 'fungal', 'allergy', 'itch', 'itching', 'pigmentation'] },
  { id: 'gynecology', label: 'Gynecology', keywords: ['gyn', 'gyne', 'obstetric', 'pregnancy', 'period', 'women health', 'pcos', 'pcod', 'irregular periods'] },
  { id: 'psychiatry', label: 'Psychiatry', keywords: ['psychiatry', 'mental', 'anxiety', 'depression', 'panic', 'stress', 'sleep issue', 'insomnia', 'mood'] },
  { id: 'pulmonology', label: 'Pulmonology', keywords: ['pulmo', 'lung', 'respiratory', 'asthma', 'breathing', 'cough', 'breathlessness', 'wheezing', 'shortness of breath'] },
  { id: 'gastroenterology', label: 'Gastroenterology', keywords: ['gastro', 'digestion', 'stomach', 'gut', 'ibs', 'acidity', 'liver', 'nausea', 'vomit', 'diarrhea', 'constipation'] },
  { id: 'nephrology', label: 'Nephrology', keywords: ['nephro', 'kidney', 'urinary', 'urine', 'creatinine', 'kidney stone', 'renal'] },
  { id: 'ent', label: 'ENT', keywords: ['ent', 'ear', 'nose', 'throat', 'sinus', 'sore throat', 'tonsil', 'hearing'] },
  { id: 'urology', label: 'Urology', keywords: ['urology', 'prostate', 'urinary', 'male sexual health', 'uti', 'burning urination', 'urine flow'] },
]

export const DOCTOR_INTENT_TERMS = [
  'doctor', 'consult', 'appointment', 'book', 'booking', 'specialist',
  'show doctors', 'find doctor', 'need doctor', 'slot', 'dr', 'doc',
  'dikhao', 'dikhaiye', 'book kar', 'consultation'
]

export const DOCTOR_SEARCH_INTENT_TERMS = [
  'show doctors', 'show me doctors', 'find doctor', 'find me a doctor',
  'search doctor', 'doctor near me', 'nearby doctor', 'recommend doctor',
  'best doctor', 'doctor list', 'book appointment', 'book a slot',
  'slot book', 'appointment book', 'hospital near me', 'specialist near me',
  'doctor suggestion', 'doctor options', 'consult doctor', 'doctor dikhao',
  'doctor dikhaiye', 'doctor batao', 'doctor suggest', 'doctor chahiye',
  'doctor se milna', 'appointment karwao', 'appointment kara do',
  'kaun kaun doctor', 'kaun kaun doctors', 'kitne doctor', 'doctor available',
  'doctors available', 'doctor sahab', 'kaun doctor', 'kaunsi doctor',
  'kaun se doctor', 'kis doctor', 'which doctor', 'who are the doctor',
  'doctor directory', 'doctors in', 'doctor in',
  'find karo', 'find kar do', 'find kr do', 'find me', 'dhundho',
  'dhund do', 'dhundh do', 'dhoondh do', 'dhoondho', 'mere liye find',
  'mere liye dhundh', 'mere liye doctor', 'mujhe doctor', 'mujhe ek doctor',
  'ek doctor chahiye', 'ek doctor dikhao', 'koi doctor batao',
  'koi doctor chahiye', 'koi doctor bata', 'doctor kaha hai',
  'doctor kahan hai', 'doctor kahan milega', 'doctor kaha milega',
  'nearest doctor', 'local doctor', 'city mein doctor', 'mein doctor',
  'mein koi doctor', 'connect karo doctor', 'connect to doctor',
  'doctor connect', 'get me doctor', 'ek accha doctor', 'ek acha doctor',
  'achha doctor', 'koi accha doctor', 'specialist chahiye',
  'specialist dhundo', 'specialist milao',
]

export const hasSmartDoctorSearchSignal = (textInput: string): boolean => {
  const text = normalize(textInput)
  if (!text) return false
  if (hasAnyTerm(text, DOCTOR_SEARCH_INTENT_TERMS)) return true
  if (/\b(who should i consult|which doctor|what doctor|what specialist|who can treat|kaun doctor|kaun sa doctor|kis doctor|kis specialist|kisko dikha(u|un)|kise dikha(u|un)|kaun se doctor)\b/.test(text)) return true
  if (/\b(show|find|search|suggest|recommend|list|options|dikhao|dikhaiye|batao|dhundho|dhoondho)\b.*\b(doctor|doctors|specialist|specialists|physician|consultant)\b/.test(text)) return true
  if (/\b(doctor|doctors|specialist|specialists|physician|consultant)\b.*\b(in|near|around|available|options|list)\b/.test(text)) return true
  return false
}

export const hasLocalDoctorSearchPreference = (textInput: string): boolean => {
  const text = normalize(textInput)
  if (!text) return false
  if (/\b(near me|nearby|my city|current city|current location|my area|local|closest|nearest|around me)\b/.test(text)) return true
  if (/\b(near|around)\b.*\b(me|here)\b/.test(text)) return true
  if (/\b(mere paas|mere pass|mere area|mere city|mere shehar|aas paas|pass me|paas me|yahin|yaha ke|yahan ke)\b/.test(text)) return true
  return false
}

export const GENERIC_SEARCH_FOLLOWUP_TERMS = [
  'search karo', 'search kar do', 'search kardo', 'search kr do',
  'search krdo', 'find karo', 'find kar do', 'dhundho', 'dhund do',
  'dhundh do', 'dhoondho', 'dhoond do', 'dikha do', 'dikhao',
  'dikhaiye', 'show me', 'show', 'list dikhao', 'list batao',
  'options dikhao', 'options batao', 'suggest karo', 'bata do',
]

export const BOOKING_PREPARE_INTENT_TERMS = [
  'book appointment', 'book an appointment', 'book my appointment', 'book visit',
  'book a slot', 'book slot', 'book consultation', 'book consult',
  'schedule appointment', 'schedule consultation', 'appointment book',
  'slot book', 'slot chahiye', 'appointment chahiye', 'appointment karwao',
  'appointment kara do', 'slot karwao', 'slot kara do', 'book kar do',
  'book kardo', 'book kr do', 'book krdo', 'reserve slot', 'reserve this slot',
  'lock this slot', 'hold this slot', 'take this slot', 'fix appointment',
  'setup appointment', 'set up appointment', 'set appointment', 'consultation kara do',
  'appointment laga do', 'appointment lagao',
]

export const BOOKING_CONFIRMATION_TERMS = [
  'confirm booking', 'confirm it', 'yes book', 'yes book it',
  'book it', 'book this', 'book now', 'book kar do', 'book kardo',
  'book kr do', 'book krdo', 'appointment karwa do', 'appointment kara do',
  'go ahead', 'proceed', 'schedule it', 'haan book', 'haan kar do',
  'yes please book', 'confirm this slot', 'confirm slot', 'book this slot',
  'book this one', 'is slot', 'ye slot', 'this slot', 'that slot',
  'wahi slot', 'isi slot', 'go with this', 'take this one', 'pick this one',
  'first slot', 'second slot', 'earliest slot', 'latest slot',
  'confirm kar do', 'confirm kardo', 'confirm kr do', 'confirm krdo',
  'confirm karo', 'booking confirm', 'booking confirm kar do', 'booking confirm kardo',
  'slot confirm', 'slot confirm kar do', 'slot confirm kardo',
  'appointment confirm', 'appointment confirm kar do', 'appointment confirm kardo',
  'confirm this booking', 'confirm this appointment', 'yes confirm', 'ok confirm',
  'okay confirm', 'haan confirm', 'han confirm', 'theek hai confirm', 'thik hai confirm',
]

export const BOOKING_DECLINE_TERMS = [
  'dont book', "don't book", 'do not book', 'not now', 'cancel booking',
  'stop booking', 'rehne do', 'mat book karo',
]

export const RECORD_TOOL_INTENT_TERMS = [
  'my report', 'my reports', 'medical report', 'lab report',
  'test report', 'blood test', 'cbc', 'lft', 'kft', 'scan report',
  'xray report', 'mri report', 'previous report', 'past report',
  'old report', 'result kya تھا', 'result batao', 'report check',
  'record dekh',
]

export const VITALS_TOOL_INTENT_TERMS = [
  'my bp', 'blood pressure', 'bp kya', 'pulse', 'heart rate',
  'vitals', 'weight', 'latest vitals', 'latest bp', 'latest pulse',
  'mera bp', 'mera pulse', 'mera weight',
]

export const ESCALATION_TOOL_INTENT_TERMS = [
  'should i consult', 'should i see doctor', 'do i need doctor',
  'urgent', 'emergency', 'is it serious', 'how serious',
  'doctor ko dikhaun', 'doctor se milu', 'doctor ko dikhana hai',
  'kya doctor ko dikhaun',
]

export interface ClinicalProfileSnapshot {
  summary: string
  chronicConditions: string[]
  knownAllergies: string[]
  surgeryHistory: string[]
  longTermMedications: string[]
  keyRisks: string[]
  lastPulseUpdateAt: string | null
}

export type EscalationPriority = 'immediate' | 'today' | 'soon' | 'routine'

export interface EscalationPlan {
  recommended: boolean
  reason: string
  priority: EscalationPriority
  department?: string
}

export interface AutonomousToolStep {
  thought: string
  action: string
  input: any
  observation: string
  status: 'success' | 'error' | 'skipped'
}

export interface DoctorSearchMeta {
  source: 'database' | 'web' | 'mixed'
  localCity: string | null
  messageHint?: string
  externalSearchUsed?: boolean
  externalSearchObservation?: string
  usedAppWideFallback?: boolean
}

export interface BookingPreparation {
  status: 'ready' | 'confirm_pending' | 'incomplete' | 'error' | 'no_slots'
  proposal?: any
  slotOptions?: any[]
  message?: string
}

export interface BookingSlotOption {
  id: string
  date: string
  startTime: string
  endTime: string
  label: string
}

export interface BookingConfirmation {
  status: 'confirmed' | 'conflict' | 'error' | 'none'
  appointmentId?: string
  doctorName?: string
  slotLabel?: string
  message?: string
}

// Utility functions from utils.ts
export const clipText = (value: string, maxLength: number): string => {
  const text = (value || '').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

export const normalize = (value: string): string =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

export const isAssistantConcern = (concern: string): boolean =>
  normalize(concern).includes('assistant')

export const detectLanguageStyle = (_message: string, _history: any[] = []): ReplyLanguageStyle => 'auto'

export const getLanguageInstruction = (style: ReplyLanguageStyle): string => {
  if (style === 'auto') {
    return [
      'CRITICAL: You MUST reply in the EXACT SAME SCRIPT as the user.',
      'If the user writes Hindi in English letters (Hinglish like "kya hal hai"), you MUST reply in Hinglish (Roman script, e.g. "Main theek hu"). DO NOT use Devanagari script (हिंदी) unless the user uses it first.',
      'If the user writes in English, reply in English.',
      'If the user writes in Devanagari Hindi, reply in Devanagari Hindi.',
      'Always mirror the user\'s tone and language naturally.',
      'Use clean Markdown formatting when helpful for readability (headings, bullet points, numbered steps, and bold key terms).',
      'Keep formatting natural and not excessive for short or casual replies.',
      'UX SAFETY: NEVER output internal system hints (like "INSTRUCTION:", "No verified doctors found") or raw search metadata (like "class=", "Web Search Results:").',
      'REPHRASE ALL SYSTEM HINTS into warm, conversational responses. NEVER mention that you checked specific external tools by name (like Practo, Tavily, or DuckDuckGo) unless asked.',
      'If citing web results, use "According to health sources" or similar natural phrases. NO RAW URLS allowed.',
    ].join(' ')
  }
  return 'Automatically detect and mirror the user language.'
}

export const hasMarkdownStructure = (value: string): boolean =>
  /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|>\s)/m.test(value || '') ||
  /\*\*[^*]+\*\*/.test(value || '') ||
  /\`[^`]+\`/.test(value || '')

export const containsEmoji = (value: string): boolean =>
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(value || '')

export const chooseHeadingEmoji = (headingLine: string): string => {
  const normalizedHeading = normalize(headingLine)
  if (
    normalizedHeading.includes('warning') ||
    normalizedHeading.includes('urgent') ||
    normalizedHeading.includes('emergency') ||
    normalizedHeading.includes('danger') ||
    normalizedHeading.includes('symptom') ||
    normalizedHeading.includes('fever') ||
    normalizedHeading.includes('pain') ||
    normalizedHeading.includes('triage') ||
    normalizedHeading.includes('question') ||
    normalizedHeading.includes('guidance')
  ) {
    return ''
  }
  if (normalizedHeading.includes('doctor') || normalizedHeading.includes('consult')) return '🩺'
  if (normalizedHeading.includes('next') || normalizedHeading.includes('step')) return '✅'
  return ''
}

export const addHeadingEmojis = (markdown: string, maxEmojis: number = 2): string => {
  const lines = (markdown || '').split('\n')
  let used = 0
  const updated = lines.map((line) => {
    if (used >= maxEmojis) return line
    if (!/^\s*#{1,6}\s+/.test(line)) return line
    if (containsEmoji(line)) return line
    const emoji = chooseHeadingEmoji(line)
    if (!emoji) return line
    used += 1
    return `${line} ${emoji}`
  })
  return updated.join('\n')
}

export const formatAiReplyForPremiumMarkdown = (rawReply: string, args: {
  allowEmoji: boolean
  safetyCritical: boolean
}): string => {
  let text = (rawReply || '').replace(/\r\n/g, '\n').replace(/<[^>\n]+>/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return ''
  if (args.allowEmoji && !args.safetyCritical && !containsEmoji(text)) {
    text = addHeadingEmojis(text, 2)
  }
  return text
}

const splitTextIntoStreamingChunks = (value: string, maxChunkSize: number = 44): string[] => {
  const text = String(value || '')
  if (!text.trim()) return []

  const chunks: string[] = []
  let cursor = 0
  const safeMax = Math.max(24, maxChunkSize)

  while (cursor < text.length) {
    let end = Math.min(cursor + safeMax, text.length)
    if (end < text.length) {
      const slice = text.slice(cursor, end)
      const breakAt = Math.max(
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf(', '),
        slice.lastIndexOf(' ')
      )
      if (breakAt > 14) {
        end = cursor + breakAt + 1
      }
    }
    const part = text.slice(cursor, end)
    if (part) chunks.push(part)
    cursor = end
  }

  return chunks
}

export const createStreamingResponse = (payload: any) => {
  const encoder = new TextEncoder()
  const replyText =
    typeof payload?.data?.reply === 'string'
      ? payload.data.reply
      : typeof payload?.message === 'string'
        ? payload.message
        : ''

  const chunks = splitTextIntoStreamingChunks(replyText)
  const stream = new ReadableStream({
    async start(controller) {
      const enqueueEvent = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        if (chunks.length > 0) {
          const delayMs = chunks.length > 48 ? 2 : chunks.length > 24 ? 4 : 6
          for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index]
            enqueueEvent('delta', { text: chunk })
            if (index > 0) {
              await new Promise((resolve) => setTimeout(resolve, delayMs))
            }
          }
        }

        enqueueEvent('done', payload)
      } catch (streamError: any) {
        enqueueEvent('error', {
          message:
            typeof streamError?.message === 'string' && streamError.message.trim()
              ? streamError.message.trim()
              : 'Streaming failed',
        })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    }
  })
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const asksMedicineQuestion = (message: string): boolean => {
  const text = normalize(message)
  return [
    'medicine', 'medication', 'tablet', 'capsule', 'syrup', 'drug', 'dawai', 'dava'
  ].some((keyword) => text.includes(keyword))
}

export const hasDangerSignal = (textInput: string): boolean => {
  const text = normalize(textInput)
  return [
    'chest pain', 'difficulty breathing', 'shortness of breath', 'unconscious', 'fainted', 'stroke', 'zeher'
  ].some((signal) => text.includes(signal))
}

export const isGreetingOnlyMessage = (message: string): boolean => {
  const text = normalize(message)
  return ['hi', 'hello', 'hey', 'namaste'].some((term) => text === term || text.startsWith(`${term} `))
}

export const hasSymptomSignal = (textInput: string): boolean => {
  const text = normalize(textInput)
  return [
    'pain', 'fever', 'cough', 'cold', 'bukhar', 'dard', 'injury', 'fracture', 'broken',
    'bone', 'joint', 'sprain', 'swelling', 'bleeding', 'wound', 'burn', 'haath', 'hath',
    'hand', 'arm', 'leg', 'finger', 'wrist', 'ankle', 'toot', 'toota', 'tut', 'tuta',
  ].some((term) => text.includes(term))
}

export const hasPersonalHealthContext = (textInput: string): boolean => {
  const text = normalize(textInput)
  return [/\bi\b/, /\bmy\b/, /\bme\b/, /\bmain\b/, /\bmai\b/, /\bmujhe\b/].some((pattern) => pattern.test(text))
}

export const normalizeCityInput = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return null;

  // Handle common Indian city typos or voice-to-text concatenations
  if (cleaned.includes('patna')) return 'Patna';
  if (cleaned.includes('chandigarh')) return 'Chandigarh';
  if (cleaned.includes('rosera')) return 'Rosera';
  if (cleaned.includes('delhi')) return 'Delhi';
  if (cleaned.includes('mumbai')) return 'Mumbai';
  
  return clipText(value.trim().replace(/\s+/g, ' '), 60);
}

export const hasAnyTerm = (text: string, terms: string[]): boolean => terms.some((term) => text.includes(term))

const BOOKING_ACTION_HINTS = [
  'book', 'schedule', 'reserve', 'confirm', 'lock', 'hold', 'fix', 'arrange',
  'kara do', 'karwa do', 'kar do', 'kr do', 'kardo', 'karwao', 'karao',
]

const BOOKING_OBJECT_HINTS = [
  'appointment', 'slot', 'consult', 'consultation', 'time', 'timing',
  'visit', 'doctor se milna', 'doctor consult',
]

const BOOKING_DEMONSTRATIVE_HINTS = [
  'this slot', 'that slot', 'this one', 'that one', 'is slot', 'ye slot',
  'wahi slot', 'isi slot', 'same slot', 'same time', 'yehi', 'yahi',
]

const BOOKING_AFFIRMATION_HINTS = [
  'yes', 'haan', 'han', 'hanji', 'ok', 'okay', 'sure', 'theek', 'thik',
  'go ahead', 'proceed', 'done',
]

export const hasSmartSlotReferenceSignal = (textInput: string): boolean => {
  const text = normalize(textInput)
  if (!text) return false
  if (hasAnyTerm(text, BOOKING_DEMONSTRATIVE_HINTS)) return true
  if (/\b(first|1st|pehla|pahla|dusra|doosra|second|2nd|third|3rd|last|latest|earliest)\b/.test(text)) return true
  if (/\b(today|tomorrow|aaj|kal|morning|subah|afternoon|dopahar|evening|shaam|night|raat)\b/.test(text)) return true
  if (/\b\d{1,2}(:\d{2})?\s*(am|pm)?\b/.test(text)) return true
  return false
}

export const hasSmartBookingPrepareSignal = (textInput: string): boolean => {
  const text = normalize(textInput)
  if (!text) return false
  if (hasAnyTerm(text, BOOKING_PREPARE_INTENT_TERMS)) return true
  const hasAction = hasAnyTerm(text, BOOKING_ACTION_HINTS)
  const hasObject = hasAnyTerm(text, BOOKING_OBJECT_HINTS)
  if (hasAction && hasObject) return true
  // "please reserve this", "book this one", "take this slot"
  if (hasAction && hasSmartSlotReferenceSignal(text)) return true
  return false
}

export const hasSmartBookingConfirmationSignal = (textInput: string): boolean => {
  const text = normalize(textInput)
  if (!text) return false
  if (hasAnyTerm(text, BOOKING_CONFIRMATION_TERMS)) return true
  const hasAffirmative = hasAnyTerm(text, BOOKING_AFFIRMATION_HINTS)
  const hasBookingAction = hasAnyTerm(text, BOOKING_ACTION_HINTS)
  const hasBookingObject = hasAnyTerm(text, BOOKING_OBJECT_HINTS)
  const hasSlotReference = hasSmartSlotReferenceSignal(text)

  // "haan book kar do", "ok confirm", "yes this slot", "sure go ahead"
  if (hasAffirmative && (hasBookingAction || hasBookingObject || hasSlotReference)) return true
  if (hasBookingAction && (hasBookingObject || hasSlotReference)) return true
  return false
}

export const escapePostgrestLike = (value: string): string => (value || '').replace(/[%_]/g, '\\$&')

export const formatBookingSlotLabel = (date: string, startTime: string, endTime?: string): string => {
  if (!date || !startTime) return 'a flexible slot';
  
  // Format Date (Weekday, Day Month)
  const dayStr = new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  
  const formatTime = (time: string) => {
    try {
      const [hours, minutes] = time.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    } catch {
      return time;
    }
  };

  const startTimeStr = formatTime(startTime);
  const endTimeStr = endTime ? ` - ${formatTime(endTime)}` : '';

  return `📅 ${dayStr} [${startTimeStr}${endTimeStr}]`;
}

export const readPendingBookingProposal = (keyFacts: any[]): any | null => {
  const proposalFact = (keyFacts || []).find((f) => f.key === 'pending_booking_proposal')
  if (!proposalFact?.value) return null
  try { return JSON.parse(proposalFact.value) } catch { return null }
}

export const mergePendingBookingProposalIntoKeyFacts = (keyFacts: any[], proposal: any | null): any[] => {
  const filtered = (keyFacts || []).filter((f) => f.key !== 'pending_booking_proposal')
  if (!proposal) return filtered
  return [...filtered, { key: 'pending_booking_proposal', value: JSON.stringify(proposal) }]
}

export const hasConsultRecommendationCue = (text: string): boolean => {
  const lower = normalize(text)
  return hasAnyTerm(lower, ['consult a doctor', 'see a specialist', 'doctor se milo'])
}

export const extractTenScaleSeverity = (text: string): number | null => {
  const match = text.match(/\b([1-9]|10)\s*\/\s*10\b/)
  return match?.[1] ? Number(match[1]) : null
}

export const getTriageCoverage = (combinedUserText: string): any => {
  const text = normalize(combinedUserText)
  const onset =
    hasAnyTerm(text, ['since', 'started', 'kab se', 'aaj se', 'kal se', 'subah se', 'shaam se', 'raat se']) ||
    /\b\d+\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months)\b/.test(text)
  const severity =
    hasAnyTerm(text, ['mild', 'moderate', 'severe', 'pain scale', 'zyada', 'bahut', 'bohot', 'high fever', 'unbearable']) ||
    /\b([1-9]|10)\s*\/\s*10\b/.test(text) ||
    /\b(temperature|temp)\s*(is|:)?\s*\d{2,3}(\.\d)?\b/.test(text)
  const associated = hasAnyTerm(text, [
    'fever', 'nausea', 'vomit', 'bukhar', 'cough', 'cold', 'khansi', 'breath', 'breathing',
    'chills', 'rash', 'itch', 'diarrhea', 'loose motion', 'constipation', 'dizziness',
    'sweating', 'chest pain', 'throat', 'sore throat', 'weakness', 'body ache',
  ])
  const medicationContext = hasAnyTerm(text, [
    'medicine', 'medication', 'tablet', 'allergy', 'dawai', 'paracetamol', 'inhaler',
    'insulin', 'antibiotic', 'bp medicine', 'blood pressure medicine',
  ])
  return { onset, severity, associated, medicationContext, covered: [onset, severity, associated, medicationContext].filter(Boolean).length }
}

export const mergeTriageCoverage = (primary: any, secondary: any): any => {
  const onset = primary.onset || secondary.onset
  const severity = primary.severity || secondary.severity
  const associated = primary.associated || secondary.associated
  const medicationContext = primary.medicationContext || secondary.medicationContext
  return { onset, severity, associated, medicationContext, covered: [onset, severity, associated, medicationContext].filter(Boolean).length }
}

export const extractStoredCoverageCount = (summary: string): number => {
  const match = (summary || '').match(/triage coverage:\s*([0-4])\s*\/\s*4/i)
  return match?.[1] ? Number(match[1]) : 0
}

export const extractStoredTriageSetCount = (summary: string): number => {
  const match = (summary || '').match(/triage question sets used:\s*([0-2])\s*\/\s*2/i)
  return match?.[1] ? Number(match[1]) : 0
}

export const countTriageQuestionSetsFromHistory = (history: any[]): number => {
  const triageHints = ['when did', 'how long', 'kab se', 'severity', '1-10']
  return (history || []).filter(item => item.role === 'assistant' && item.content.includes('?') && triageHints.some(hint => normalize(item.content).includes(hint))).length
}

type ConcernTriageProfile = {
  id: string
  label: string
  terms: string[]
  onset: string
  severity: string
  associated: string
  medicationContext: string
  redFlags: string
}

const CONCERN_TRIAGE_PROFILES: ConcernTriageProfile[] = [
  {
    id: 'chest_pain',
    label: 'chest pain / heart symptoms',
    terms: ['heart health', 'heart', 'cardiology', 'cardiac', 'chest pain', 'seene me dard', 'seena dard', 'heart pain', 'palpitation', 'palpitations', 'left arm pain', 'jaw pain'],
    onset: 'Ask when the chest pain started, whether it began suddenly, and if it is still happening.',
    severity: 'Ask pain intensity from 1-10 and whether it feels like pressure, tightness, burning, or sharp pain.',
    associated: 'Ask about breathlessness, sweating, dizziness, nausea, or pain going to left arm/jaw/back.',
    medicationContext: 'Ask about BP/heart/diabetes history and current heart/BP medicines.',
    redFlags: 'Severe chest pressure, breathlessness, sweating, fainting, or pain radiating to arm/jaw needs urgent care.',
  },
  {
    id: 'breathing_cough',
    label: 'cough / breathing symptoms',
    terms: ['respiratory', 'pulmonology', 'lungs', 'lung', 'cough', 'khansi', 'cold', 'sardi', 'breath', 'breathing', 'breathless', 'wheezing', 'asthma', 'sore throat', 'throat pain'],
    onset: 'Ask how many days the cough/cold/breathing issue has been present.',
    severity: 'Ask whether breathing is difficult at rest, with walking, or only mild.',
    associated: 'Ask about fever, wheezing, chest pain, phlegm color, sore throat, and oxygen level if available.',
    medicationContext: 'Ask about inhaler use, allergies, asthma history, and medicines already taken.',
    redFlags: 'Breathlessness at rest, blue lips, chest pain, low oxygen, or high fever needs urgent care.',
  },
  {
    id: 'fever',
    label: 'fever / infection symptoms',
    terms: ['fever', 'bukhar', 'temperature', 'temp', 'viral', 'infection', 'body ache', 'chills'],
    onset: 'Ask when the fever started and whether it is continuous or coming and going.',
    severity: 'Ask the highest temperature reading and whether it crossed 102 F.',
    associated: 'Ask about chills, cough, sore throat, body pain, rash, burning urine, vomiting, or diarrhea.',
    medicationContext: 'Ask whether they took paracetamol/other medicines and any drug allergy.',
    redFlags: 'Very high fever, confusion, breathing difficulty, stiff neck, dehydration, or rash needs urgent care.',
  },
  {
    id: 'headache',
    label: 'headache / migraine symptoms',
    terms: ['headache', 'sir dard', 'sar dard', 'migraine', 'head pain', 'vision blur', 'aura'],
    onset: 'Ask when the headache started and whether it was sudden or the worst-ever headache.',
    severity: 'Ask severity from 1-10 and exact location of pain.',
    associated: 'Ask about vomiting, vision changes, weakness/numbness, fever, neck stiffness, or dizziness.',
    medicationContext: 'Ask about BP, migraine history, painkillers taken, and medicine allergies.',
    redFlags: 'Sudden worst headache, weakness, confusion, seizure, fever with stiff neck, or vision loss needs urgent care.',
  },
  {
    id: 'abdomen',
    label: 'stomach / digestion symptoms',
    terms: ['gastro', 'gastroenterology', 'digestion', 'digestive', 'stomach', 'abdomen', 'pet dard', 'pait dard', 'acidity', 'gas', 'vomit', 'nausea', 'diarrhea', 'loose motion', 'constipation', 'liver'],
    onset: 'Ask when it started and where exactly the pain/problem is located.',
    severity: 'Ask severity from 1-10 and whether pain is constant, cramping, burning, or after food.',
    associated: 'Ask about vomiting, diarrhea, blood in stool/vomit, fever, dehydration, or urinary symptoms.',
    medicationContext: 'Ask medicines taken, food trigger, acidity medicines, allergies, and pregnancy possibility where relevant.',
    redFlags: 'Severe worsening pain, blood, persistent vomiting, dehydration, fainting, or pregnancy with pain needs urgent care.',
  },
  {
    id: 'skin',
    label: 'skin / allergy symptoms',
    terms: ['dermatology', 'derma', 'skin', 'rash', 'acne', 'itch', 'itching', 'allergy', 'fungal', 'eczema', 'hives', 'swelling'],
    onset: 'Ask when the rash/itching started and whether it is spreading.',
    severity: 'Ask how severe the itching/pain/swelling is and which body area is involved.',
    associated: 'Ask about fever, pus, facial/lip swelling, breathing difficulty, or new food/product exposure.',
    medicationContext: 'Ask about allergy medicines, creams used, known allergies, and recent antibiotics.',
    redFlags: 'Lip/face swelling, breathing difficulty, rapidly spreading rash, fever with rash, or pus needs urgent care.',
  },
  {
    id: 'urinary',
    label: 'urinary / kidney symptoms',
    terms: ['urology', 'nephrology', 'urine', 'urinary', 'uti', 'burning urination', 'peshab', 'kidney', 'flank pain', 'blood in urine'],
    onset: 'Ask when urinary symptoms started and how often they are passing urine.',
    severity: 'Ask burning/pain severity and whether there is lower abdomen or side/back pain.',
    associated: 'Ask about fever, chills, blood in urine, vomiting, pregnancy, diabetes, or reduced urine.',
    medicationContext: 'Ask about antibiotics taken, kidney stone history, diabetes medicines, and allergies.',
    redFlags: 'Fever with back pain, blood in urine, vomiting, pregnancy, or very low urine needs urgent care.',
  },
  {
    id: 'gyne_pregnancy',
    label: 'period / pregnancy / women health symptoms',
    terms: ['gynecology', 'gynaecology', 'women health', 'period', 'pregnancy', 'pregnant', 'pcos', 'pcod', 'bleeding', 'vaginal', 'white discharge', 'cramps', 'missed period'],
    onset: 'Ask last period date, pregnancy possibility, and when the symptom started.',
    severity: 'Ask bleeding/pain severity and number of pads used if bleeding is present.',
    associated: 'Ask about dizziness, fever, foul discharge, severe lower abdomen pain, or vomiting.',
    medicationContext: 'Ask about contraceptive/hormonal medicines, pregnancy test result, and allergies.',
    redFlags: 'Pregnancy with pain/bleeding, heavy bleeding, fainting, fever, or severe one-sided pain needs urgent care.',
  },
  {
    id: 'child',
    label: 'child health symptoms',
    terms: ['pediatrics', 'paediatrics', 'child', 'kid', 'kids', 'baby', 'infant', 'newborn', 'baccha', 'bacha', 'pediatric', 'paediatric'],
    onset: 'Ask child age, weight if known, and when symptoms started.',
    severity: 'Ask temperature/pain severity and whether the child is feeding, drinking, and active.',
    associated: 'Ask about breathing difficulty, rash, vomiting, diarrhea, fewer wet diapers/urine, or sleepiness.',
    medicationContext: 'Ask medicines/dose already given and allergy history.',
    redFlags: 'Infant under 3 months with fever, breathing difficulty, dehydration, seizure, or extreme sleepiness needs urgent care.',
  },
  {
    id: 'mental_health',
    label: 'anxiety / mood / sleep symptoms',
    terms: ['psychiatry', 'mental health', 'anxiety', 'panic', 'depression', 'stress', 'sleep', 'insomnia', 'mood', 'suicide', 'self harm', 'dar lagna'],
    onset: 'Ask how long this has been happening and any trigger or recent change.',
    severity: 'Ask how much it affects sleep/work and whether there are panic attacks.',
    associated: 'Ask about low mood, appetite change, substance use, self-harm thoughts, or feeling unsafe.',
    medicationContext: 'Ask about psychiatric medicines, therapy, alcohol/drug use, and other medicines.',
    redFlags: 'Self-harm thoughts, feeling unsafe, severe agitation, or confusion needs urgent human help immediately.',
  },
  {
    id: 'metabolic',
    label: 'diabetes / BP / thyroid symptoms',
    terms: ['endocrinology', 'diabetes', 'sugar', 'glucose', 'insulin', 'hba1c', 'bp', 'blood pressure', 'hypertension', 'thyroid'],
    onset: 'Ask recent reading value, when it was checked, and whether this is new or ongoing.',
    severity: 'Ask how high/low the reading is and symptoms like dizziness, sweating, headache, chest pain, or weakness.',
    associated: 'Ask about thirst/urination, weight change, palpitations, swelling, or vision changes depending on the condition.',
    medicationContext: 'Ask current medicines, missed doses, recent diet/illness changes, and allergies.',
    redFlags: 'Very high BP with chest pain/headache/weakness, very low sugar, confusion, or fainting needs urgent care.',
  },
  {
    id: 'injury_ortho',
    label: 'injury / bone / joint symptoms',
    terms: ['orthopedic', 'orthopaedic', 'ortho', 'injury', 'fracture', 'sprain', 'joint', 'bone', 'back pain', 'knee pain', 'shoulder pain', 'neck pain', 'swelling after fall'],
    onset: 'Ask when it started and whether there was a fall, twist, or injury.',
    severity: 'Ask pain severity from 1-10 and whether they can move/use the limb.',
    associated: 'Ask about swelling, deformity, numbness, weakness, fever, or pain going down the leg/arm.',
    medicationContext: 'Ask painkillers used, existing bone/joint conditions, blood thinners, and allergies.',
    redFlags: 'Deformity, inability to bear weight, numbness/weakness, loss of bladder control, or major trauma needs urgent care.',
  },
]

const DEFAULT_TRIAGE_PROFILE: ConcernTriageProfile = {
  id: 'general',
  label: 'general symptoms',
  terms: [],
  onset: 'Ask when the main symptom started and whether it is improving or worsening.',
  severity: 'Ask severity from 1-10 and what makes it better or worse.',
  associated: 'Ask the most relevant associated symptoms based on the user concern, not a fixed generic list.',
  medicationContext: 'Ask medicines already taken, allergies, and important conditions like pregnancy, diabetes, BP, asthma, or heart disease if relevant.',
  redFlags: 'Severe pain, breathing difficulty, fainting, confusion, uncontrolled bleeding, or rapidly worsening symptoms need urgent care.',
}

export const getConcernTriageProfile = (concernText: string): ConcernTriageProfile => {
  const normalizedConcern = normalize(concernText || '')
  if (!normalizedConcern) return DEFAULT_TRIAGE_PROFILE

  let bestProfile = DEFAULT_TRIAGE_PROFILE
  let bestScore = 0
  for (const profile of CONCERN_TRIAGE_PROFILES) {
    const score = profile.terms.reduce((total, term) => {
      const normalizedTerm = normalize(term)
      return total + (normalizedTerm && normalizedConcern.includes(normalizedTerm) ? normalizedTerm.length : 0)
    }, 0)
    if (score > bestScore) {
      bestScore = score
      bestProfile = profile
    }
  }
  return bestProfile
}

export const getMissingTriageQuestions = (coverage: any, concernText = '') => {
  const profile = getConcernTriageProfile(concernText)
  const missing: string[] = []
  if (!coverage.onset) missing.push(profile.onset)
  if (!coverage.severity) missing.push(profile.severity)
  if (!coverage.associated) missing.push(profile.associated)
  if (!coverage.medicationContext) missing.push(profile.medicationContext)
  return missing
}

export const getConcernSpecificTriageGuidance = (concernText: string, coverage: any) => {
  const profile = getConcernTriageProfile(concernText)
  const missing = getMissingTriageQuestions(coverage || {}, concernText)
  const nextQuestion = missing[0] || 'If enough information is already present, give concise guidance or move to doctor recommendation/booking when the user asks.'
  return [
    `Concern focus: ${profile.label}.`,
    'Follow-up questions must feel like a doctor speaking to the patient. Use a natural conversational paragraph, not a title plus bullet checklist.',
    `Next missing detail priority: ${nextQuestion}`,
    `Concern-specific red flags to screen when relevant: ${profile.redFlags}`,
    'Ask only one clear follow-up question in voice mode. In text mode, ask at most two short doctor-like questions in one paragraph.',
    'Avoid headings like "Fever Symptoms", decorative emojis, and multi-bullet questionnaires for triage follow-ups.',
    'If the user asks for doctor suggestions, slots, or booking, proceed to that flow instead of continuing triage questions.',
  ].join(' ')
}

export const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')

export const looksDevanagari = (value: string): boolean => /[\u0900-\u097F]/.test(value || '')

export const parseIsoToMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export const formatBlockWait = (remainingMs: number): string => {
  const safeMs = Math.max(0, remainingMs)
  const totalMinutes = Math.ceil(safeMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${Math.max(1, minutes)}m`
}

export const joinUserHistoryText = (history: any[], latestMessage: string): string => {
  const prior = (history || []).filter(item => item?.role === 'user').map(item => item?.content || '').join(' ')
  return normalize(`${prior} ${latestMessage || ''}`)
}

export const normalizeHistory = (history: unknown): Array<{ role: string; content: string }> => {
  if (!Array.isArray(history)) return []
  return history.map((item: any) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: clipText(typeof item?.content === 'string' ? item.content : '', 520),
  })).filter((item) => item.content.length > 0).slice(-20)
}

export const formatDoctorContext = (doctors: any[], mode: string | null, bookingPrep?: BookingPreparation | null): string => {
  if (!doctors || doctors.length === 0) {
    return 'No doctors matching your specific request were found in the CD4 database. However, there may be specialists in other cities. Please advise the user to try a broader search or search the web.'
  }

  let header = 'Verified doctors currently available on the CD4 app:';
  if (mode === 'web') {
    header = 'Results from verified external health sources (Web Search):';
  } else if (mode === 'related_specialty') {
    header = 'I could not find an exact specialist in your city right now, but these related verified doctors can help with your concern:';
  } else if (mode === 'local_any') {
    header = 'I haven\'t found a specific specialist in your city yet, but here are other verified doctors available in your city:';
  } else if (mode === 'all_app_specialty') {
    header = 'I could not find that specialist in your selected city right now, but here are verified doctors of the same specialty across the CD4 network:';
  } else if (mode === 'all_app') {
    header = 'I found these highly recommended doctors across our network:';
  } else if (mode === 'global_network') {
    header = 'I couldn\'t find a specific specialist in your exact city yet, but here are the highest-rated doctors from the CD4 network:';
  }

  const list = doctors.map((d, i) => {
    const fname = d.firstName || d.profiles?.first_name || '';
    const lname = d.lastName || d.profiles?.last_name || '';
    let name = (fname || lname) ? `${fname} ${lname}`.trim() : (d.name || 'Professional Specialist');
    if (name && !name.match(/^(Dr\.?|DR\.?)\s+/i)) {
      name = `Dr. ${name}`;
    }
    
    const loc = d.city || d.location || 'India';
    const spec = d.specialization || d.specialty || '';
    return `${i + 1}. **${name}** (ID: ${d.id || d._id}) - ${spec} in ${loc}${d.experience ? ` - ${d.experience} Exp.` : ''}${d.rating ? ` - ${d.rating} Rating` : ''}`;
  }).join('\n');

  let context = `${header}\n${list}\n\nSTRICT ACCURACY RULE: 
1. Only recommend the doctors listed ABOVE. 
2. IGNORE any doctors mentioned earlier in the conversation history if they are not in the list above. 
3. NEVER guess or hallucinate doctor names (like Apollo or Paras) from your training data.
4. If the list above is empty, you MUST say "I couldn't find any verified doctors in the CD4 database for your specific request yet. You can try searching our global network or ask me to search the web." 
5. Mention the doctors by their actual names to build trust.`;

  if (bookingPrep?.status === 'confirm_pending' && bookingPrep?.proposal?.slotLabel) {
    const pendingSlotLabel = String(bookingPrep.proposal.slotLabel || '').trim()
    context += `\n\nSELECTED SLOT PENDING FINAL CONFIRMATION:\n- ${pendingSlotLabel}\n\nINSTRUCTION: The user has already picked this slot. Ask only for final confirmation to proceed. DO NOT ask them to choose the doctor again and DO NOT relist all slot options unless they ask to change the slot.`
  } else if (bookingPrep?.status === 'ready' && bookingPrep.slotOptions?.length) {
    const slotsList = bookingPrep.slotOptions.map(s => `- ${s.label} (Slot ID: ${s.id})`).join('\n')
    context += `\n\nAVAILABLE SLOTS for the selected doctor:\n${slotsList}\n\nINSTRUCTION: Present these specific slots to the user and ask which one they would like to book. DO NOT guess times; only use the IDs provided.`
  } else if (bookingPrep?.status === 'no_slots') {
    context += `\n\nBOOKING STATUS: This doctor currently has no available slots in our system. You can suggest the user contact them later or try another specialist.`
  }

  return context;
}
