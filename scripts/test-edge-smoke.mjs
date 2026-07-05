#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MESSAGES = [
  {
    name: 'fever_history',
    concern: 'General Assistant',
    message: 'bukhar 3 din se hai, temperature 102 tak gaya tha',
    mode: 'assistant',
    locationCity: 'Patna',
  },
  {
    name: 'abdominal_pain',
    concern: 'General Assistant',
    message: 'mujhe pet dard hai aur nausea bhi ho rahi hai',
    mode: 'assistant',
    locationCity: 'Patna',
  },
  {
    name: 'voice_chest_pain',
    concern: 'General Assistant',
    message: 'chest pain aur saans phool rahi hai',
    mode: 'assistant',
    locationCity: 'Patna',
    voice: true,
    ttsMode: 'fast',
  },
];

const REQUIRED_ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_ACCESS_TOKEN'];

const stripWrappingQuotes = (value) => {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
};

const loadDotEnvFile = async (filename) => {
  const filePath = path.resolve(process.cwd(), filename);
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const index = normalized.indexOf('=');
    if (index <= 0) continue;
    const key = normalized.slice(0, index).trim();
    const valueRaw = normalized.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = stripWrappingQuotes(valueRaw);
  }
};

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const fail = (message) => {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
};

const passLine = (message) => console.log(`PASS  ${message}`);
const warnLine = (message) => console.log(`WARN  ${message}`);
const failLine = (message) => console.log(`FAIL  ${message}`);

const getBaseUrl = () => {
  const raw = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  return raw.trim().replace(/\/+$/, '');
};

const assertResponseShape = (payload, kind) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${kind}: response is not an object`);
  }
  if (payload.success !== true) {
    throw new Error(`${kind}: success flag is not true`);
  }
  if (!payload.data || typeof payload.data !== 'object') {
    throw new Error(`${kind}: missing data envelope`);
  }
};

const assertProfessionalText = (text, context) => {
  const normalized = normalize(text);
  if (!normalized) throw new Error(`${context}: empty reply`);
  if (normalized.length < 20) throw new Error(`${context}: reply is too short`);
  if (/more details|tell me more|please elaborate|what symptoms|general symptoms/i.test(text)) {
    throw new Error(`${context}: generic triage language detected`);
  }
  if (/###\s+fever symptoms|###\s+symptoms|^\s*[-*]\s+/mi.test(text)) {
    throw new Error(`${context}: checklist-style triage detected`);
  }
};

const invokeEdgeFunction = async ({ baseUrl, token, anonKey, fnName, body, stream = false }) => {
  const response = await fetch(`${baseUrl}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get('content-type') || '';
  if (stream && contentType.includes('text/event-stream')) {
    const text = await response.text();
    return { ok: response.ok, status: response.status, contentType, raw: text };
  }

  const json = await response.json().catch(async () => ({
    raw: await response.text().catch(() => ''),
  }));
  return { ok: response.ok, status: response.status, contentType, json };
};

const buildChatAiBody = (sample) => ({
  message: sample.message,
  concern: sample.concern,
  mode: sample.mode || 'assistant',
  fastResponse: true,
  stream: false,
  conversationId: sample.conversationId || `smoke-${sample.name}-${Date.now()}`,
  locationCity: sample.locationCity || 'Patna',
  searchAreaCity: sample.locationCity || 'Patna',
  history: sample.history || [],
});

const buildVoiceChatBody = (sample) => ({
  text: sample.message,
  concern: sample.concern,
  mode: sample.mode || 'assistant',
  conversationId: sample.conversationId || `smoke-${sample.name}-${Date.now()}`,
  locationCity: sample.locationCity || 'Patna',
  searchAreaCity: sample.locationCity || 'Patna',
  voicePersona: 'female',
  preferLocalPlayback: false,
  ttsMode: sample.ttsMode || 'fast',
  stream: false,
  history: sample.history || [],
});

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (flag, fallback = '') => {
    const index = args.indexOf(flag);
    return index >= 0 ? String(args[index + 1] || fallback).trim() : fallback;
  };

  return {
    functionName: getValue('--function', 'both').toLowerCase(),
    message: getValue('--message', ''),
    concern: getValue('--concern', 'General Assistant'),
    mode: getValue('--mode', 'assistant'),
    locationCity: getValue('--city', 'Patna'),
    voicePersona: getValue('--voice-persona', 'female'),
    ttsMode: getValue('--tts-mode', 'fast'),
    stream: args.includes('--stream'),
    sample: args.includes('--sample') || !getValue('--message', ''),
  };
};

