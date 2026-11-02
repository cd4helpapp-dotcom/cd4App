// @ts-nocheck
// Messages that need no intelligence get a fixed reply: no model call, no cost, and they do not use up the daily quota.

type Reply = { en: string; roman: string; dev: string; ta?: string }

const REPLIES: Record<string, Reply> = {
  greeting: {
    en: "Hello! I'm CD4 AI. I can help with symptoms, medicines, reports, diet, mental wellbeing and finding a doctor. What would you like to know?",
    roman: "Namaste! Main CD4 AI hoon. Main symptoms, dawaiyon, reports, diet, mental wellbeing aur doctor dhoondhne mein madad kar sakta hoon. Aap kya jaanna chahte hain?",
    dev: "नमस्ते! मैं CD4 AI हूँ। मैं लक्षण, दवाइयों, रिपोर्ट, खान-पान, मानसिक सेहत और डॉक्टर ढूँढने में मदद कर सकता हूँ। आप क्या जानना चाहते हैं?",
    ta: "வணக்கம்! நான் CD4 AI. அறிகுறிகள், மருந்துகள், அறிக்கைகள், உணவு மற்றும் மருத்துவரைக் கண்டறிய உதவ முடியும். உங்களுக்கு என்ன தெரிய வேண்டும்?",
  },
  thanks: {
    en: "You're welcome! Is there anything else I can help you with?",
    roman: "Aapka swagat hai! Kya main aur kisi cheez mein madad kar sakta hoon?",
    dev: "आपका स्वागत है! क्या मैं और किसी चीज़ में मदद कर सकता हूँ?",
    ta: "நன்றி! வேறு ஏதாவது உதவி வேண்டுமா?",
  },
  bye: {
    en: "Take care! I'm here whenever you need me.",
    roman: "Apna khayal rakhiye! Jab bhi zaroorat ho, main yahin hoon.",
    dev: "अपना ख़याल रखिए! जब भी ज़रूरत हो, मैं यहीं हूँ।",
    ta: "கவனமாக இருங்கள்! எப்போது வேண்டுமானாலும் நான் இங்கே இருக்கிறேன்.",
  },
  ack: {
    en: "Okay. Tell me whenever you have a health question, or if you'd like to find a doctor.",
    roman: "Theek hai. Jab bhi koi health sawaal ho ya doctor dhoondhna ho, mujhe bataiye.",
    dev: "ठीक है। जब भी सेहत से जुड़ा कोई सवाल हो या डॉक्टर ढूँढना हो, मुझे बताइए।",
    ta: "சரி. உடல்நலக் கேள்வி இருந்தால் அல்லது மருத்துவரைக் கண்டறிய வேண்டுமென்றால் சொல்லுங்கள்.",
  },
}

const END = "[\\s!.?,:)\\u0964]*$"
const NAME = "(?:\\s+(?:cd4|cd4 ai|doctor|doc|dr|there|ji|sir|mam|madam|team|bot|friend))?"
const PATTERNS: Array<[string, RegExp]> = [
  ["greeting", new RegExp(`^\\s*(hi+|hello+|helo+|hey+|hlo+|hii+|heya|namaste|namaskar|namaskaar|pranam|good\\s*(morning|afternoon|evening|night|day)|gm|ram ram|salaam|salam|sat sri akal|नमस्ते|नमस्कार|प्रणाम|हेलो|हाय|வணக்கம்)${NAME}${END}`, "i")],
  ["thanks", new RegExp(`^\\s*(thanks?( a lot| so much| you)?|thank\\s*you( so much| very much)?|thanku|thnx|thx|ty|dhanyavad|dhanyawad|shukriya|bahut shukriya|धन्यवाद|शुक्रिया|நன்றி)${NAME}${END}`, "i")],
  ["bye", new RegExp(`^\\s*(bye+|bye bye|goodbye|good bye|see you|tata|alvida|phir milte hain|chalo bye|अलविदा|फिर मिलते हैं)${NAME}${END}`, "i")],
]

const ACK = new RegExp(`^\\s*(ok+|okay|okk+|k+|hmm+|hm+|achha|acha|accha|theek hai|thik hai|ठीक है|अच्छा|👍|🙏|❤️|🙂|😊)${END}`, "i")

const styleKey = (style: string): keyof Reply =>
  style === "devanagari_hindi" ? "dev" : style === "roman_hindi" ? "roman" : style === "tamil" ? "ta" : "en"

const pickReply = (kind: string, style: string): string => REPLIES[kind][styleKey(style)] || REPLIES[kind].en

// A reply only exists when the entire message is small talk, so "hi my head hurts" still reaches the model.
// "ok" and "haan" answer the question just asked mid-conversation, so an acknowledgement only counts at the start.
export const matchSmallTalk = (message: unknown, hasHistory: boolean, style: string): { kind: string; reply: string } | null => {
  const text = String(message || "").trim()
  if (!text || text.length > 80) return null
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(text)) return { kind, reply: pickReply(kind, style) }
  }
  if (!hasHistory && ACK.test(text)) return { kind: "ack", reply: pickReply("ack", style) }
  return null
}
