// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const parseEnvInt = (key: string, fallback: number): number => {
  const parsed = Number((Deno.env.get(key) || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const COMMUNITY_SCAN_MAX_BYTES = Math.max(
  512 * 1024,
  Math.min(12 * 1024 * 1024, parseEnvInt('COMMUNITY_IMAGE_SCAN_MAX_BYTES', 8 * 1024 * 1024))
);
const GEMINI_TIMEOUT_MS = Math.max(5000, Math.min(25000, parseEnvInt('COMMUNITY_IMAGE_SCAN_GEMINI_TIMEOUT_MS', 15000)));
const GEMINI_ATTEMPTS = Math.max(1, Math.min(2, parseEnvInt('COMMUNITY_IMAGE_SCAN_GEMINI_ATTEMPTS', 1)));

const clipText = (value: string, maxLength: number): string => {
  const text = (value || '').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  if (!bytes || bytes.length === 0) return '';
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const normalizeAllow = (value: any): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'allow', 'allowed', 'safe', 'yes'].includes(normalized)) return true;
    if (['false', 'block', 'blocked', 'unsafe', 'no'].includes(normalized)) return false;
  }
  return null;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 8);
};

const extractJsonObjectText = (raw: string): string | null => {
  const text = (raw || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '```').replace(/```/g, '').trim();
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) return cleaned;
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return cleaned.slice(first, last + 1);
  return null;
};

type ModerationDecision = {
  allow: boolean;
  reason: string;
  labels: string[];
  confidence: number | null;
};

const parseDecision = (rawText: string): ModerationDecision => {
  const raw = (rawText || '').trim();
  const jsonCandidate = extractJsonObjectText(raw);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      const allow = normalizeAllow(parsed?.allow);
      if (allow !== null) {
        return {
          allow,
          reason: clipText(String(parsed?.reason || ''), 240),
          labels: toStringArray(parsed?.labels),
          confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed?.confidence) : null,
        };
      }
    } catch {
      // no-op
    }
  }

  const lower = raw.toLowerCase();
  const blockedSignals = ['nudity', 'sexual', 'porn', 'gore', 'graphic violence', 'self-harm', 'hate symbol'];
  const likelyBlocked = blockedSignals.some((signal) => lower.includes(signal));
  const likelyAllowed = lower.includes('allow') || lower.includes('safe');

  return {
    allow: likelyAllowed && !likelyBlocked,
    reason: likelyBlocked
      ? 'Blocked by AI safety scan due to adult/violent graphic content.'
      : 'Approved by AI safety scan.',
    labels: [],
    confidence: null,
  };
};

const createServiceClient = () => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service role is not configured.');
  return createClient(url, key);
};

const getGeminiModel = (): string => {
  const fromEnv = (Deno.env.get('GEMINI_MODEL') || '').trim();
  return fromEnv || DEFAULT_GEMINI_MODEL;
};

// OpenAI moderation path intentionally disabled (Gemini-only mode).

const buildModerationPrompt = (): string =>
  [
    'You are a strict image safety classifier for a health community social feed.',
    'Decide if this image is safe to publish in community timeline.',
    'BLOCK when image includes: sexual nudity, explicit sexual content, pornography, graphic violence/gore, self-harm, hate symbols, or abuse.',
    'ALLOW when image is normal health content: lab reports, prescriptions, medicine strips, food/exercise photos, non-graphic body-part context.',
    'Return strict JSON only with this shape:',
    '{ "allow": true|false, "reason": "short reason", "labels": ["category tags"], "confidence": 0.0 }',
  ].join('\n');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const invokeGeminiModeration = async (args: {
  apiKey: string;
  mimeType: string;
  base64Data: string;
}): Promise<{ rawText: string; model: string }> => {
  const model = getGeminiModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${args.apiKey}`;

  const body = {
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 220,
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildModerationPrompt() },
          {
            inline_data: {
              mime_type: args.mimeType,
              data: args.base64Data,
            },
          },
        ],
      },
    ],
  };

  let lastError: any = null;
  for (let attempt = 1; attempt <= GEMINI_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('request_timeout'), GEMINI_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || `Gemini moderation failed (${response.status})`);
      }

      const rawText =
        (payload?.candidates || [])
          .flatMap((candidate: any) => candidate?.content?.parts || [])
          .map((part: any) => (typeof part?.text === 'string' ? part.text.trim() : ''))
          .find((text: string) => text.length > 0) || '';

      if (!rawText) {
        throw new Error('Gemini returned empty moderation response.');
      }

      return { rawText, model };
    } catch (error) {
      lastError = error;
      if (attempt < GEMINI_ATTEMPTS) await sleep(250 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError?.message || 'Gemini moderation failed.');
};


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization') || '';
    const accessToken = authHeader.replace('Bearer ', '').trim();
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceClient = createServiceClient();
    const {
      data: { user },
      error: authError,
    } = await serviceClient.auth.getUser(accessToken);
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const bucket = typeof body?.bucket === 'string' && body.bucket.trim() ? body.bucket.trim() : 'community-posts';
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';

    if (!filePath) {
      throw new Error('filePath is required.');
    }
    if (!filePath.startsWith(`${user.id}/`)) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized file path.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!mimeType.startsWith('image/')) {
      throw new Error('Only image files can be moderated here.');
    }

    const { data: fileBlob, error: downloadError } = await serviceClient.storage.from(bucket).download(filePath);
    if (downloadError || !fileBlob) {
      throw new Error(downloadError?.message || 'Could not read uploaded image.');
    }

    const fileBytes = new Uint8Array(await fileBlob.arrayBuffer());
    if (!fileBytes.byteLength) {
      throw new Error('Uploaded image is empty.');
    }
    if (fileBytes.byteLength > COMMUNITY_SCAN_MAX_BYTES) {
      throw new Error('Image is too large for moderation scan. Please upload up to 8 MB.');
    }

    const base64Data = encodeBase64(fileBytes);

    const geminiApiKey = (Deno.env.get('GEMINI_API_KEY') || '').trim();
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY is required for image moderation (Gemini-only mode).');
    }

    console.log('[moderate-community-image] Provider Mode -> Gemini only (OpenAI disabled by code)');

    const result = await invokeGeminiModeration({
      apiKey: geminiApiKey,
      mimeType,
      base64Data,
    });

    const provider: 'gemini' = 'gemini';
    const model = result.model;
    const rawText = result.rawText;
    const decision = parseDecision(rawText);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          allow: decision.allow,
          reason: decision.reason || (decision.allow ? 'Approved by safety scan.' : 'Blocked by safety scan.'),
          labels: decision.labels,
          confidence: decision.confidence,
          provider,
          model,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('moderate-community-image failed:', error?.message || error);
    return new Response(
      JSON.stringify({
        success: false,
        message: clipText(error?.message || 'Failed to moderate community image.', 320),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});


