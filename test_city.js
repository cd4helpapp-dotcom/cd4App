const CITY_EXTRACTION_STOP_WORDS = new Set(["doctor", "doc", "dr", "hospital", "clinic", "specialist", "find", "search", "show", "book", "appointment", "near", "chahiye", "batao", "dikhao", "dhoondh"]);

const extractCityCandidatesFromText = (text) => {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (c) => {
    const cleaned = c.replace(/[^\w\s-]/g, "").trim();
    if (cleaned.length < 3 || cleaned.length > 25) return;
    const lower = cleaned.toLowerCase();
    if (CITY_EXTRACTION_STOP_WORDS.has(lower)) return;
    if (seen.has(lower)) return;
    seen.add(lower);
    candidates.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase());
  };

  const englishPrepositionRegex = /\b(?:in|at|from|near|around|of)\s+([A-Z][a-z]{2,25}(?:\s+[A-Z][a-z]{2,15})?)\b/g;
  let match;
  while ((match = englishPrepositionRegex.exec(text)) !== null) addCandidate(match[1]);

  const hindiPostpositionRegex = /\b([A-Z][a-z]{2,25})\s+(?:mein|me|mei|ka|ke|ki|se|wale|wala|wali)\b/gi;
  while ((match = hindiPostpositionRegex.exec(text)) !== null) addCandidate(match[1]);

  const normalizedText = text.toLowerCase();
  const hindiNormalizedRegex = /\b([a-z]{3,25})\s+(?:mein|me|mei|ka|ke|ki|se|wale|wala|wali)\b/g;
  while ((match = hindiNormalizedRegex.exec(normalizedText)) !== null) addCandidate(match[1]);

  const englishNormalizedRegex = /\b(?:in|at|from|near|around)\s+([a-z]{3,25})\b/g;
  while ((match = englishNormalizedRegex.exec(normalizedText)) !== null) addCandidate(match[1]);

  if (candidates.length === 0) {
    const medicalContext = /doctor|doc|dr|hospital|clinic|specialist|find|search|show|book|appointment|dhund|bata|dikha|chahiye/i.test(text);
    if (medicalContext) {
      const capsRegex = /\b([A-Z][a-z]{3,20})\b/g;
      while ((match = capsRegex.exec(text)) !== null) {
        const candidate = match[1];
        if (!CITY_EXTRACTION_STOP_WORDS.has(candidate.toLowerCase())) {
          addCandidate(candidate);
        }
      }
    }
  }
  return candidates.slice(0, 5);
};

console.log("TEST 1 (Hindi):", extractCityCandidatesFromText("mujhe patna me ek doctor dhundhna hai"));
console.log("TEST 2 (English):", extractCityCandidatesFromText("find a doctor in Patna"));
console.log("TEST 3 (All lower):", extractCityCandidatesFromText("find doctor in patna"));
console.log("TEST 4 (Just name caps):", extractCityCandidatesFromText("Patna doctor chahiye"));
console.log("TEST 5 (Just name lower):", extractCityCandidatesFromText("patna doctor chahiye"));
console.log("TEST 6 (User raw query):", extractCityCandidatesFromText("abhi no doctor on poatn bata rh ahai"));
