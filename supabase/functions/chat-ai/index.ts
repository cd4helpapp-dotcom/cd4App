// @ts-nocheck
import {
  corsHeaders,
  AI_MESSAGE_LIMIT_PER_WINDOW,
  AI_RATE_LIMIT_TZ_OFFSET_MINUTES,
  CHAT_HISTORY_SEND_ITEMS,
  CHAT_HISTORY_MAX_CHARS,
  GEMINI_MAX_OUTPUT_TOKENS,
  AUTONOMOUS_AGENT_ENABLED,
  PREFETCH_DOCTORS_BEFORE_AI,
  INCLUDE_TOP_DOCTORS_IN_PROMPT,
  SYSTEM_PROMPT_MEMORY_CLIP,
  SYSTEM_PROMPT_TOOL_CONTEXT_CLIP,
  DOCTOR_RECOMMENDATION_LIMIT,
  normalize,
  clipText,
  normalizeCityInput,
  isAssistantConcern,
  detectLanguageStyle,
  getLanguageInstruction,
  formatAiReplyForPremiumMarkdown,
  createStreamingResponse,
  asksMedicineQuestion,
  hasDangerSignal,
  isGreetingOnlyMessage,
  hasSymptomSignal,
  hasPersonalHealthContext,
  hasAnyTerm,
  formatBlockWait,
  looksDevanagari,
  isUuid,
  getMissingTriageQuestions,
  extractStoredCoverageCount,
  extractStoredTriageSetCount,
  mergeTriageCoverage,
  getTriageCoverage,
  joinUserHistoryText,
  normalizeHistory,
  countTriageQuestionSetsFromHistory,
  extractTenScaleSeverity,
  formatBookingSlotLabel,
  readPendingBookingProposal,
  mergePendingBookingProposalIntoKeyFacts,
  hasConsultRecommendationCue,
  hasSmartDoctorSearchSignal,
  hasLocalDoctorSearchPreference,
  hasSmartBookingPrepareSignal,
  hasSmartBookingConfirmationSignal,
  buildTriageFollowUpReply,
  BOOKING_PREPARE_INTENT_TERMS,
  BOOKING_CONFIRMATION_TERMS,
  BOOKING_DECLINE_TERMS,
  DOCTOR_SEARCH_INTENT_TERMS,
  GENERIC_SEARCH_FOLLOWUP_TERMS,
  RECORD_TOOL_INTENT_TERMS,
  VITALS_TOOL_INTENT_TERMS,
  ESCALATION_TOOL_INTENT_TERMS,
  DEPARTMENT_CATALOG,
  formatDoctorContext
} from "./shared.ts"
import {
  createServiceRoleClient,
  extractAndValidateCityFromText,
  resolveDoctorRecommendationsWithFallback,
  runAutonomousToolLoop,
  readConversationMemory,
  upsertConversationMemory,
  extractEntitiesWithAI,
  evaluateAiMessageRateLimit,
  logAgentAction,
  getEscalationPriorityRank,
  invokeOpenAIWithRetry,
  invokeGeminiWithRetry,
  buildSystemPrompt,
  getAuthenticatedUser,
  incrementAiUsageStats
} from "./tools.ts"

const BOOKING_SUCCESS_CLAIM_REGEX =
  /\b(booked|booking done|booking confirmed|appointment confirmed|appointment booked|slot booked|book ho g(ya|yi)|book kar diya|confirm(ed)? ho g(ya|yi)|appointment ho g(ya|yi))\b/i

const hasFalseBookingSuccessClaim = (reply: string): boolean => {
  const normalizedReply = normalize(reply || '')
  if (!normalizedReply) return false
  if (normalizedReply.includes('not booked') || normalizedReply.includes('not confirmed')) return false
  return BOOKING_SUCCESS_CLAIM_REGEX.test(normalizedReply)
}

const buildNotConfirmedBookingMessage = (bookingConfirmation: any, bookingPrep: any): string => {
  const reason =
    typeof bookingConfirmation?.message === 'string' && bookingConfirmation.message.trim().length > 0
      ? bookingConfirmation.message.trim()
      : bookingPrep?.status === 'ready'
        ? 'A slot is selected but confirmation is still pending.'
        : 'Booking could not be completed in database.'

  const nextStep =
    bookingPrep?.status === 'ready' && Array.isArray(bookingPrep?.slotOptions) && bookingPrep.slotOptions.length > 0
      ? 'Please pick one of the shown slots and say: "book this slot".'
      : 'Please retry booking after selecting a valid available slot.'

  return `Important: Appointment is NOT booked yet. ${reason} ${nextStep}`
}

const buildHealthOnlyScopeReply = (messageText: string): string => {
  const raw = messageText || ''
  const normalizedMessage = normalize(raw)
  const looksHindiRoman =
    /\b(kya|kaise|mujhe|mera|meri|mere|hai|nahi|doctor|dawai|bukhar|dard|ilaaj|treatment|appointment|slot)\b/.test(
      normalizedMessage,
    )

  if (looksDevanagari(raw) || looksHindiRoman) {
    return 'Main sirf health aur teleconsultation se related madad kar sakta hoon. Kripya symptoms, reports, medicines, doctor recommendations, ya appointment booking se related sawal poochiye.'
  }

  return 'I can only help with health and teleconsultation-related questions. Please ask about symptoms, reports, medicines, doctor recommendations, or appointment booking.'
}

const normalizeSummaryLine = (value: string, maxChars: number): string =>
  clipText(String(value || '').replace(/\s+/g, ' ').trim(), maxChars)

const keepLastChars = (value: string, maxChars: number): string => {
  const text = String(value || '').trim()
  if (text.length <= maxChars) return text
  return text.slice(text.length - maxChars)
}

const buildRollingSummary = (
  previousSummary: string,
  latestUserMessage: string,
  latestAiReply: string,
): string => {
  const summaryLimit = Math.max(500, SYSTEM_PROMPT_MEMORY_CLIP * 3)
  const prev = normalizeSummaryLine(previousSummary || '', Math.max(220, summaryLimit - 280))
  const userLine = normalizeSummaryLine(latestUserMessage || '', 220)
  const aiLine = normalizeSummaryLine(latestAiReply || '', 420)
  const latestTurn = `Latest turn:\nUser: ${userLine}\nAssistant: ${aiLine}`
  const merged = prev ? `${prev}\n${latestTurn}` : latestTurn
  return keepLastChars(merged, summaryLimit)
}

