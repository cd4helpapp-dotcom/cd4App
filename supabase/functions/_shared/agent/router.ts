// @ts-nocheck
// Picks the cheapest model that is safe for this message. Falls through the list when a model fails or is retired.

const env = (name: string) => (Deno.env.get(name) || "").trim()

const HIGH_STAKES = /\b(dose\w*|dosage|overdose|how much|kitni|interaction\w*|pregnan\w*|garbh\w*|breastfeed\w*|child\w*|baby|bachch\w*|infant\w*|insulin|warfarin|chemo\w*|cancer|suicid\w*|self[- ]?harm|kill myself|marna chahta|marna chahti|chest pain|stroke|seizure\w*|mirgi|faint\w*|behosh|bleeding|khoon)\b|(खुराक|गर्भ|बच्च|कैंसर|आत्महत्या|सीने में दर्द|बेहोश|खून)/i

export type RouteDecision = { tier: "fast" | "quality"; reason: string; models: string[] }

export const routeModel = (args: { message: string; historyTurns: number; emergencySignal: boolean; hasPersonalData: boolean; classifiedHighStakes?: boolean }): RouteDecision => {
  const fast = env("CHAT_AI_FAST_MODEL") || env("CHAT_AI_OPENAI_MODEL") || "gpt-4o-mini"
  const quality = env("CHAT_AI_QUALITY_MODEL") || env("CHAT_AI_OPENAI_MODEL") || "gpt-4o"
  const fallback = env("CHAT_AI_OPENAI_FALLBACK_MODEL")

  let tier: RouteDecision["tier"] = "fast"
  let reason = "routine"
  if (args.emergencySignal) [tier, reason] = ["quality", "emergency_signal"]
  // The classifier's judgement comes first. The word list is only for when it did not answer.
  else if (args.classifiedHighStakes ?? HIGH_STAKES.test(args.message)) [tier, reason] = ["quality", "high_stakes"]
  else if (args.hasPersonalData) [tier, reason] = ["quality", "personal_records"]
  else if (args.message.length > 500) [tier, reason] = ["quality", "long_message"]
  else if (args.historyTurns >= 4) [tier, reason] = ["quality", "history_handoff"]

  const ordered = tier === "quality" ? [quality, fast] : [fast, quality]
  return { tier, reason, models: Array.from(new Set([...ordered, fallback, "gpt-4o-mini", "gpt-4o"].filter(Boolean))) }
}

// "How do I cancel my appointment?" mentions an appointment but wants an answer, not a list of doctors.
export const isCd4PolicyQuestion = (message: string): boolean =>
  /\b(cancel\w*|refund\w*|reschedul\w*|money back|paise? (wapas|kat)|paisa (wapas|kat)|delete (my )?account|upload limit|time change|samay badal)\b|(रद्द|रिफंड|पैसे वापस|समय बदल)/i.test(String(message || ""))
