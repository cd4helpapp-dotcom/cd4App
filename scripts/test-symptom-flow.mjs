import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SHARED_TS = path.join(ROOT, 'supabase', 'functions', '_shared', 'clinicalBrain.ts');
const TOOLS_TS = path.join(ROOT, 'supabase', 'functions', 'chat-ai', 'index.ts');

const PROFILES = [
  {
    id: 'chest_pain',
    label: 'chest pain / heart symptoms',
    terms: ['heart health', 'heart', 'cardiology', 'cardiac', 'chest pain', 'seene me dard', 'seena dard', 'heart pain', 'palpitation', 'palpitations', 'left arm pain', 'jaw pain'],
    question: {
      onset: 'Chest pain kab se start hua, aur kya abhi bhi ho raha hai?',
      severity: 'Dard 1-10 me kitna hai, aur pressure/tightness jaisa lagta hai ya sharp?',
      associated: 'Saath me saans phoolna, pasina, chakkar, nausea, ya dard arm/jaw/back me ja raha hai kya?',
      medicationContext: 'BP ya heart ki history hai, ya koi heart/BP medicine chal rahi hai?',
    },
  },
  {
    id: 'breathing_cough',
    label: 'cough / breathing symptoms',
    terms: ['respiratory', 'pulmonology', 'lungs', 'lung', 'cough', 'khansi', 'cold', 'sardi', 'breath', 'breathing', 'breathless', 'wheezing', 'asthma', 'sore throat', 'throat pain'],
    question: {
      onset: 'Khansi ya saans ki problem kab se hai?',
      severity: 'Kya saans rest me bhi phool rahi hai, ya chalne par?',
      associated: 'Fever, wheezing, chest pain, ya phlegm ka rang badla hua hai kya?',
      medicationContext: 'Inhaler, allergy, asthma history, ya koi medicine li hai kya?',
    },
  },
  {
    id: 'fever',
    label: 'fever / infection symptoms',
    terms: ['fever', 'bukhar', 'temperature', 'temp', 'viral', 'infection', 'body ache', 'chills'],
    question: {
      onset: 'Bukhar kab se hai, aur kya continuous hai ya aata-jata?',
      severity: 'Highest temperature kitna gaya tha?',
      associated: 'Khansi, gala dard, body pain, chills, rash, vomiting, ya loose motion bhi hai kya?',
      medicationContext: 'Paracetamol ya koi aur medicine li hai, aur allergy to nahi?',
    },
  },
  {
    id: 'headache',
    label: 'headache / migraine symptoms',
    terms: ['headache', 'sir dard', 'sar dard', 'migraine', 'head pain', 'vision blur', 'aura'],
    question: {
      onset: 'Headache kab se hai, aur kya achanak start hua tha?',
      severity: 'Dard kitna severe hai aur exact kahan feel ho raha hai?',
      associated: 'Vomiting, vision change, weakness, numbness, fever, ya neck stiffness hai kya?',
      medicationContext: 'BP ya migraine history hai, aur koi painkiller liya hai kya?',
    },
  },
  {
    id: 'abdomen',
    label: 'stomach / digestion symptoms',
    terms: ['gastro', 'gastroenterology', 'digestion', 'digestive', 'stomach', 'abdomen', 'pet dard', 'pait dard', 'acidity', 'gas', 'vomit', 'nausea', 'diarrhea', 'loose motion', 'constipation', 'liver'],
    question: {
      onset: 'Pet dard kab se hai aur exactly kahan hai?',
      severity: 'Dard constant hai, cramping hai, burning jaisa hai, ya khane ke baad badhta hai?',
      associated: 'Vomiting, loose motion, blood, fever, dehydration, ya urine me problem bhi hai kya?',
      medicationContext: 'Koi acidity medicine, painkiller, ya allergy issue hai kya? Pregnancy possibility ho to batayein.',
    },
  },
  {
    id: 'skin',
    label: 'skin / allergy symptoms',
    terms: ['dermatology', 'derma', 'skin', 'rash', 'acne', 'itch', 'itching', 'allergy', 'fungal', 'eczema', 'hives', 'swelling'],
    question: {
      onset: 'Rash ya itching kab se hai aur kya spread ho rahi hai?',
      severity: 'Itching, pain, ya swelling kitni severe hai?',
      associated: 'Fever, pus, facial swelling, ya breathing issue hua hai kya?',
      medicationContext: 'Koi cream, allergy medicine, ya naya product/food use kiya hai kya?',
    },
  },
  {
    id: 'urinary',
    label: 'urinary / kidney symptoms',
    terms: ['urology', 'nephrology', 'urine', 'urinary', 'uti', 'burning urination', 'peshab', 'kidney', 'flank pain', 'blood in urine'],
    question: {
      onset: 'Urine ki problem kab se hai, aur kitni baar ho rahi hai?',
      severity: 'Burning ya pain kitna hai, aur lower abdomen ya side/back me bhi dard hai kya?',
      associated: 'Fever, blood in urine, vomiting, pregnancy, ya urine kam aa raha hai kya?',
      medicationContext: 'Koi antibiotic, kidney stone history, diabetes medicine, ya allergy hai kya?',
    },
  },
  {
    id: 'gyne_pregnancy',
    label: 'period / pregnancy / women health symptoms',
    terms: ['gynecology', 'gynaecology', 'women health', 'period', 'pregnancy', 'pregnant', 'pcos', 'pcod', 'bleeding', 'vaginal', 'white discharge', 'cramps', 'missed period'],
    question: {
      onset: 'Last period kab aaya tha, aur symptom kab start hua?',
      severity: 'Bleeding ya pain kitna hai, aur pads kitne use ho rahe hain?',
      associated: 'Dizziness, fever, foul discharge, severe lower abdomen pain, ya vomiting hai kya?',
      medicationContext: 'Contraceptive/hormonal medicine, pregnancy test, ya allergy hai kya?',
    },
  },
  {
    id: 'child',
    label: 'child health symptoms',
    terms: ['pediatrics', 'paediatrics', 'child', 'kid', 'kids', 'baby', 'infant', 'newborn', 'baccha', 'bacha', 'pediatric', 'paediatric'],
    question: {
      onset: 'Bachche ki age kya hai, aur symptoms kab se hain?',
      severity: 'Fever/pain kitna hai, aur kya baccha feed, drink, aur active hai?',
      associated: 'Breathing issue, rash, vomiting, diarrhea, ya kam urine/wet diapers hain kya?',
      medicationContext: 'Koi medicine di hai, aur allergy history hai kya?',
    },
  },
  {
    id: 'mental_health',
    label: 'anxiety / mood / sleep symptoms',
    terms: ['psychiatry', 'mental health', 'anxiety', 'panic', 'depression', 'stress', 'sleep', 'insomnia', 'mood', 'suicide', 'self harm', 'dar lagna'],
    question: {
      onset: 'Ye problem kab se ho rahi hai aur koi trigger tha kya?',
      severity: 'Sleep ya work kitna affect ho raha hai, aur panic attacks hote hain kya?',
      associated: 'Low mood, appetite change, substance use, ya unsafe feel hota hai kya?',
      medicationContext: 'Koi psychiatry medicine, therapy, alcohol/drug use, ya aur medicines hain kya?',
    },
  },
  {
    id: 'metabolic',
    label: 'diabetes / BP / thyroid symptoms',
    terms: ['endocrinology', 'diabetes', 'sugar', 'glucose', 'insulin', 'hba1c', 'bp', 'blood pressure', 'hypertension', 'thyroid'],
    question: {
      onset: 'Reading kab check ki thi aur ye naya hai ya purana?',
      severity: 'Reading kitni high/low hai aur saath me dizziness, sweating, headache, chest pain, ya weakness hai kya?',
      associated: 'Thirst, frequent urine, weight change, palpitations, swelling, ya vision changes hain kya?',
      medicationContext: 'Current medicines, missed doses, diet change, ya allergy hai kya?',
    },
  },
  {
    id: 'injury_ortho',
    label: 'injury / bone / joint symptoms',
    terms: ['orthopedic', 'orthopaedic', 'ortho', 'injury', 'fracture', 'sprain', 'joint', 'bone', 'back pain', 'knee pain', 'shoulder pain', 'neck pain', 'swelling after fall'],
    question: {
      onset: 'Problem kab start hui aur kya fall, twist, ya injury hui thi?',
      severity: 'Dard 1-10 me kitna hai, aur limb move/use kar pa rahe hain kya?',
      associated: 'Swelling, deformity, numbness, weakness, fever, ya pain arm/leg me ja raha hai kya?',
      medicationContext: 'Painkiller, blood thinner, bone/joint history, ya allergy hai kya?',
    },
  },
];

