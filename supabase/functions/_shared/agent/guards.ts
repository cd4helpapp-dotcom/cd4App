// @ts-nocheck
// Deterministic safety checks around the model. They cost nothing, so they run on every request.

// Hides lookalike text from the patterns: fullwidth letters, zero-width characters, l33t spellings, stretched spaces.
export const normalizeForMatch = (value: unknown): string =>
  String(value || "")
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .toLowerCase()
    .replace(/1gn0re|ign0re|1gnore/g, "ignore")
    .replace(/pr0mpt/g, "prompt")
    .replace(/\s+/g, " ")
    .trim()

const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ["ignore_rules", /\b(ignore|disregard|forget|bypass|override|skip)\b.{0,40}\b(previous|above|earlier|prior|all|your|system|safety)\b.{0,30}\b(instruction|rule|prompt|guideline|polic|restriction|message)/],
  ["reveal_prompt", /\b(show|reveal|print|repeat|display|tell me|give me|share|leak|output)\b.{0,40}\b(system|hidden|initial|original|developer|your)\b.{0,20}\b(prompt|instruction|rules|message)/],
  ["role_override", /\b(you are now|from now on you|act as|pretend (to be|you are)|roleplay as|behave as)\b.{0,40}\b(dan|jailbreak|unrestricted|unfiltered|no (rules|limits|restrictions)|developer|admin|root|system|another ai|different ai)/],
  ["jailbreak_term", /\b(jailbreak|dan mode|developer mode|god mode|sudo mode|do anything now)\b/],
  ["fake_system", /(<\|?\s*(system|im_start|assistant)\s*\|?>|\[\s*system\s*\]|^\s*system\s*:|###\s*system)/m],
  ["privilege_claim", /\b(i am|i'm|as) (the |your )?(admin|administrator|developer|owner|openai|ceo)\b.{0,40}\b(show|give|reveal|disable|turn off|allow|access)\b/],
  ["other_patient_data", /\b(other|another|all|every|sab|dusre|doosre)\b.{0,30}\b(patient|user|mareez|marij|customer)s?\b.{0,40}\b(data|record|details?|number|phone|email|history|jankari|jaankari)\b/],
  // Roman Hindi
  ["ignore_rules_hi", /\b(pichhle|pichle|upar ke|apne|sare|saare|sabhi)\b.{0,30}\b(instructions?|nirdesh|niyam|rules?)\b.{0,30}\b(bhool|bhul|ignore|hata|chhod|mat mano|mat maano)/],
  ["reveal_prompt_hi", /\b(system prompt|prompt|instructions?|nirdesh)\b.{0,30}\b(dikhao|batao|bata do|dikha do|likho|share karo|bataiye|dikhaiye)\b/],
  // Devanagari
  ["ignore_rules_dev", /(पिछले|ऊपर के|अपने|सभी|सारे).{0,30}(निर्देश|नियम).{0,30}(भूल|अनदेखा|हटा|छोड़|मत मानो)/],
  ["reveal_prompt_dev", /(सिस्टम प्रॉम्प्ट|प्रॉम्प्ट|निर्देश).{0,30}(दिखाओ|दिखाइए|बताओ|बताइए|लिखो)/],
]

export const detectPromptInjection = (value: unknown): { flagged: boolean; rules: string[] } => {
  const text = normalizeForMatch(value)
  // "Should I ignore my doctor's previous instructions?" is a health question.
  const aboutDoctorAdvice = /\b(doctor|dr\.?|physician|prescription|medicine|tablet)\b/.test(text)
  const rules = INJECTION_PATTERNS.filter(([name, pattern]) => pattern.test(text) && !(aboutDoctorAdvice && name.startsWith("ignore_rules"))).map(([name]) => name)
  return { flagged: rules.length > 0, rules }
}

export const injectionReply = (style: string): string => {
  if (style === "devanagari_hindi") return "मैं CD4 AI हूँ और मैं अपने नियम नहीं बदल सकता, न ही किसी और की जानकारी दे सकता हूँ। आपकी सेहत, दवाइयों, रिपोर्ट या डॉक्टर के बारे में मैं खुशी से मदद करूँगा।"
  if (style === "roman_hindi") return "Main CD4 AI hoon aur main apne niyam nahi badal sakta, na hi kisi aur ki jaankari de sakta hoon. Aapki sehat, dawaiyon, report ya doctor ke baare mein main khushi se madad karunga."
  return "I'm CD4 AI, and I can't change my rules or share anyone else's information. I'm happy to help with your health, medicines, reports or finding a doctor."
}

// Text from reports, knowledge files and past chats can carry planted instructions, so it goes in as labelled data.
export const wrapUntrusted = (label: string, text: unknown, maxChars = 4000): string => {
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_ -]/g, "").slice(0, 60)
  const body = String(text || "")
    .replace(/<\/?\s*untrusted_data[^>]*>/gi, "")
    .replace(/<\|[^|>]*\|>/g, "")
    .slice(0, maxChars)
  return `<untrusted_data source="${safeLabel}">\n${body}\n</untrusted_data>`
}

const VENDOR_TERMS = /\b(chat\s?gpt|open\s?ai|gpt[-\s]?\d[\w.-]*|gpt[-\s]?\d*o(?:[-\s]mini)?|google gemini|gemini(?:[-\s]\d[\w.-]*)?|anthropic|claude[-\s]\d[\w.-]*|claude ai|llama[-\s]?\d*|mistral ai|large language model)\b/gi
const SELF_REFERENCE = /\bas an ai (language )?model\b[,:]?\s*/gi
// Words from the instructions and output format that only appear in a reply if the prompt is leaking.
const PROMPT_LEAK_MARKERS = /(isMedical|consultRecommended|needsHumanReview|clinicalSummary|<untrusted_data|WHAT STAYS PRIVATE|Return only valid JSON|USING RETRIEVED INFORMATION)/i

// A citation of CD4's own help files means nothing to a patient, for example "Source: app/reports-and-ai.md".
const INTERNAL_SOURCE_LINE = /^[ \t*_]*source:.*(?:\.md|md\b|\bapp|cd4).*$/gim

export const scrubOutput = (value: unknown, fallback: string): { text: string; flags: string[] } => {
  const flags: string[] = []
  let text = String(value || "")
  if (PROMPT_LEAK_MARKERS.test(text)) return { text: fallback, flags: ["prompt_leak_blocked"] }
  if (VENDOR_TERMS.test(text)) flags.push("vendor_name_removed")
  VENDOR_TERMS.lastIndex = 0
  text = text.replace(VENDOR_TERMS, "CD4 AI").replace(SELF_REFERENCE, "").replace(INTERNAL_SOURCE_LINE, "")
  return { text: text.trim(), flags }
}

// Streaming version: a whole word is usually one or two deltas, so this catches names without holding text back.
export const scrubDelta = (delta: string): string => String(delta).replace(VENDOR_TERMS, "CD4 AI")

const VALUE_WITH_UNIT = /(\d+(?:[.,]\d+)?)\s*(mg\/dl|g\/dl|mmol\/l|µ?iu\/m?l|miu\/l|ng\/m?l|pg\/m?l|u\/l|meq\/l|mm\/hr|mg|mcg|ml|gm|g|%|x\s?10)/gi

const digitsOf = (value: string): string => value.replace(",", ".").replace(/\.0+$/, "")

// Lab values and doses in the answer that do not appear anywhere in the source it was given.
export const findUnsupportedValues = (answer: unknown, source: unknown): string[] => {
  const sourceText = String(source || "").toLowerCase()
  const sourceNumbers = new Set((sourceText.match(/\d+(?:[.,]\d+)?/g) || []).map(digitsOf))
  const unsupported = new Set<string>()
  for (const match of String(answer || "").matchAll(VALUE_WITH_UNIT)) {
    if (!sourceNumbers.has(digitsOf(match[1]))) unsupported.add(match[0].trim())
  }
  return Array.from(unsupported)
}

export const unsupportedValuesNote = (language: string): string =>
  language === "devanagari_hindi"
    ? "\n\nकृपया ऊपर दी गई वैल्यू अपनी असली रिपोर्ट से मिला लें।"
    : language === "roman_hindi"
      ? "\n\nKripya upar di gayi values apni asli report se mila lein."
      : "\n\nPlease check the values above against your original report."
