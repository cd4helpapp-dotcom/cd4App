import { AppLanguageCode, normalizeLanguageCode } from './settingsI18n';

type DoctorNameOptions = {
  includePrefix?: boolean;
  fallbackName?: string;
};

const DOCTOR_PREFIX_BY_LANGUAGE: Record<AppLanguageCode, string> = {
  en: 'Dr.',
  hi: 'डॉ.',
  bn: 'Dr.',
  mr: 'डॉ.',
  ta: 'Dr.',
};

const DEVANAGARI_LANGUAGES = new Set<AppLanguageCode>(['hi', 'mr']);

const KNOWN_NAME_TRANSLITERATIONS: Record<string, string> = {
  prem: 'प्रेम',
  kumar: 'कुमार',
  nitesh: 'नितेश',
  nitish: 'नितीश',
  singh: 'सिंह',
  rajput: 'राजपूत',
  dr: 'डॉ.',
  doctor: 'डॉक्टर',
};

const DEVANAGARI_VOWELS: Record<string, string> = {
  a: 'अ',
  aa: 'आ',
  i: 'इ',
  ii: 'ई',
  ee: 'ई',
  u: 'उ',
  oo: 'ऊ',
  ou: 'ऊ',
  e: 'ए',
  ai: 'ऐ',
  o: 'ओ',
  au: 'औ',
};

const DEVANAGARI_MATRAS: Record<string, string> = {
  a: '',
  aa: 'ा',
  i: 'ि',
  ii: 'ी',
  ee: 'ी',
  u: 'ु',
  oo: 'ू',
  ou: 'ू',
  e: 'े',
  ai: 'ै',
  o: 'ो',
  au: 'ौ',
};

const VOWEL_TOKENS = ['aa', 'ii', 'ee', 'oo', 'ou', 'ai', 'au', 'a', 'i', 'u', 'e', 'o'];

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  ksh: 'क्ष',
  chh: 'छ',
  kh: 'ख',
  gh: 'घ',
  ch: 'च',
  jh: 'झ',
  th: 'थ',
  dh: 'ध',
  ph: 'फ',
  bh: 'भ',
  sh: 'श',
  ng: 'ङ',
  ny: 'ञ',
  k: 'क',
  c: 'क',
  q: 'क',
  g: 'ग',
  j: 'ज',
  t: 'त',
  d: 'द',
  n: 'न',
  p: 'प',
  b: 'ब',
  m: 'म',
  y: 'य',
  r: 'र',
  l: 'ल',
  v: 'व',
  w: 'व',
  s: 'स',
  h: 'ह',
  f: 'फ',
  z: 'ज',
  x: 'क्स',
};

const CONSONANT_TOKENS = Object.keys(DEVANAGARI_CONSONANTS).sort((left, right) => right.length - left.length);

const CONJUNCT_PAIRS = new Set<string>([
  'pr',
  'br',
  'tr',
  'dr',
  'kr',
  'gr',
  'fr',
  'sr',
  'pl',
  'bl',
  'kl',
  'gl',
  'sk',
  'st',
  'sp',
  'sm',
]);

const DEVANAGARI_REGEX = /[\u0900-\u097F]/;
const LATIN_WORD_REGEX = /^[A-Za-z]+$/;
const DR_PREFIX_REGEX = /^(dr\.?|doctor)\s+/i;

const readToken = (value: string, from: number, candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (value.startsWith(candidate, from)) {
      return candidate;
    }
  }
  return null;
};

const transliterateLatinWordToDevanagari = (word: string): string => {
  const normalizedWord = word.toLowerCase();
  const knownWord = KNOWN_NAME_TRANSLITERATIONS[normalizedWord];
  if (knownWord) {
    return knownWord;
  }

  let cursor = 0;
  let output = '';

  while (cursor < normalizedWord.length) {
    const vowelToken = readToken(normalizedWord, cursor, VOWEL_TOKENS);
    if (vowelToken) {
      output += DEVANAGARI_VOWELS[vowelToken] || '';
      cursor += vowelToken.length;
      continue;
    }

    const consonantToken = readToken(normalizedWord, cursor, CONSONANT_TOKENS);
    if (!consonantToken) {
      output += normalizedWord[cursor];
      cursor += 1;
      continue;
    }

    output += DEVANAGARI_CONSONANTS[consonantToken] || consonantToken;
    cursor += consonantToken.length;

    const nextVowel = readToken(normalizedWord, cursor, VOWEL_TOKENS);
    if (nextVowel) {
      output += DEVANAGARI_MATRAS[nextVowel] || '';
      cursor += nextVowel.length;
      continue;
    }

    const nextConsonant = readToken(normalizedWord, cursor, CONSONANT_TOKENS);
    if (nextConsonant && CONJUNCT_PAIRS.has(`${consonantToken}${nextConsonant}`)) {
      output += '्';
    }
  }

  return output;
};

const transliterateNameToDevanagari = (name: string): string => {
  if (!name.trim()) {
    return '';
  }

  return name
    .split(/\s+/)
    .map((token) => {
      const cleanToken = token.trim();
      if (!cleanToken) return cleanToken;

      const matched = cleanToken.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
      if (!matched) {
        return cleanToken;
      }

      const [, prefix, latinWord, suffix] = matched;
      if (!LATIN_WORD_REGEX.test(latinWord)) {
        return cleanToken;
      }

      const transliteratedWord = transliterateLatinWordToDevanagari(latinWord);
      return `${prefix}${transliteratedWord}${suffix}`;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeRawDoctorName = (firstName?: string | null, lastName?: string | null, fullName?: string | null): string => {
  const full = typeof fullName === 'string' ? fullName.trim() : '';
  if (full) {
    return full;
  }

  return [firstName, lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
};

export const getLocalizedDoctorName = (
  {
    firstName,
    lastName,
    fullName,
  }: {
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
  },
  appLanguage: AppLanguageCode | string,
  options: DoctorNameOptions = {}
): string => {
  const { includePrefix = false, fallbackName = 'Doctor' } = options;
  const language = normalizeLanguageCode(appLanguage);

  const rawName = normalizeRawDoctorName(firstName, lastName, fullName) || fallbackName;
  const hasDoctorPrefix = DR_PREFIX_REGEX.test(rawName);
  const baseName = rawName.replace(DR_PREFIX_REGEX, '').trim();
  const safeBaseName = baseName || fallbackName;

  let localizedBaseName = safeBaseName;
  if (DEVANAGARI_LANGUAGES.has(language) && !DEVANAGARI_REGEX.test(safeBaseName)) {
    localizedBaseName = transliterateNameToDevanagari(safeBaseName);
  }

  if (!includePrefix && !hasDoctorPrefix) {
    return localizedBaseName;
  }

  const localizedPrefix = DOCTOR_PREFIX_BY_LANGUAGE[language] || DOCTOR_PREFIX_BY_LANGUAGE.en;
  return `${localizedPrefix} ${localizedBaseName}`.trim();
};

