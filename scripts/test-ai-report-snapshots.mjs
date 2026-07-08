import process from 'node:process';

const TRIAGE_SLOT_KEYWORDS = {
  onset: ['kab se', 'since when', 'when did', 'how long', 'started', 'start hua', 'start hui', 'start huye', 'begin', 'began', 'ongoing', 'shuruaat'],
  severity: ['kitna', 'severity', '1-10', '1 to 10', 'pressure', 'tightness', 'sharp', 'burning', 'constant', 'cramping', 'worse', 'mild', 'moderate', 'severe', 'intensity'],
  associated: ['saath', 'also', 'along with', 'other symptoms', 'aur kya', 'aur kaun se', 'fever', 'cough', 'breath', 'breathing', 'wheezing', 'vomit', 'nausea', 'weakness', 'numbness', 'swelling', 'bleeding', 'rash', 'urine', 'dizziness', 'sweating', 'vision'],
  medicationContext: ['medicine', 'medication', 'tablet', 'allergy', 'inhaler', 'paracetamol', 'bp', 'blood pressure', 'diabetes', 'pregnancy', 'history', 'taken any medicines', 'ongoing conditions', 'regular medicine', 'purani bimari'],
};

const TRIAGE_SLOT_LABELS = {
  onset: 'Onset / Duration',
  severity: 'Severity',
  associated: 'Associated Symptoms',
  medicationContext: 'Medicine / Allergy Context',
};

const TRIAGE_TEMPLATES = {
  abdomen: {
    onset: 'Pet dard kab se hai aur exactly kahan hai?',
    severity: 'Dard constant hai, cramping hai, burning jaisa hai, ya khane ke baad badhta hai?',
    associated: 'Vomiting, loose motion, blood, fever, dehydration, ya urine me problem bhi hai kya?',
    medicationContext: 'Koi acidity medicine, painkiller, ya allergy issue hai kya? Pregnancy possibility ho to batayein.',
  },
  metabolic: {
    onset: 'Reading kab check ki thi aur ye naya hai ya purana?',
    severity: 'Reading kitni high/low hai aur saath me dizziness, sweating, headache, chest pain, ya weakness hai kya?',
    associated: 'Thirst, frequent urine, weight change, palpitations, swelling, ya vision changes hain kya?',
    medicationContext: 'Current medicines, missed doses, diet change, ya allergy hai kya?',
  },
  breathing_cough: {
    onset: 'Khansi ya saans ki problem kab se hai?',
    severity: 'Kya saans rest me bhi phool rahi hai, ya chalne par?',
    associated: 'Fever, wheezing, chest pain, ya phlegm ka rang badla hua hai kya?',
    medicationContext: 'Inhaler, allergy, asthma history, ya koi medicine li hai kya?',
  },
  general: {
    onset: 'Main symptom kab se hai?',
    severity: 'Ye kitna severe hai aur kya better ya worse karta hai?',
    associated: 'Koi aur related symptom bhi hai kya?',
    medicationContext: 'Koi medicine li hai, allergy hai, ya chronic illness hai kya?',
  },
};

const CONCERN_PROFILES = [
  { id: 'abdomen', terms: ['pet dard', 'pait dard', 'stomach', 'abdomen', 'acidity', 'gas', 'nausea', 'vomit', 'loose motion'] },
  { id: 'metabolic', terms: ['diabetes', 'sugar', 'glucose', 'insulin', 'hba1c', 'bp', 'blood pressure', 'thyroid'] },
  { id: 'breathing_cough', terms: ['cough', 'khansi', 'breath', 'breathing', 'saans', 'wheezing', 'asthma', 'cold'] },
];