const DEFAULT_PROFILE = {
  id: 'general',
  label: 'general symptoms',
  terms: [],
  question: {
    onset: 'Main symptom kab se hai?',
    severity: 'Ye kitna severe hai aur kya better/worse karta hai?',
    associated: 'Koi aur related symptom bhi hai kya?',
    medicationContext: 'Koi medicine li hai, allergy hai, ya chronic illness hai kya?',
  },
};

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickProfile(text) {
  const needle = normalize(text);
  if (!needle) return DEFAULT_PROFILE;
  let best = DEFAULT_PROFILE;
  let bestScore = 0;
  for (const profile of PROFILES) {
    const score = profile.terms.reduce((sum, term) => {
      const n = normalize(term);
      return sum + (n && needle.includes(n) ? n.length : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = profile;
    }
  }
  return best;
}

function getCoverage(text) {
  const needle = normalize(text);
  return {
    onset: /\b(since|started|kab se|aaj se|kal se|subah se|shaam se|raat se)\b/.test(needle) || /\b\d+\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months|din|ghante|hafte|mahine)\b/.test(needle),
    severity: /\b(mild|moderate|severe|zyada|bahut|bohot|unbearable)\b/.test(needle) || /\b([1-9]|10)\s*\/\s*10\b/.test(needle) || /\b(temperature|temp)\s*(is|:)?\s*\d{2,3}(\.\d)?\b/.test(needle),
    associated: /\b(fever|bukhar|nausea|vomit|cough|cold|khansi|breath|breathing|chills|rash|itch|diarrhea|loose motion|constipation|dizziness|sweating|chest pain|throat|weakness|body ache)\b/.test(needle),
    medicationContext: /\b(medicine|medication|tablet|allergy|dawai|paracetamol|inhaler|insulin|antibiotic|bp medicine|blood pressure medicine)\b/.test(needle),
  };
}

function getMissingQuestions(coverage, profile) {
  const missing = [];
  if (!coverage.onset) missing.push(profile.question.onset);
  if (!coverage.severity) missing.push(profile.question.severity);
  if (!coverage.associated) missing.push(profile.question.associated);
  if (!coverage.medicationContext) missing.push(profile.question.medicationContext);
  return missing;
}

function toVoiceFollowUp(profile, missing) {
  if (!missing.length) {
    return 'Samajh gaya. Ab main next best guidance de raha hoon.';
  }
  return `Samajh gaya. ${missing[0]}`;
}

function toChatFollowUp(profile, missing) {
  if (!missing.length) {
    return 'Samajh gaya. Ab main next best guidance de raha hoon.';
  }
  const first = missing[0];
  const second = missing[1];
  return second ? `Samajh gaya. ${first} Aur ${second}` : `Samajh gaya. ${first}`;
}

function analyzeMessage(message, mode) {
  const profile = pickProfile(message);
  const coverage = getCoverage(message);
  const missing = getMissingQuestions(coverage, profile);
  const reply = mode === 'voice' ? toVoiceFollowUp(profile, missing) : toChatFollowUp(profile, missing);
  return { profile, coverage, missing, reply };
}

function readSourceChecks() {
  const shared = fs.readFileSync(SHARED_TS, 'utf8');
  const tools = fs.readFileSync(TOOLS_TS, 'utf8');
  return [
    ['adaptive clinical brain', shared.includes('adaptive reasoning') && shared.includes('highest-yield missing item')],
    ['doctor-like history domains', shared.includes('hospital admission or surgery') && shared.includes('family/social context')],
    ['one-question rule', shared.includes('Ask exactly one focused question per turn')],
    ['no rigid checklist', shared.includes('not a mandatory checklist') && shared.includes('never ask a fixed questionnaire')],
    ['emergency safety override', tools.includes('detectEmergencySignal') && tools.includes('consultPriority = "immediate"')],
  ];
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printResult(mode, input) {
  const result = analyzeMessage(input, mode);
  console.log(`Mode: ${mode}`);
  console.log(`Input: ${input}`);
  console.log(`Matched profile: ${result.profile.label} (${result.profile.id})`);
  console.log(`Coverage: onset=${result.coverage.onset}, severity=${result.coverage.severity}, associated=${result.coverage.associated}, meds=${result.coverage.medicationContext}`);
  console.log(`Missing: ${result.missing.length ? result.missing.join(' | ') : 'none'}`);
  console.log(`Reply: ${result.reply}`);
}

function main() {
  const args = process.argv.slice(2);
  const modeArgIndex = args.indexOf('--mode');
  const messageArgIndex = args.indexOf('--message');
  const sampleOnly = args.includes('--sample') || args.length === 0;
  const mode = modeArgIndex >= 0 ? String(args[modeArgIndex + 1] || 'both').toLowerCase() : 'both';
  const message = messageArgIndex >= 0 ? String(args[messageArgIndex + 1] || '').trim() : '';

  printSection('Source Rule Checks');
  for (const [label, ok] of readSourceChecks()) {
    console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  }

  if (message) {
    printSection('Single Message Test');
    if (mode === 'chat' || mode === 'voice') {
      printResult(mode, message);
    } else {
      printResult('chat', message);
      printResult('voice', message);
    }
    return;
  }

  if (!sampleOnly) return;

  const samples = [
    'mujhe pet dard hai aur nausea bhi ho rahi hai',
    'bukhar 3 din se hai, temperature 102 tak gaya tha',
    'chest pain aur saans phool rahi hai',
    'khansi aur wheezing ho rahi hai',
    'headache ke saath vomiting aur vision blur hai',
  ];

  printSection('Sample Symptom Runs');
  for (const sample of samples) {
    printResult('chat', sample);
    printResult('voice', sample);
    console.log('---');
  }
}

main();