const main = async () => {
  await loadDotEnvFile('.env');
  await loadDotEnvFile('.env.local');

  const baseUrl = getBaseUrl();
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  const token = (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_USER_TOKEN || process.env.SUPABASE_JWT || '').trim();

  for (const key of REQUIRED_ENV_KEYS) {
    if (key === 'SUPABASE_ACCESS_TOKEN') continue;
    if (!(process.env[key] || process.env[`EXPO_PUBLIC_${key}`])) {
      fail(`Missing required env: ${key}`);
    }
  }
  if (!baseUrl) fail('SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) is required.');
  if (!anonKey) fail('SUPABASE_ANON_KEY is required.');
  if (!token) {
    fail('SUPABASE_ACCESS_TOKEN (or SUPABASE_USER_TOKEN / SUPABASE_JWT) is required so the edge function can authenticate as a user.');
  }

  const args = parseArgs();
  const samples = args.sample
    ? DEFAULT_MESSAGES.map((item) => ({
        ...item,
        concern: args.concern || item.concern,
        mode: args.mode || item.mode,
        locationCity: args.locationCity || item.locationCity,
        voicePersona: args.voicePersona || 'female',
        ttsMode: args.ttsMode || item.ttsMode || 'fast',
      }))
    : [{
        name: 'custom',
        concern: args.concern || 'General Assistant',
        message: args.message,
        mode: args.mode,
        locationCity: args.locationCity,
        voicePersona: args.voicePersona,
        ttsMode: args.ttsMode,
        voice: args.functionName === 'voice-chat',
      }];

  const runChatAi = args.functionName === 'chat-ai' || args.functionName === 'both';
  const runVoiceChat = args.functionName === 'voice-chat' || args.functionName === 'both';

  console.log(`\n[edge-smoke] baseUrl: ${baseUrl}`);
  console.log(`[edge-smoke] mode: ${args.functionName}`);
  console.log(`[edge-smoke] samples: ${samples.length}`);

  for (const sample of samples) {
    console.log(`\n=== Sample: ${sample.name || 'custom'} ===`);
    console.log(`Concern: ${sample.concern}`);
    console.log(`Message: ${sample.message}`);

    if (runChatAi) {
      const chatBody = buildChatAiBody(sample);
      const result = await invokeEdgeFunction({
        baseUrl,
        token,
        anonKey,
        fnName: 'chat-ai',
        body: chatBody,
        stream: false,
      });

      if (!result.ok) {
        failLine(`chat-ai HTTP ${result.status}`);
        console.log(result.json || '');
        throw new Error(`chat-ai returned HTTP ${result.status}`);
      }

      const payload = result.json;
      assertResponseShape(payload, 'chat-ai');
      const reply = String(payload?.data?.reply || payload?.data?.message || '');
      assertProfessionalText(reply, 'chat-ai');
      passLine(`chat-ai reply OK | model=${payload?.data?.model || payload?.data?.selectedModel || 'n/a'} | source=${payload?.data?.source || 'n/a'}`);
      console.log(`Reply: ${reply}`);
      if (payload?.data?.bookingPrompt) {
        console.log(`Booking prompt: ${payload.data.bookingPrompt}`);
      }
      if (payload?.data?.doctorRecommendations?.length) {
        console.log(`Doctor recommendations: ${payload.data.doctorRecommendations.length}`);
      }
    }

    if (runVoiceChat) {
      const voiceBody = buildVoiceChatBody(sample);
      const result = await invokeEdgeFunction({
        baseUrl,
        token,
        anonKey,
        fnName: 'voice-chat',
        body: voiceBody,
        stream: false,
      });

      if (!result.ok) {
        failLine(`voice-chat HTTP ${result.status}`);
        console.log(result.json || '');
        throw new Error(`voice-chat returned HTTP ${result.status}`);
      }

      const payload = result.json;
      assertResponseShape(payload, 'voice-chat');
      const reply = String(payload?.data?.reply || payload?.data?.text || '');
      assertProfessionalText(reply, 'voice-chat');
      if (payload?.data?.audio && typeof payload.data.audio === 'string') {
        passLine(`voice-chat reply OK | audio=${payload.data.audio.length} chars | tts=${payload?.data?.ttsModel || 'n/a'}`);
      } else if (payload?.data?.ttsError) {
        warnLine(`voice-chat text OK but TTS reported: ${payload.data.ttsError}`);
      } else {
        warnLine('voice-chat returned text without audio; check TTS config.');
      }
      console.log(`Reply: ${reply}`);
      if (payload?.data?.spokenText) {
        console.log(`Spoken text: ${payload.data.spokenText}`);
      }
    }
  }

  console.log('\n[edge-smoke] All selected edge smoke checks completed.');
};

main().catch((error) => {
  console.error(`\n[edge-smoke] FAILED: ${error?.message || error}`);
  process.exit(1);
});