const CLINICAL_SYMPTOM_RULES = [
  { regex: /\b(fever|bukhar|temperature|viral)\b/i, label: 'Fever' },
  { regex: /\b(cough|khansi)\b/i, label: 'Cough' },
  { regex: /\b(cold|sardi|runny nose)\b/i, label: 'Cold symptoms' },
  { regex: /\b(headache|migraine|sir dard)\b/i, label: 'Headache' },
  { regex: /\b(chest pain)\b/i, label: 'Chest pain' },
  { regex: /\b(breath|breathing|saans|wheezing)\b/i, label: 'Breathing issue' },
  { regex: /\b(stomach|pet|acidity|gas|abdomen)\b/i, label: 'Stomach discomfort' },
  { regex: /\b(rash|allergy|itch|itching|fungal|eczema)\b/i, label: 'Skin/allergy symptoms' },
  { regex: /\b(period|pregnan|pcos|pcod)\b/i, label: 'Gyne-related concern' },
  { regex: /\b(bp|blood pressure|hypertension)\b/i, label: 'Blood pressure concern' },
  { regex: /\b(sugar|diabet|glucose|thyroid)\b/i, label: 'Sugar/diabetes concern' },
  { regex: /\b(nausea|vomit|vomiting)\b/i, label: 'Nausea/vomiting' },
  { regex: /\b(diarrhea|loose motion|constipation)\b/i, label: 'Bowel-related symptoms' },
  { regex: /\b(dizziness|vertigo|faint)\b/i, label: 'Dizziness' },
];

const BOOKING_OR_SELECTION_PATTERN =
  /\b(doctor|dr\.?|physician|consult|consultation|slot|appointment|book|booking|available slots?|choose a doctor|select a doctor|which doctor|doctor you want|choose a slot|select a slot|kaun se doctor|kaunsa slot|clinic|hospital|fee|experience)\b/i;

const HEALTH_QA_PATTERN =
  /\b(symptom|pain|ache|fever|temperature|cough|cold|breath|breathing|chest|headache|migraine|stomach|abdomen|vomit|nausea|loose motion|diarrhea|urine|burning|period|pregnan|bp|blood pressure|pulse|sugar|diabetes|rash|itch|swelling|injury|fracture|bleeding|wound|medicine|medication|tablet|allergy|severity|duration|onset|red flag|bukhar|khansi|dard|saans|ulti|dawai|dava|kab se|kitne din|kitni der)\b/i;

