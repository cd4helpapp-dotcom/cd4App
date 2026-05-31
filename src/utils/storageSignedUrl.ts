import { supabase } from '../lib/supabase';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 10;

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

const isAbsoluteUrl = (value: string): boolean =>
  /^(https?:)?\/\//i.test(value) || /^data:/i.test(value) || /^blob:/i.test(value);

const extractPathFromSupabaseStorageUrl = (bucket: string, rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl);
    const decodedPath = decodeURIComponent(parsed.pathname || '');
    const markers = [
      `/storage/v1/object/public/${bucket}/`,
      `/storage/v1/object/sign/${bucket}/`,
      `/storage/v1/object/authenticated/${bucket}/`,
    ];
    for (const marker of markers) {
      const markerIndex = decodedPath.indexOf(marker);
      if (markerIndex < 0) continue;
      const path = decodedPath.slice(markerIndex + marker.length).trim();
      return path ? trimSlashes(path) : null;
    }
    return null;
  } catch {
    return null;
  }
};

export const normalizeStorageObjectPath = (bucket: string, rawValue: unknown): string | null => {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return null;

  const directStoragePath = extractPathFromSupabaseStorageUrl(bucket, value);
  if (directStoragePath) return directStoragePath;

  if (!isAbsoluteUrl(value)) {
    const normalized = trimSlashes(value);
    const bucketPrefix = `${bucket}/`;
    if (normalized.startsWith(bucketPrefix)) {
      return normalized.slice(bucketPrefix.length).trim() || null;
    }
    return normalized || null;
  }

  return null;
};

export const resolveStorageSignedUrl = async (args: {
  bucket: string;
  value: unknown;
  ttlSeconds?: number;
}): Promise<string> => {
  const rawValue = typeof args.value === 'string' ? args.value.trim() : '';
  if (!rawValue) return '';

  const normalizedPath = normalizeStorageObjectPath(args.bucket, rawValue);
  if (!normalizedPath) {
    return rawValue;
  }

  const ttlSeconds = Math.max(60, Math.floor(args.ttlSeconds || DEFAULT_SIGNED_URL_TTL_SECONDS));
  const { data, error } = await supabase.storage
    .from(args.bucket)
    .createSignedUrl(normalizedPath, ttlSeconds);

  if (error || !data?.signedUrl) {
    return rawValue;
  }

  return data.signedUrl;
};

export const resolveStorageSignedUrlsByPath = async (args: {
  bucket: string;
  values: Array<unknown>;
  ttlSeconds?: number;
}): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const ttlSeconds = Math.max(60, Math.floor(args.ttlSeconds || DEFAULT_SIGNED_URL_TTL_SECONDS));

  const uniquePaths = Array.from(
    new Set(
      args.values
        .map((value) => normalizeStorageObjectPath(args.bucket, value))
        .filter((path): path is string => Boolean(path))
    )
  );

  if (uniquePaths.length === 0) {
    return result;
  }

  await Promise.all(
    uniquePaths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from(args.bucket)
        .createSignedUrl(path, ttlSeconds);
      if (error || !data?.signedUrl) return;
      result.set(path, data.signedUrl);
    })
  );

  return result;
};
