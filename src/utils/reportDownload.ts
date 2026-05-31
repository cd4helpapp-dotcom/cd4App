import { Linking, Platform } from 'react-native';
import { resolveStorageSignedUrl } from './storageSignedUrl';

const FALLBACK_REPORT_FILENAME = 'cd4-ai-clinical-snapshot.pdf';
const AI_REPORTS_BUCKET = 'ai-reports';
const AI_REPORT_SIGNED_URL_TTL_SECONDS = 60 * 10;

export const buildAiReportOpenUrl = (url: string): string => (url || '').trim();

export const buildAiReportDownloadUrl = (url: string, fileName: string = FALLBACK_REPORT_FILENAME): string => {
  const trimmedUrl = (url || '').trim();
  if (!trimmedUrl) return '';

  try {
    const parsed = new URL(trimmedUrl);
    parsed.searchParams.set('download', fileName);
    return parsed.toString();
  } catch {
    const separator = trimmedUrl.includes('?') ? '&' : '?';
    return `${trimmedUrl}${separator}download=${encodeURIComponent(fileName)}`;
  }
};

export const openAiReport = async (url: string): Promise<void> => {
  const accessUrl = await resolveStorageSignedUrl({
    bucket: AI_REPORTS_BUCKET,
    value: url,
    ttlSeconds: AI_REPORT_SIGNED_URL_TTL_SECONDS,
  });
  const openUrl = buildAiReportOpenUrl(accessUrl);
  if (!openUrl) {
    throw new Error('missing_ai_report_url');
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const opened = window.open(openUrl, '_blank', 'noopener,noreferrer');
    if (opened) return;
  }

  const canOpen = await Linking.canOpenURL(openUrl).catch(() => true);
  if (!canOpen) {
    throw new Error('cannot_open_ai_report_url');
  }

  await Linking.openURL(openUrl);
};

export const downloadAiReport = async (
  url: string,
  fileName: string = FALLBACK_REPORT_FILENAME,
): Promise<void> => {
  const accessUrl = await resolveStorageSignedUrl({
    bucket: AI_REPORTS_BUCKET,
    value: url,
    ttlSeconds: AI_REPORT_SIGNED_URL_TTL_SECONDS,
  });
  const downloadUrl = buildAiReportDownloadUrl(accessUrl, fileName);
  if (!downloadUrl) {
    throw new Error('missing_ai_report_url');
  }

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener noreferrer';
    anchor.target = '_blank';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return;
  }

  const canOpen = await Linking.canOpenURL(downloadUrl).catch(() => true);
  if (!canOpen) {
    throw new Error('cannot_open_ai_report_url');
  }

  await Linking.openURL(downloadUrl);
};