const samples = [
  {
    name: 'pet_dard_voice',
    concern: 'pet dard aur nausea',
    history: [
      { role: 'user', content: 'mujhe pet dard ho raha hai aur nausea bhi hai' },
      { role: 'assistant', content: 'Samajh gaya. Pet dard kab se hai aur exactly kahan hai?' },
      { role: 'user', content: 'kal raat se hai aur navel ke neeche zyada hai' },
      { role: 'assistant', content: 'Samajh gaya. Dard constant hai, cramping hai, burning jaisa hai, ya khane ke baad badhta hai?' },
      { role: 'user', content: 'cramping jaisa hai aur 7/10 hoga, khane ke baad thoda badh raha hai' },
      { role: 'assistant', content: 'Samajh gaya. Vomiting, loose motion, blood, fever, dehydration, ya urine me problem bhi hai kya?' },
      { role: 'user', content: 'vomiting nahi hui, fever nahi hai, bas thoda loose motion hai' },
      { role: 'assistant', content: 'Samajh gaya. Koi acidity medicine, painkiller, ya allergy issue hai kya?' },
      { role: 'user', content: 'subah se pantoprazole li hai, allergy nahi hai' },
    ],
  },
  {
    name: 'diabetes_voice',
    concern: 'diabetes sugar reading high',
    history: [
      { role: 'user', content: 'mera sugar high aa raha hai aur weakness lag rahi hai' },
      { role: 'assistant', content: 'Samajh gaya. Reading kab check ki thi aur ye naya hai ya purana?' },
      { role: 'user', content: 'aaj subah check ki thi, pichle 2 din se high chal raha hai' },
      { role: 'assistant', content: 'Samajh gaya. Reading kitni high/low hai aur saath me dizziness, sweating, headache, chest pain, ya weakness hai kya?' },
      { role: 'user', content: 'reading 286 thi aur weakness hai, thoda dizziness bhi hai' },
      { role: 'assistant', content: 'Samajh gaya. Thirst, frequent urine, weight change, palpitations, swelling, ya vision changes hain kya?' },
      { role: 'user', content: 'pyaas zyada lag rahi hai aur baar baar urine aa raha hai' },
      { role: 'assistant', content: 'Samajh gaya. Current medicines, missed doses, diet change, ya allergy hai kya?' },
      { role: 'user', content: 'metformin le raha hoon, kal raat dose miss ho gayi thi, allergy nahi hai' },
    ],
  },
  {
    name: 'cough_breathing_voice',
    concern: 'khansi aur breathing problem',
    history: [
      { role: 'user', content: 'mujhe khansi hai aur saans lene me dikkat ho rahi hai' },
      { role: 'assistant', content: 'Samajh gaya. Khansi ya saans ki problem kab se hai?' },
      { role: 'user', content: '3 din se hai aur aaj zyada lag rahi hai' },
      { role: 'assistant', content: 'Samajh gaya. Kya saans rest me bhi phool rahi hai, ya chalne par?' },
      { role: 'user', content: 'chalne par zyada phool rahi hai, rest me mild hai' },
      { role: 'assistant', content: 'Samajh gaya. Fever, wheezing, chest pain, ya phlegm ka rang badla hua hai kya?' },
      { role: 'user', content: 'wheezing hai aur halka bukhar bhi hai, phlegm yellow aa raha hai' },
      { role: 'assistant', content: 'Samajh gaya. Inhaler, allergy, asthma history, ya koi medicine li hai kya?' },
      { role: 'user', content: 'asthma history hai, inhaler use kiya hai aur allergy nahi hai' },
    ],
  },
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function clipText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function normalizeInlineText(value, maxLength = 160) {
  return clipText(value, maxLength);
}

function getConcernProfile(concernText) {
  const needle = normalize(concernText);
  let best = { id: 'general', terms: [] };
  let bestScore = 0;
  for (const profile of CONCERN_PROFILES) {
    const score = profile.terms.reduce((sum, term) => sum + (needle.includes(normalize(term)) ? normalize(term).length : 0), 0);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }
  return best;
}

function getTriageQuestionTemplate(concernText, slot) {
  const profile = getConcernProfile(concernText);
  return (TRIAGE_TEMPLATES[profile.id] || TRIAGE_TEMPLATES.general)[slot];
}

function detectTriageQuestionSlot(text) {
  const normalized = normalize(text);
  for (const slot of ['onset', 'severity', 'associated', 'medicationContext']) {
    if (TRIAGE_SLOT_KEYWORDS[slot].some((keyword) => normalized.includes(normalize(keyword)))) {
      return slot;
    }
  }
  return null;
}

function matchFirstPattern(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = typeof match[1] === 'string' && match[1].trim() ? match[1] : match[0];
    const normalized = normalizeInlineText(raw, 120);
    if (normalized) return normalized;
  }
  return null;
}

function extractAssociatedSymptoms(text) {
  const combined = String(text || '').toLowerCase();
  return CLINICAL_SYMPTOM_RULES.filter((entry) => entry.regex.test(combined)).map((entry) => entry.label).slice(0, 8);
}

function extractMedicationContext(text) {
  const combined = String(text || '').toLowerCase();
  if (!combined.trim()) return 'Not clearly stated';
  if (/\b(no medicine[s]?|not taking any medicine[s]?|nahi koi medicine|koi medicine nahi)\b/i.test(combined)) {
    return 'Patient denied current medicine use';
  }
  const medicineMatch =
    combined.match(/\b(?:taking|using|on)\s+([a-z0-9,\s-]{3,80})/i) ||
    combined.match(/\b(?:medicine|medication|tablet|dawai|dava|inhaler)\s*[:\-]?\s*([a-z0-9,\s-]{3,80})/i);
  if (medicineMatch?.[1]) {
    return `Patient mentioned medication context: ${clipText(medicineMatch[1], 120)}`;
  }
  if (/\b(allergy|allergic)\b/i.test(combined)) return 'Patient mentioned allergy context';
  return 'Not clearly stated';
}