const CONSULT_FOLLOWUP_INTENT_REGEX =
  /\b(yes|haan|han|hanji|ok|okay|sure|theek hai|thik hai|go ahead|proceed|appointment|book appointment|doctor chahiye|doctor dikhao|doctor batao|find doctor|consult doctor|consultation|doctor se milna)\b/i

const hasConsultSearchFollowupSignal = (text: string): boolean => CONSULT_FOLLOWUP_INTENT_REGEX.test(normalize(text || ''))

const hasAppWideDoctorDirectoryIntent = (text: string): boolean => {
  const normalizedText = normalize(text || '')
  if (!normalizedText) return false
  const hasDoctorTerm = /\b(doctor|doctors|specialist|specialists|physician)\b/.test(normalizedText)
  if (!hasDoctorTerm) return false

  // Examples: "total doctor on this app", "how many doctors in app", "app me kitne doctor"
  const hasCountCue = /\b(total|count|number|how many|kitne|kitna|kitni|all|sab|sare|saare)\b/.test(normalizedText)
  const hasAppScopeCue = /\b(app|platform|cd4|network|across app|poore app|pure app|is app)\b/.test(normalizedText)

  return hasCountCue && hasAppScopeCue
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const hasTermBoundaryMatch = (text: string, term: string): boolean => {
  if (!text || !term) return false
  if (term.length >= 4) return text.includes(term)
  return new RegExp(`\\b${escapeRegex(term)}\\b`).test(text)
}

const resolveMessageDepartmentMatch = (textInput: string): { id: string; label: string; confidence: number } | null => {
  const messageNeedle = normalize(textInput || '')
  if (!messageNeedle) return null

  let bestMatch: { id: string; label: string; score: number } | null = null

  for (const department of DEPARTMENT_CATALOG) {
    const candidateTerms = Array.from(
      new Set([department.label, ...(Array.isArray(department.keywords) ? department.keywords : [])]),
    )
    for (const term of candidateTerms) {
      const normalizedTerm = normalize(term || '')
      if (!normalizedTerm) continue
      if (!hasTermBoundaryMatch(messageNeedle, normalizedTerm)) continue

      const score = normalizedTerm.split(' ').length * 12 + normalizedTerm.length
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { id: department.id, label: department.label, score }
      }
    }
  }

  if (!bestMatch) return null
  return { id: bestMatch.id, label: bestMatch.label, confidence: 0.9 }
}

const DOCTOR_MENTION_REGEX = /\bdr\.?\s+[a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2}/gi