function extractTriageSnapshot(concern, history) {
  const userLines = history.filter((item) => item.role === 'user').map((item) => item.content);
  const assistantLines = history.filter((item) => item.role === 'assistant').map((item) => item.content);
  const combinedUser = userLines.join(' ');
  const combinedAssistant = assistantLines.join(' ').toLowerCase();
  const combinedLower = combinedUser.toLowerCase();

  const duration =
    matchFirstPattern(combinedUser, [
      /\b((?:for|since)\s+[a-z0-9\s]{1,30})\b/i,
      /\b(last\s+\d+\s*(?:hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years))\b/i,
      /\b(\d+\s*(?:day|days|week|weeks|month|months|year|years|din|hafte|hafta|mahina|mahine|saal))\b/i,
      /\b(\d+\s*(?:hour|hours|hr|hrs|min|mins|minute|minutes|ghanta|ghante))\b/i,
      /\b(kal se|aaj se|subah se|raat se)\b/i,
    ]) || 'Not clearly stated';

  const severity =
    matchFirstPattern(combinedUser, [
      /\b(([1-9]|10)\s*\/\s*10)\b/i,
      /\b(mild|moderate|severe)\b/i,
      /\b([1-9]|10)\s*(?:out of|\/)\s*10\b/i,
      /\b(bahut zyada|zyada|high|intense)\b/i,
      /\b(light|kam|thoda)\b/i,
    ]) || 'Not clearly stated';

  const associatedSymptoms = extractAssociatedSymptoms(combinedUser);
  const medicationContext = extractMedicationContext(combinedUser);
  const riskNote = /\b(chest pain|difficulty breathing|shortness of breath|faint|unconscious|severe bleeding|stroke)\b/i.test(combinedLower)
    ? 'Emergency red-flag language was detected in the captured chat.'
    : 'No explicit emergency red-flag language was detected in the captured chat.';

  const answeredTopics = [
    { label: 'Onset / Duration', value: duration },
    { label: 'Severity', value: severity },
    { label: 'Associated Symptoms', value: associatedSymptoms.length ? associatedSymptoms.join(', ') : 'Not clearly stated' },
    { label: 'Medicine / Allergy Context', value: medicationContext },
  ];

  if (/when did|how long|kab se/.test(combinedAssistant) && duration === 'Not clearly stated') {
    answeredTopics[0].value = 'Question asked, answer not clearly captured';
  }
  if (/(severity|1-10|pain scale|kitna severe|kitni severity)/.test(combinedAssistant) && severity === 'Not clearly stated') {
    answeredTopics[1].value = 'Question asked, answer not clearly captured';
  }
  if (/(associated symptom|any other symptom|fever|cough|itching|aur koi symptom)/.test(combinedAssistant) && answeredTopics[2].value === 'Not clearly stated') {
    answeredTopics[2].value = 'Question asked, answer not clearly captured';
  }
  if (/(medicine|medication|tablet|allergy|dawai|dava|inhaler)/.test(combinedAssistant) && medicationContext === 'Not clearly stated') {
    answeredTopics[3].value = 'Question asked, answer not clearly captured';
  }

  const missingDataPoints = answeredTopics
    .filter((item) => /not clearly stated|not captured|question asked/i.test(item.value))
    .map((item) => item.label);

  return {
    chiefConcern: clipText(concern || userLines[userLines.length - 1] || 'General consultation', 120),
    duration,
    severity,
    associatedSymptoms,
    medicationContext,
    riskNote,
    missingDataPoints,
  };
}

function extractQuestionText(value) {
  const compact = normalizeInlineText(value, 220);
  if (!compact) return '';
  const matches = compact.match(/[^?]{4,160}\?/g) || [];
  if (matches.length) return normalizeInlineText(matches.slice(0, 3).join(' '), 190);
  return compact.endsWith('?') ? compact : `${compact}?`;
}

function findNearestUserAnswer(history, questionIndex, maxLookAhead = 6) {
  for (let index = questionIndex + 1; index < history.length && index <= questionIndex + maxLookAhead; index += 1) {
    const item = history[index];
    if (item.role === 'user' && item.content.trim()) return normalizeInlineText(item.content, 220);
    if (item.role === 'assistant' && index > questionIndex + 1 && /\?/.test(item.content)) break;
  }
  return 'Answer not clearly captured before booking';
}

function isBookingOrSelectionText(value) {
  return BOOKING_OR_SELECTION_PATTERN.test(value || '');
}

function isHealthQaPair(question, answer) {
  const combined = `${question} ${answer}`;
  if (isBookingOrSelectionText(question)) return false;
  if (isBookingOrSelectionText(answer) && !HEALTH_QA_PATTERN.test(answer)) return false;
  return HEALTH_QA_PATTERN.test(combined);
}

function buildVoiceChatQaSnapshotLines(history, concernText, maxPairs = 4) {
  const lines = [];
  const seen = new Set();

  for (let questionIndex = 0; questionIndex < history.length && lines.length < maxPairs * 2; questionIndex += 1) {
    const item = history[questionIndex];
    if (item.role !== 'assistant' || !item.content.includes('?')) continue;

    const slot = detectTriageQuestionSlot(item.content || '');
    if (!slot) continue;

    const question = extractQuestionText(item.content || '') || getTriageQuestionTemplate(concernText, slot);
    const answer = findNearestUserAnswer(history, questionIndex);
    const fingerprint = `${slot}:${normalize(question)}`;
    if (!question || seen.has(fingerprint) || !isHealthQaPair(question, answer)) continue;
    seen.add(fingerprint);

    lines.push(`Q: ${TRIAGE_SLOT_LABELS[slot]}: ${question}`);
    lines.push(`A: ${answer}`);
  }

  return lines;
}

function buildHeuristicSummary(snapshot) {
  const lines = [
    `Chief concern: ${snapshot.chiefConcern}.`,
    `Onset/duration: ${snapshot.duration}.`,
    `Severity: ${snapshot.severity}.`,
    `Associated symptoms: ${snapshot.associatedSymptoms.length ? snapshot.associatedSymptoms.join(', ') : 'Not clearly stated'}.`,
    `Medicine/allergy context: ${snapshot.medicationContext}.`,
    `Risk note: ${snapshot.riskNote}.`,
  ];
  if (snapshot.missingDataPoints.length) {
    lines.push(`Still unclear for doctor follow-up: ${snapshot.missingDataPoints.join(', ')}.`);
  }
  return lines.join(' ');
}

function buildDoctorQuickReview(snapshot) {
  return [
    ['Concern', snapshot.chiefConcern, 'Confirm history'],
    ['Duration', snapshot.duration, 'Clarify onset'],
    ['Severity', snapshot.severity, 'Assess vitals'],
    ['Symptoms', snapshot.associatedSymptoms.length ? snapshot.associatedSymptoms.join(', ') : 'Not clearly stated', 'Screen red flags'],
    ['Medicine / Allergy', snapshot.medicationContext, 'Verify before Rx'],
    ['Missing', snapshot.missingDataPoints.length ? snapshot.missingDataPoints.join(', ') : 'None', 'Ask follow-up'],
  ];
}

function printSample(sample) {
  const snapshot = extractTriageSnapshot(sample.concern, sample.history);
  const qaLines = buildVoiceChatQaSnapshotLines(sample.history, sample.concern, 4);
  const summary = buildHeuristicSummary(snapshot);
  const quickReview = buildDoctorQuickReview(snapshot);

  console.log(`\n=== ${sample.name} ===`);
  console.log(`Concern: ${sample.concern}`);
  console.log('\nVOICE / AI Q&A');
  qaLines.forEach((line) => console.log(`  ${line}`));

  console.log('\nAI SUMMARY');
  console.log(`  ${summary}`);

  console.log('\nDOCTOR QUICK REVIEW');
  quickReview.forEach((row) => {
    console.log(`  ${row[0]} | ${row[1]} | ${row[2]}`);
  });

  const hasQa = qaLines.length >= 4;
  const hasSummary = summary.includes('Chief concern:') && summary.includes('Severity:');
  const hasQuickReview = quickReview.every((row) => row[1] && row[2]);
  console.log(`\nSTATUS: ${hasQa && hasSummary && hasQuickReview ? 'PASS' : 'FAIL'}`);
}

function main() {
  console.log('Testing AI report snapshot extraction for 3 sample voice chats...');
  for (const sample of samples) {
    printSample(sample);
  }
}

main();