const normalizeDoctorNameForMatch = (value: string): string =>
  normalize(
    (value || '')
      .replace(/\bdr\.?\s*/gi, ' ')
      .replace(/[^a-z\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )

const getDoctorProfileNode = (doctor: any): any => (Array.isArray(doctor?.profiles) ? doctor.profiles[0] : doctor?.profiles)

const getDoctorDisplayName = (doctor: any, fallbackIndex: number): string => {
  const profile = getDoctorProfileNode(doctor)
  const firstName = String(doctor?.firstName || profile?.first_name || '').trim()
  const lastName = String(doctor?.lastName || profile?.last_name || '').trim()
  const joined = `${firstName} ${lastName}`.trim()
  if (joined) return joined
  return `Doctor ${fallbackIndex + 1}`
}

const getDoctorSpecialization = (doctor: any): string =>
  clipText(String(doctor?.specialization || doctor?.specialty || '').trim(), 60)

const getDoctorCity = (doctor: any): string =>
  clipText(String(doctor?.city || doctor?.location || '').trim(), 40)

const collectAllowedDoctorNames = (doctors: any[]): string[] => {
  const set = new Set<string>()
  for (const [index, doctor] of (doctors || []).entries()) {
    const fullName = normalizeDoctorNameForMatch(getDoctorDisplayName(doctor, index))
    if (fullName.length >= 3) {
      set.add(fullName)
      const parts = fullName.split(/\s+/).filter(Boolean)
      if (parts[0] && parts[0].length >= 3) set.add(parts[0])
      if (parts.length > 1) {
        const last = parts[parts.length - 1]
        if (last.length >= 3) set.add(last)
      }
    }
  }
  return Array.from(set)
}

const extractDoctorMentionsFromReply = (reply: string): string[] => {
  const matches = (reply || '').match(DOCTOR_MENTION_REGEX) || []
  return matches
    .map((item) => normalizeDoctorNameForMatch(item))
    .filter((item) => item.length >= 3)
}

const isAllowedDoctorMention = (mention: string, allowedNames: string[]): boolean => {
  for (const allowed of allowedNames) {
    if (!allowed) continue
    if (mention === allowed) return true
    if (mention.includes(allowed) || allowed.includes(mention)) return true
  }
  return false
}

const hasDoctorLikeMention = (reply: string): boolean => /\bdr\.?\s+[a-z]/i.test(reply || '')

const hasAnyAllowedDoctorMention = (reply: string, allowedNames: string[]): boolean => {
  const mentions = extractDoctorMentionsFromReply(reply)
  if (!mentions.length) return false
  return mentions.some((mention) => isAllowedDoctorMention(mention, allowedNames))
}

const hasUnapprovedDoctorMention = (reply: string, allowedNames: string[]): boolean => {
  const mentions = extractDoctorMentionsFromReply(reply)
  if (!mentions.length) return false
  return mentions.some((mention) => !isAllowedDoctorMention(mention, allowedNames))
}

const getLatestAssistantContextArray = (historyPayload: any[], key: 'doctorRecommendations' | 'bookingSlotOptions'): any[] => {
  if (!Array.isArray(historyPayload)) return []
  for (let index = historyPayload.length - 1; index >= 0; index -= 1) {
    const item = historyPayload[index]
    if (item?.role === 'assistant' && Array.isArray(item?.[key]) && item[key].length > 0) {
      return item[key]
    }
  }
  return []
}

const buildAppOnlyDoctorReply = (args: {
  doctors: any[]
  bookingPrep: any
  bookingConfirmation?: any
  cityLabel?: string | null
  specialtyLabel?: string | null
  recommendationMode?: string | null
  forceDoctorCount?: boolean
}): string => {
  const doctors = Array.isArray(args.doctors) ? args.doctors : []
  if (args.bookingConfirmation?.status === 'confirmed') {
    const doctorName = String(args.bookingConfirmation?.doctorName || 'the selected doctor').trim()
    const slotLabel = String(args.bookingConfirmation?.slotLabel || '').trim()
    return slotLabel
      ? `### Appointment Confirmed\nYour appointment with **${doctorName}** is confirmed for **${slotLabel}**.`
      : `### Appointment Confirmed\nYour appointment with **${doctorName}** is confirmed.`
  }
  if (args.bookingPrep?.status === 'confirm_pending') {
    const slotLabel = String(args.bookingPrep?.proposal?.selectedSlotLabel || '').trim()
    const fallbackDoctor = Array.isArray(args.doctors) && args.doctors.length > 0
      ? getDoctorDisplayName(args.doctors[0], 0)
      : 'the selected doctor'
    const doctorLabel = fallbackDoctor === 'the selected doctor' ? fallbackDoctor : `Dr. ${fallbackDoctor}`
    return slotLabel
      ? `### Slot Selected\nYou selected **${slotLabel}** with **${doctorLabel}**.\n\nPlease confirm and I will book this exact slot.`
      : `### Slot Selected\nPlease confirm and I will book the selected slot with the chosen doctor.`
  }
  if (args.bookingPrep?.status === 'no_slots') {
    const doctorName = doctors.length > 0 ? ` for **Dr. ${getDoctorDisplayName(doctors[0], 0)}**` : ''
    return `### No Slots Available\nNo future slots are currently available${doctorName} in the CD4 app.\n\nPlease choose another doctor or ask me to check again later.`
  }
  if (args.bookingPrep?.status === 'error' || args.bookingPrep?.status === 'incomplete') {
    const message = String(args.bookingPrep?.message || '').trim()
    return message || 'Please tell me which doctor and exact slot you want to book.'
  }
  const slotOptions = Array.isArray(args.bookingPrep?.slotOptions) ? args.bookingPrep.slotOptions : []
  const slotLines = slotOptions
    .slice(0, DOCTOR_RECOMMENDATION_LIMIT)
    .map((slot: any, index: number) => `${index + 1}. ${String(slot?.label || '').trim()}`)
    .filter((line: string) => line.trim().length > 0)

  if (!doctors.length && slotLines.length > 0) {
    return `### Available Slots\n${slotLines.join('\n')}\n\nPlease tell me the exact slot number or time to select. I will ask once more before booking.`
  }
  if (!doctors.length) {
    return 'I could not find any verified CD4 doctors in the app for this request right now. Please change city or specialty and I will search again.'
  }

  const doctorLines = doctors.slice(0, DOCTOR_RECOMMENDATION_LIMIT).map((doctor, index) => {
    const name = getDoctorDisplayName(doctor, index)
    const specialization = getDoctorSpecialization(doctor)
    const city = getDoctorCity(doctor)
    const metaParts = [specialization, city].filter((part) => part.length > 0)
    const meta = metaParts.length > 0 ? ` - ${metaParts.join(', ')}` : ''
    return `${index + 1}. **Dr. ${name}**${meta}`
  })

  const normalizedCity = String(args.cityLabel || '').trim()
  const normalizedSpecialty = String(args.specialtyLabel || '').trim()
  const recommendationMode = String(args.recommendationMode || '').trim()
  let title = normalizedCity ? `### Verified CD4 Doctors in ${normalizedCity}` : '### Verified CD4 Doctors'
  let contextLine = ''

  if (recommendationMode === 'exact') {
    if (normalizedCity && normalizedSpecialty) {
      title = `### Verified ${normalizedSpecialty} Doctors in ${normalizedCity}`
    } else if (normalizedSpecialty) {
      title = `### Verified ${normalizedSpecialty} Doctors`
    }
  } else if (recommendationMode === 'all_app_specialty') {
    title = normalizedSpecialty
      ? `### Verified ${normalizedSpecialty} Doctors Across the CD4 App`
      : '### Verified Doctors Across the CD4 App'
    if (normalizedCity && normalizedSpecialty) {
      contextLine = `I couldn't find a verified **${normalizedSpecialty}** doctor in **${normalizedCity}** right now, so here are the best matching doctors from across the CD4 app.\n\n`
    }
  } else if (recommendationMode === 'related_specialty') {
    title = normalizedCity ? `### Related Verified Doctors in ${normalizedCity}` : '### Related Verified CD4 Doctors'
    if (normalizedSpecialty) {
      contextLine = `I couldn't find an exact **${normalizedSpecialty}** match${normalizedCity ? ` in **${normalizedCity}**` : ''}, but these related doctors can still help with the same concern.\n\n`
    }
  } else if (recommendationMode === 'local_any') {
    title = normalizedCity ? `### Verified CD4 Doctors in ${normalizedCity}` : '### Verified CD4 Doctors'
    if (normalizedSpecialty && normalizedCity) {
      contextLine = `I couldn't find a verified **${normalizedSpecialty}** doctor in **${normalizedCity}** right now, so here are other verified doctors available there.\n\n`
    }
  } else if (recommendationMode === 'all_app') {
    title = '### Verified Doctors Across the CD4 App'
    if (normalizedSpecialty) {
      contextLine = `I couldn't find a verified **${normalizedSpecialty}** doctor in the app right now, so here are other verified doctors from across the CD4 network.\n\n`
    } else if (normalizedCity) {
      contextLine = `I couldn't find matching doctors in **${normalizedCity}** right now, so here are verified doctors from across the CD4 network.\n\n`
    }
  }
  const countLine =
    args.forceDoctorCount
      ? `Showing top **${doctors.length}** verified ${doctors.length === 1 ? 'doctor' : 'doctors'} from app results.\n\n`
      : ''

  let reply = `${title}\n${contextLine}${countLine}${doctorLines.join('\n')}`
  if (slotLines.length > 0) {
    reply += `\n\n### Available Slots\n${slotLines.join('\n')}\n\nPlease tell me the exact slot number or time to select. I will ask once more before booking.`
  }
  return reply
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let streamRequested = false

  try {
    const requestAuthHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
    const requestAccessToken = requestAuthHeader.toLowerCase().startsWith('bearer ')
      ? requestAuthHeader.slice(7).trim()
      : ''
    
    const { userId, profile: userProfile, error: authError } = await getAuthenticatedUser(req)
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ success: false, message: authError || 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const requestStartedAt = Date.now()
    const payload = await req.json()
    streamRequested = Boolean(payload?.stream)
    const quotaOnlyRequested = Boolean(payload?.quotaOnly || payload?.rateLimitOnly)
    const fastResponseRequested = Boolean(payload?.fastResponse || payload?.replyInVoice || payload?.quick)
    const voiceReplyRequested = Boolean(payload?.replyInVoice)

    const messageText = typeof payload?.message === 'string' ? payload.message.trim() : ''
    const concernText = clipText(payload?.concern || 'General', 80)
    const locationCity = normalizeCityInput(payload?.locationCity)
    const normalizedMode = normalize(payload?.mode || payload?.variant || '')
    const assistantMode = normalizedMode === 'assistant' || isAssistantConcern(concernText)
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : null
    const serviceClient = createServiceRoleClient()
    const rateLimitState = await evaluateAiMessageRateLimit({ serviceClient, userId, conversationId })

    if (quotaOnlyRequested) {
      const quotaPayload = {
        success: true,
        data: {
          quotaOnly: true,
          transport: streamRequested ? 'sse' : 'json',
          rateLimit: rateLimitState,
        },
      }
      return streamRequested
        ? createStreamingResponse(quotaPayload)
        : new Response(JSON.stringify(quotaPayload), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
    }

    if (!messageText) {
      throw new Error('Message is required')
    }

    const geminiApiKey = (Deno.env.get('GEMINI_API_KEY') || '').trim()
    const openAiApiKey = (Deno.env.get('OPENAI_API_KEY') || '').trim()
    const normalizedMessageText = normalize(messageText)
    const likelyDoctorSearchFromText =
      hasSmartDoctorSearchSignal(messageText) ||
      hasAnyTerm(normalizedMessageText, DOCTOR_SEARCH_INTENT_TERMS)

    let speculativeDoctorSearchPromise: Promise<any> | null = null;
    if (likelyDoctorSearchFromText) {
      const explicitUiCity = normalizeCityInput(payload?.searchAreaCity) || normalizeCityInput(payload?.preferredCity);
      const regexCity = await extractAndValidateCityFromText(messageText, serviceClient);
      const searchAreaCityHeur = regexCity || explicitUiCity || locationCity || null;
      
      const messageDepartmentMatch = resolveMessageDepartmentMatch(messageText);
      const concernDepartmentMatch = resolveMessageDepartmentMatch(concernText);
      const departmentHeur = messageDepartmentMatch || concernDepartmentMatch;

      console.log(`[AI Speculative Prefetch] Starting parallel doctor search for specialty: ${departmentHeur?.label} and city: ${searchAreaCityHeur}`);
      
      speculativeDoctorSearchPromise = resolveDoctorRecommendationsWithFallback({
        serviceClient,
        departmentSuggestion: departmentHeur,
        locationCity,
        searchAreaCity: searchAreaCityHeur,
        latestMessageText: messageText
      }).catch(err => {
        console.warn('[AI Speculative Prefetch] Speculative doctor recommendations failed:', err?.message);
        return null;
      });
    }

    // 1. Context & History (Define 'history' before extraction)
    const history = normalizeHistory(payload?.history)

    // 2. Smart AI Entity Extraction
    const greetingOnlyMessage = isGreetingOnlyMessage(messageText)
    let aiEntities = {
      city: null,
      specialty: null,
      intent: null,
      urgency: null,
      scope: null,
      scope_reason: null,
      scope_model: null,
    }
    const historyHasBookingContext = Array.isArray(payload?.history)
      ? payload.history.some((item: any) =>
          item?.role === 'assistant' && (
            (Array.isArray(item?.bookingSlotOptions) && item.bookingSlotOptions.length > 0) ||
            (Array.isArray(item?.doctorRecommendations) && item.doctorRecommendations.length > 0) ||
            (typeof item?.bookingPrompt === 'string' && item.bookingPrompt.trim().length > 0)
          )
        )
      : false
    const historyHasConsultRecommendationContext = Array.isArray(payload?.history)
      ? payload.history.some((item: any) =>
          item?.role === 'assistant' && (
            item?.consultRecommended === true ||
            (item?.departmentSuggestion && typeof item.departmentSuggestion?.id === 'string') ||
            hasConsultRecommendationCue(typeof item?.content === 'string' ? item.content : '')
          )
        )
      : false
    const consultRecommendationFollowupSignal =
      historyHasConsultRecommendationContext &&
      hasConsultSearchFollowupSignal(messageText)
    const likelyBookingFromText =
      hasSmartBookingPrepareSignal(messageText) ||
      hasSmartBookingConfirmationSignal(messageText) ||
      hasAnyTerm(normalizedMessageText, BOOKING_PREPARE_INTENT_TERMS) ||
      hasAnyTerm(normalizedMessageText, BOOKING_CONFIRMATION_TERMS)
    const personalHealthContextHint =
      hasPersonalHealthContext(messageText) &&
      /\b(symptom|symptoms|doctor|doctors|medicine|medicines|tablet|report|reports|test|scan|pain|fever|cough|cold|headache|migraine|rash|allergy|infection|breath|breathing|period|pregnancy|sugar|bp|thyroid|diabetes|bukhar|dard|dawai|ilaaj|treatment)\b/.test(
        normalizedMessageText,
      )
    const likelyHealthScopeFromText =
      likelyDoctorSearchFromText ||
      likelyBookingFromText ||
      hasSymptomSignal(messageText) ||
      personalHealthContextHint ||
      asksMedicineQuestion(messageText) ||
      hasConsultRecommendationCue(messageText)
    const shouldRunAiEntityExtraction = Boolean(openAiApiKey) && (
      !fastResponseRequested ||
      historyHasBookingContext ||
      likelyBookingFromText ||
      likelyDoctorSearchFromText ||
      !likelyHealthScopeFromText ||
      greetingOnlyMessage
    )
    if (shouldRunAiEntityExtraction) {
      aiEntities = await extractEntitiesWithAI({
        text: messageText,
        apiKey: openAiApiKey,
        serviceClient,
        history,
        fastMode: fastResponseRequested,
      })
    }

    // 3. City Priority Waterfall
    // Priority: city mentioned in current message > manually selected UI city > saved location city.
    // This prevents default location (e.g., Patna) from overriding explicit asks like "find doctor in Chandigarh".
    const explicitUiCity = normalizeCityInput(payload?.searchAreaCity) || normalizeCityInput(payload?.preferredCity)
    const aiExtractedCity = normalizeCityInput(aiEntities.city)
    const regexCity = await extractAndValidateCityFromText(messageText, serviceClient)
    const messageCity = aiExtractedCity || regexCity
    const localDoctorSearchPreference =
      hasLocalDoctorSearchPreference(messageText) ||
      Boolean(explicitUiCity) ||
      consultRecommendationFollowupSignal
    let searchAreaCity =
      messageCity ||
      explicitUiCity ||
      (localDoctorSearchPreference ? locationCity : null)
    const explicitAppWideDoctorDirectoryIntent = hasAppWideDoctorDirectoryIntent(messageText)
    if (explicitAppWideDoctorDirectoryIntent) {
      searchAreaCity = null
    }
    const messageDepartmentMatch = resolveMessageDepartmentMatch(messageText)
    const concernDepartmentMatch = likelyDoctorSearchFromText ? null : resolveMessageDepartmentMatch(concernText)
    const heuristicDepartmentMatch = messageDepartmentMatch || concernDepartmentMatch
    const hasExplicitSpecialtyInLatestMessage = Boolean(messageDepartmentMatch)
    const genericDoctorDirectoryQueryHint =
      explicitAppWideDoctorDirectoryIntent ||
      (
        likelyDoctorSearchFromText &&
        !hasExplicitSpecialtyInLatestMessage &&
        !payload?.departmentId &&
        !payload?.departmentLabel &&
        !hasSymptomSignal(messageText) &&
        !hasDangerSignal(messageText)
      )

    // 4. Department Suggestions
    let departmentSuggestion = null
    if (payload?.departmentId && payload?.departmentLabel) {
      departmentSuggestion = { id: payload.departmentId, label: payload.departmentLabel, confidence: 1.0 }
    } else if (messageDepartmentMatch) {
      departmentSuggestion = messageDepartmentMatch
    } else if (aiEntities.specialty) {
      if (!genericDoctorDirectoryQueryHint) {
        const specialtyNeedle = normalize(aiEntities.specialty || '')
        const matched = DEPARTMENT_CATALOG.find(d =>
          normalize(d.label).includes(specialtyNeedle) ||
          specialtyNeedle.includes(normalize(d.label)) ||
          d.keywords.some(k => {
            const normalizedKeyword = normalize(k)
            return normalizedKeyword.includes(specialtyNeedle) || specialtyNeedle.includes(normalizedKeyword)
          })
        )
        if (matched) {
          departmentSuggestion = { id: matched.id, label: matched.label, confidence: 0.9 }
        }
      }
    }
    if (!departmentSuggestion && !genericDoctorDirectoryQueryHint) {
      if (heuristicDepartmentMatch) {
        departmentSuggestion = { id: heuristicDepartmentMatch.id, label: heuristicDepartmentMatch.label, confidence: 0.78 }
      }
    }
    if (!departmentSuggestion && !genericDoctorDirectoryQueryHint && Array.isArray(payload?.history)) {
      for (let index = payload.history.length - 1; index >= 0; index -= 1) {
        const item = payload.history[index]
        if (
          item?.role === 'assistant' &&
          item?.departmentSuggestion &&
          typeof item.departmentSuggestion?.id === 'string' &&
          typeof item.departmentSuggestion?.label === 'string'
        ) {
          departmentSuggestion = {
            id: item.departmentSuggestion.id,
            label: item.departmentSuggestion.label,
            confidence: 0.72,
          }
          break
        }
      }
    }
    if (genericDoctorDirectoryQueryHint) {
      departmentSuggestion = null
    }

    // 5. Rate Limiting
    if (rateLimitState.blocked) {
      const isProTier = Boolean(rateLimitState?.isPro)
      const waitLabel = formatBlockWait(Number(rateLimitState?.retryAfterMs || 0))
      const userFacingReply = isProTier
        ? `Your current Pro daily AI limit is reached. Please try again in about **${waitLabel}**.`
        : `Usage limit reached. Please **Upgrade to Pro** for higher daily AI limits.`
      
      const blockedPayload = { success: true, data: { reply: userFacingReply, rateLimit: rateLimitState } }
      blockedPayload.data.transport = streamRequested ? 'sse' : 'json'
      return streamRequested ? createStreamingResponse(blockedPayload) : new Response(JSON.stringify(blockedPayload), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const medicineQuery = asksMedicineQuestion(messageText)
    const languageStyle = detectLanguageStyle(messageText, history)
    const languageInstruction = getLanguageInstruction(languageStyle)
    const combinedUserText = joinUserHistoryText(history, messageText)
    const latestUserText = normalizedMessageText
    const dangerFromUserInput = hasDangerSignal(`${concernText} ${combinedUserText}`)
    
    const memoryRecord = fastResponseRequested
      ? { summary: '', keyFacts: [] as any[] }
      : await readConversationMemory({ serviceClient, conversationId, userId })
    const pendingBookingProposal = readPendingBookingProposal(memoryRecord.keyFacts || [])
    let triageCoverage = getTriageCoverage(combinedUserText)
    if (!fastResponseRequested) {
      const storedCoverageCount = extractStoredCoverageCount(memoryRecord.summary || '')
      const mergedCoverage = mergeTriageCoverage(triageCoverage, getTriageCoverage(memoryRecord.summary || ''))
      triageCoverage = { ...mergedCoverage, covered: Math.max(mergedCoverage.covered, storedCoverageCount) }
    }

    // 6. Intent Detection (Smart Fallback)
    const aiIntent = aiEntities.intent
    const aiUrgency = aiEntities.urgency
    const aiScope = typeof aiEntities?.scope === 'string' ? aiEntities.scope.trim().toLowerCase() : ''
    const aiScopeReason =
      typeof aiEntities?.scope_reason === 'string' ? clipText(aiEntities.scope_reason.trim(), 120) : null
    const aiScopeModel =
      typeof aiEntities?.scope_model === 'string' && aiEntities.scope_model.trim().length > 0
        ? aiEntities.scope_model.trim()
        : null

    const recordToolIntent = aiIntent === 'triage' // Or check for specific terms
    const vitalsToolIntent = hasAnyTerm(latestUserText, VITALS_TOOL_INTENT_TERMS)
    const doctorSearchFollowupIntent =
      historyHasBookingContext &&
      hasAnyTerm(latestUserText, GENERIC_SEARCH_FOLLOWUP_TERMS)
    const consultRecommendationFollowupIntent = consultRecommendationFollowupSignal
    const doctorSearchIntent =
      aiIntent === 'search' ||
      likelyDoctorSearchFromText ||
      doctorSearchFollowupIntent ||
      consultRecommendationFollowupIntent ||
      (aiIntent === null && hasAnyTerm(latestUserText, DOCTOR_SEARCH_INTENT_TERMS))
    const bookingPrepareIntent =
      aiIntent === 'book' ||
      hasSmartBookingPrepareSignal(messageText) ||
      (aiIntent === null && hasAnyTerm(latestUserText, BOOKING_PREPARE_INTENT_TERMS))
    const bookingConfirmIntent =
      aiIntent === 'confirm' ||
      hasSmartBookingConfirmationSignal(messageText) ||
      (aiIntent === null && hasAnyTerm(latestUserText, BOOKING_CONFIRMATION_TERMS))
    const bookingIntent = bookingPrepareIntent || bookingConfirmIntent
    
    const toolIntent = { 
      records: recordToolIntent, 
      vitals: vitalsToolIntent, 
      doctorSearch: doctorSearchIntent, 
      booking: bookingIntent,
      escalation: aiUrgency === 'urgent' || dangerFromUserInput
    }

    const scopeGuardTriggered =
      aiScope === 'non_medical' &&
      aiIntent === 'casual' &&
      !greetingOnlyMessage &&
      !likelyHealthScopeFromText

    if (scopeGuardTriggered) {
      const scopeReply = buildHealthOnlyScopeReply(messageText)
      await Promise.all([
        incrementAiUsageStats({ serviceClient, userId, dayKey: rateLimitState.dayKey }),
        logAgentAction({
          serviceClient,
          userId,
          conversationId,
          action: 'scope_guard',
          status: 'blocked',
          payload: {
            scope: aiScope,
            reason: aiScopeReason,
            scopeModel: aiScopeModel,
            message: clipText(messageText, 180),
          },
        }).catch((scopeLogError: any) => {
          console.warn('[chat-ai] scope guard log failed:', scopeLogError)
        }),
      ])

      const scopePayload = {
        success: true,
        data: {
          reply: scopeReply,
          message: scopeReply,
          source: 'scope_guard',
          selectedModel: aiScopeModel,
          model: aiScopeModel,
          doctorRecommendations: [],
          recommendationMode: null,
          doctorSearchMeta: null,
          departmentSuggestion: null,
          bookingPrompt: null,
          bookingPreparation: null,
          bookingConfirmation: null,
          consultRecommended: false,
          consultPriority: null,
          needsHumanReview: false,
          riskScore: 0.05,
          reviewReason: 'out_of_scope_non_medical',
          transport: streamRequested ? 'sse' : 'json',
          orchestrator: {
            toolsExecuted: {
              records: false,
              vitals: false,
              doctorSearch: false,
              booking: false,
              escalation: false,
            },
            autonomousToolSteps: [],
          },
          scope: {
            classification: aiScope,
            reason: aiScopeReason,
          },
          fastResponse: fastResponseRequested,
          rateLimit: {
            ...rateLimitState,
            blocked: false,
            used: Math.max(0, Number(rateLimitState.used || 0) + 1),
            remaining: Math.max(0, Number(rateLimitState.remaining || 0) - 1),
            retryAfterMs: 0,
          }
        }
      }

      return streamRequested
        ? createStreamingResponse(scopePayload)
        : new Response(JSON.stringify(scopePayload), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
    }

    // 7. Autonomous Tool Loop
    let doctorRecommendations = []
    let recommendationMode = null
    let doctorSearchMeta = null
    let bookingPrep = null
    let bookingConfirmation = null
    let autonomousResult = null

    const historyDoctorRecommendations = getLatestAssistantContextArray(payload?.history, 'doctorRecommendations')
    const historyBookingSlotOptions = getLatestAssistantContextArray(payload?.history, 'bookingSlotOptions')

    const shouldRunAutonomousTools = AUTONOMOUS_AGENT_ENABLED && (
      !fastResponseRequested ||
      doctorSearchIntent ||
      bookingIntent
    )

    if (shouldRunAutonomousTools) {
      let speculativeDoctorsResult = null;
      if (speculativeDoctorSearchPromise) {
        try {
          speculativeDoctorsResult = await speculativeDoctorSearchPromise;
        } catch (specErr) {
          console.warn('[AI Speculative Prefetch] Speculative search await error:', specErr);
        }
      }

      autonomousResult = await runAutonomousToolLoop({
        serviceClient, userId, openAiApiKey, concernText, combinedUserText, latestMessageText: messageText,
        hasDoctorIntent: doctorSearchIntent, hasDoctorSearchIntent: doctorSearchIntent, 
        hasBookingIntent: bookingIntent, isConfirmation: bookingConfirmIntent,
        toolIntent, doctorRecommendations: historyDoctorRecommendations, historyBookingSlotOptions,
        pendingBookingProposal,
        history,
        dangerFromUserInput, triageCoverage: aiIntent === 'triage' ? { ...triageCoverage, covered: 1 } : triageCoverage, 
        departmentSuggestion, locationCity, searchAreaCity, 
        accessToken: requestAccessToken, conversationId,
        userProfile, // Pass profile for automated identity
        speculativeDoctorsResult
      })
      doctorRecommendations = autonomousResult.doctorRecommendations || []
      recommendationMode = autonomousResult.recommendationMode
      doctorSearchMeta = autonomousResult.doctorSearchMeta || null
      bookingPrep = autonomousResult.bookingPrep
      bookingConfirmation = autonomousResult.bookingConfirmation
    }

    // 8. System Prompt & AI Invoke
    const shouldInjectDoctorContext =
      doctorSearchIntent ||
      bookingIntent ||
      doctorRecommendations.length > 0 ||
      Boolean(bookingPrep) ||
      Boolean(bookingConfirmation)
    const toolContext = shouldInjectDoctorContext
      ? formatDoctorContext(doctorRecommendations, recommendationMode, bookingPrep)
      : 'No doctor lookup required for this turn.'
    
    const systemPrompt = buildSystemPrompt({
      concern: concernText, assistantMode, medicineQuery, languageInstruction,
      latestMessageText: messageText,
      combinedUserText,
      memorySummary: memoryRecord.summary, toolContext, conversationDirective: "Be helpful",
      triageQuestionMode: true, triageQuestionSetsUsed: 0, triageQuestionSetLimitReached: false,
      bookingConfirmation,
      bookingPrep,
      userProfile // Pass profile to prompt builder
    })
    
    const messagesToSend = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: messageText }]
    if (fastResponseRequested) {
      messagesToSend.push({
        role: 'system',
        content: voiceReplyRequested
          ? 'FAST RESPONSE MODE: Keep answer concise. Use clean markdown formatting like **bolding** key clinical details/warnings, and bullet points for actionable steps. Prioritize immediate actionable guidance.'
          : 'FAST RESPONSE MODE: Reply quickly but keep the answer useful. Aim for 4-7 short lines with direct medical guidance, avoid filler, and keep only the most relevant details.'
      })
    }
    if (voiceReplyRequested) {
      messagesToSend.push({
        role: 'system',
        content: 'VOICE REPLY MODE: Speak in a natural female-doctor style. Give useful medical guidance in a clean rich-text layout that looks good in chat: start with one short empathetic line, then use 2 to 4 compact bullet points or short sections with markdown headings like ### What to do, ### Watch for, and ### Next question only when needed. Bold key warnings or important terms. Keep each bullet short, conversational, and easy to read aloud. Avoid one long paragraph.'
      })
    }
    const shouldUseDoctorLikeTriageQuestionStyle =
      (aiIntent === 'triage' || hasSymptomSignal(messageText)) &&
      !doctorSearchIntent &&
      !bookingIntent
    if (shouldUseDoctorLikeTriageQuestionStyle) {
      messagesToSend.push({
        role: 'system',
        content: 'TRIAGE QUESTION STYLE: If you need more information, ask like a doctor in a natural conversation. You can use markdown to highlight key details, but keep it clear and ask only the most important next question(s).'
      })
    }
    
    if (bookingConfirmation?.status === 'confirmed') {
      // Add explicit instruction to acknowledge the successful booking
      messagesToSend.push({ 
        role: 'system', 
        content: `CRITICAL STATUS: The appointment with ${bookingConfirmation.doctorName || 'the doctor'} for ${bookingConfirmation.slotLabel} has been SUCCESSFULLY BOOKED in our real-time database. Tell the user warmly that it's confirmed. DO NOT suggest "I can book it for you" — IT IS ALREADY DONE.` 
      })
    } else if (bookingIntent) {
      if (bookingConfirmation && bookingConfirmation.status !== 'confirmed') {
        messagesToSend.push({
          role: 'system',
          content: `CRITICAL STATUS: Booking is NOT completed. Current status: ${bookingConfirmation.status}. Reason: ${bookingConfirmation.message || 'unknown'}. NEVER say "booked" or "confirmed". Ask user to choose another slot or retry booking.`
        })
      } else {
        messagesToSend.push({
          role: 'system',
          content: `WARNING: No actual booking has been made yet. If you are listing slots, do not say "I have booked it". Say "I found these slots, which one should I book?"`
        })
      }
    }
    
    const pureDoctorDirectoryIntent =
      doctorSearchIntent &&
      !bookingIntent &&
      !dangerFromUserInput &&
      !hasSymptomSignal(latestUserText)

    let generation = null
    if (pureDoctorDirectoryIntent && Array.isArray(doctorRecommendations) && doctorRecommendations.length > 0) {
      generation = {
        reply: buildAppOnlyDoctorReply({
          doctors: doctorRecommendations,
          bookingPrep,
          bookingConfirmation,
          cityLabel: searchAreaCity,
          specialtyLabel: departmentSuggestion?.label || null,
          recommendationMode,
          // Do not claim global totals from a limited result set.
          forceDoctorCount: true,
        }),
        source: 'structured_directory',
        selectedModel: null,
      }
    }
    const generationMaxTokens = voiceReplyRequested ? 240 : fastResponseRequested ? 320 : 800
    if (!generation && openAiApiKey) {
      try {
        generation = await invokeOpenAIWithRetry({
          apiKey: openAiApiKey,
          messages: messagesToSend,
          messageText,
          maxTokens: generationMaxTokens,
          preferredModels: voiceReplyRequested
            ? ['gpt-4o-mini', 'gpt-5-mini']
            : fastResponseRequested
                ? ['gpt-4o-mini', 'gpt-5-mini']
                : undefined,
        })
      } catch (openAiError) {
        console.error('[chat-ai] OpenAI generation failed, attempting fallback:', openAiError)
      }
    }
    if (!generation && geminiApiKey) {
      generation = await invokeGeminiWithRetry({
        apiKey: geminiApiKey,
        body: {
          contents: [{
            parts: messagesToSend.map((message: any) => ({
              text: `${message.role === 'system' ? 'System' : message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`
            }))
          }]
        },
        messageText
      })
    }

    if (!generation) {
      if ((doctorSearchIntent || pureDoctorDirectoryIntent) && Array.isArray(doctorRecommendations) && doctorRecommendations.length > 0) {
        generation = {
          reply: buildAppOnlyDoctorReply({
            doctors: doctorRecommendations,
            bookingPrep,
            bookingConfirmation,
            cityLabel: searchAreaCity,
            specialtyLabel: departmentSuggestion?.label || null,
            recommendationMode,
            forceDoctorCount: pureDoctorDirectoryIntent,
          }),
          source: 'structured_fallback',
          selectedModel: null,
        }
      } else {
        throw new Error("AI failed")
      }
    }

    let reply = formatAiReplyForPremiumMarkdown(generation.reply, { allowEmoji: true, safetyCritical: dangerFromUserInput })

    if (bookingIntent && (bookingConfirmation?.status || bookingPrep?.status)) {
      reply = buildAppOnlyDoctorReply({
        doctors: Array.isArray(doctorRecommendations) ? doctorRecommendations : [],
        bookingPrep,
        bookingConfirmation,
        cityLabel: searchAreaCity,
        specialtyLabel: departmentSuggestion?.label || null,
        recommendationMode,
      })
    }

    const shouldEnforceAppOnlyDoctorOutput =
      doctorSearchIntent ||
      bookingIntent ||
      Boolean(bookingPrep) ||
      (Array.isArray(doctorRecommendations) && doctorRecommendations.length > 0)

    if (shouldEnforceAppOnlyDoctorOutput) {
      const doctors = Array.isArray(doctorRecommendations) ? doctorRecommendations : []
      if (pureDoctorDirectoryIntent && doctors.length > 0) {
        reply = buildAppOnlyDoctorReply({
          doctors,
          bookingPrep,
          bookingConfirmation,
          cityLabel: searchAreaCity,
          specialtyLabel: departmentSuggestion?.label || null,
          recommendationMode,
          forceDoctorCount: true,
        })
      }
      const hasDoctors = doctors.length > 0
      const allowedNames = hasDoctors ? collectAllowedDoctorNames(doctors) : []
      const hasMention = hasDoctorLikeMention(reply)
      const hasAllowedMention = hasDoctors ? hasAnyAllowedDoctorMention(reply, allowedNames) : false
      const hasUnapprovedMention = hasDoctors ? hasUnapprovedDoctorMention(reply, allowedNames) : false

      const mustOverrideForAppOnly =
        recommendationMode === 'web' ||
        (!hasDoctors && hasMention) ||
        (hasDoctors && hasMention && !hasAllowedMention) ||
        hasUnapprovedMention

      if (mustOverrideForAppOnly) {
        reply = buildAppOnlyDoctorReply({
          doctors,
          bookingPrep,
          bookingConfirmation,
          cityLabel: searchAreaCity,
          specialtyLabel: departmentSuggestion?.label || null,
          recommendationMode,
        })
      }
    }

    if (bookingIntent && bookingConfirmation?.status !== 'confirmed' && hasFalseBookingSuccessClaim(reply)) {
      const notConfirmedLine = buildNotConfirmedBookingMessage(bookingConfirmation, bookingPrep)
      if (!normalize(reply).includes(normalize(notConfirmedLine))) {
        reply = `${reply}\n\n${notConfirmedLine}`
      }
    }

    const shouldValidateTriageQuestion =
      (aiIntent === 'triage' || hasSymptomSignal(messageText)) &&
      !doctorSearchIntent &&
      !bookingIntent

    if (shouldValidateTriageQuestion) {
      const validationResult = buildTriageFollowUpReply({
        concernText: concernText || combinedUserText || messageText,
        coverage: triageCoverage,
        history,
        voiceMode: voiceReplyRequested,
        latestMessageText: messageText,
      })

      const replyLooksValid = validationResult.valid &&
        !/(\bmore details\b|\btell me more\b|\bgive more details\b|\bwhat symptoms\b|\bplease elaborate\b)/i.test(reply)

      if (!replyLooksValid) {
        console.log('[chat-ai] triage reply fallback engaged', {
          profileId: validationResult.profileId,
          missingSlots: validationResult.missingSlots,
          reason: validationResult.reason || 'invalid_triage_reply',
        })
        reply = validationResult.reply
      }
    }

    // 9. Persistence
    let finalKeyFacts = memoryRecord.keyFacts || []
    const resolvedDoctorId =
      autonomousResult?.resolvedDoctorId ||
      doctorRecommendations?.[0]?.id ||
      doctorRecommendations?.[0]?._id ||
      null
    if (resolvedDoctorId) {
      finalKeyFacts = [
        ...finalKeyFacts.filter(f => f.key !== 'last_doctor_recommended'),
        { key: 'last_doctor_recommended', value: resolvedDoctorId }
      ]
    }
    const nextPendingBookingProposal =
      bookingConfirmation?.status === 'confirmed'
        ? null
        : bookingPrep?.status === 'confirm_pending' && resolvedDoctorId
          ? {
              doctorId: resolvedDoctorId,
              selectedSlotId: bookingPrep?.proposal?.selectedSlotId || null,
              selectedSlotLabel: bookingPrep?.proposal?.selectedSlotLabel || null,
              slotOptions: Array.isArray(bookingPrep?.slotOptions) ? bookingPrep.slotOptions.slice(0, 6) : [],
              updatedAt: new Date().toISOString(),
            }
        : bookingPrep?.status === 'ready' && Array.isArray(bookingPrep?.slotOptions) && bookingPrep.slotOptions.length > 0 && resolvedDoctorId
          ? {
              doctorId: resolvedDoctorId,
              slotOptions: bookingPrep.slotOptions.slice(0, 6),
              updatedAt: new Date().toISOString(),
            }
          : bookingIntent && bookingPrep?.status !== 'ready'
            ? null
            : pendingBookingProposal
    finalKeyFacts = mergePendingBookingProposalIntoKeyFacts(finalKeyFacts, nextPendingBookingProposal)
    
    const persistenceTasks: Promise<any>[] = [
      incrementAiUsageStats({ serviceClient, userId, dayKey: rateLimitState.dayKey })
    ]
    const shouldPersistConversationMemory =
      !fastResponseRequested ||
      bookingIntent ||
      bookingConfirmation?.status === 'confirmed' ||
      bookingPrep?.status === 'ready'
    if (shouldPersistConversationMemory) {
      const updatedSummary = buildRollingSummary(memoryRecord.summary || '', messageText, reply)
      persistenceTasks.push(
        upsertConversationMemory({
          serviceClient,
          conversationId,
          userId,
          summary: updatedSummary,
          keyFacts: finalKeyFacts,
          latestUserMessage: messageText,
          latestAiReply: reply
        })
      )
    }
    await Promise.all(persistenceTasks)

    const bookingPrompt =
      typeof bookingPrep?.message === 'string' && bookingPrep.message.trim().length > 0
        ? bookingPrep.message.trim()
        : bookingPrep?.status === 'confirm_pending'
          ? 'Please confirm and I will book this exact slot for you.'
        : bookingPrep?.status === 'ready'
          ? 'I found available slots in our database. Which one should I book for you?'
          : null

    const consultRecommended = Boolean(dangerFromUserInput || hasConsultRecommendationCue(reply))
    const consultPriority = dangerFromUserInput ? 'immediate' : consultRecommended ? 'soon' : null

    const successPayload = {
      success: true,
      data: {
        reply,
        message: reply,
        source: generation.source,
        selectedModel: generation.selectedModel || null,
        model: generation.selectedModel || null,
        doctorRecommendations,
        recommendationMode,
        doctorSearchMeta,
        departmentSuggestion,
        bookingPrompt,
        bookingPreparation: bookingPrep,
        bookingConfirmation,
        consultRecommended,
        consultPriority,
        needsHumanReview: dangerFromUserInput,
        riskScore: dangerFromUserInput ? 0.85 : 0.2,
        reviewReason: dangerFromUserInput ? 'danger_signal_detected' : null,
        orchestrator: {
          toolsExecuted: toolIntent,
          autonomousToolSteps: autonomousResult?.steps || [],
        },
        fastResponse: fastResponseRequested,
        transport: streamRequested ? 'sse' : 'json',
        rateLimit: {
          ...rateLimitState,
          blocked: false,
          used: Math.max(0, Number(rateLimitState.used || 0) + 1),
          remaining: Math.max(0, Number(rateLimitState.remaining || 0) - 1),
          retryAfterMs: 0,
        }
      }
    }

    return streamRequested ? createStreamingResponse(successPayload) : new Response(JSON.stringify(successPayload), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error) {
    console.error('[chat-ai] request failed:', error)
    const errorPayload = { success: false, message: error.message }
    return streamRequested ? createStreamingResponse(errorPayload) : new Response(JSON.stringify(errorPayload), { headers: corsHeaders, status: 400 })
  }
})
