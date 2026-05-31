import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';

export type MedicalReportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface MedicalReport {
  id: string;
  patientId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSizeBytes: number;
  source: string;
  reportType: string | null;
  analysisStatus: MedicalReportStatus;
  aiSummary: string;
  aiKeyPoints: string[];
  aiStructured: Record<string, any>;
  extractedText: string;
  analysisError: string | null;
  analyzedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalReportChatMessage {
  id: string;
  reportId: string;
  patientId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export const MEDICAL_REPORT_QUERY_KEYS = {
  reports: ['medical-reports'] as const,
  reportMessages: (reportId: string | null) => ['medical-reports', 'messages', reportId || 'none'] as const,
};
const MAX_REPORT_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_UPLOAD_MB = 8;
const FREE_PLAN_REPORT_UPLOAD_LIMIT = 5;
const FREE_PLAN_REPORT_UPLOAD_WINDOW_HOURS = 24;
const FREE_PLAN_REPORT_UPLOAD_WINDOW_MS = FREE_PLAN_REPORT_UPLOAD_WINDOW_HOURS * 60 * 60 * 1000;
const PRO_ACTIVE_STATUSES = new Set(['active', 'trialing', 'grace']);

export type ReportUploadCategory = 'report' | 'prescription';

const sanitizeFileName = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const getReadableUploadError = (error: any): string => {
  const message = typeof error?.message === 'string' ? error.message : String(error || '');
  if (!message) return 'Upload failed.';

  const normalized = message.toLowerCase();
  if (normalized.includes('max upload size') || normalized.includes('file too large')) {
    return `Report size exceeds ${MAX_REPORT_UPLOAD_MB} MB limit. Please compress PDF/image and retry.`;
  }
  if (normalized.includes('network request failed') || normalized.includes('network error')) {
    return 'Could not read/upload the file on this device. Please try another file (PDF/image) or retry.';
  }
  if (normalized.includes('bucket') && normalized.includes('not found')) {
    return 'Storage bucket medical-reports is missing. Please run latest Supabase migration.';
  }
  if (normalized.includes('relation') && normalized.includes('medical_reports')) {
    return 'medical_reports table is missing. Please run latest Supabase migration.';
  }
  return message;
};

const normalizeAnalysisErrorMessage = (rawMessage: string): string => {
  const message = (rawMessage || '').trim();
  if (!message) {
    return 'AI report analysis failed. Please try again.';
  }

  const normalized = message.toLowerCase();
  const isQuotaIssue =
    normalized.includes('quota exceeded') ||
    normalized.includes('rate limit') ||
    normalized.includes('generate_content_free_tier') ||
    normalized.includes('resource_exhausted');

  if (isQuotaIssue) {
    const retryMatch = message.match(/retry in\s+([\d.]+)\s*s/i);
    const retrySeconds = retryMatch ? Number.parseFloat(retryMatch[1]) : NaN;
    const retryHint =
      Number.isFinite(retrySeconds) && retrySeconds > 0
        ? `Please retry in about ${Math.ceil(retrySeconds)} seconds.`
        : 'Please retry in 1-2 minutes.';
    return `AI scanner is temporarily busy. ${retryHint}`;
  }

  return message;
};

export const getMedicalReportAnalysisErrorMessage = (rawError: string | null | undefined): string => {
  const message = typeof rawError === 'string' ? rawError.trim() : '';
  if (!message) {
    return 'AI scan failed. Re-upload or try another file.';
  }
  return normalizeAnalysisErrorMessage(message);
};

const extractEdgeFunctionErrorMessage = async (error: any): Promise<string> => {
  const baseMessage =
    typeof error?.message === 'string' && error.message.trim().length > 0
      ? error.message.trim()
      : 'Edge Function failed.';

  const response = (error as any)?.context as Response | undefined;
  if (!response) {
    return baseMessage;
  }

  let detailed = '';
  try {
    const payload = await response.clone().json();
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      detailed = payload.message.trim();
    } else if (typeof payload?.error === 'string' && payload.error.trim()) {
      detailed = payload.error.trim();
    }
  } catch (_jsonError) {
    try {
      const text = await response.clone().text();
      if (text?.trim()) {
        detailed = text.trim();
      }
    } catch (_textError) {
      // no-op
    }
  }

  if (!detailed) {
    if (response.status === 404) {
      return 'Edge function analyze-medical-report is not deployed.';
    }
    if (response.status === 401 || response.status === 403) {
      return 'Unauthorized to run report analysis. Please login again.';
    }
    if (response.status >= 500) {
      return 'Report analysis function failed on server. Check function logs.';
    }
    return normalizeAnalysisErrorMessage(baseMessage);
  }

  return normalizeAnalysisErrorMessage(detailed);
};

const isTransientAnalyzeInvokeFailure = (error: any): boolean => {
  const message =
    typeof error?.message === 'string' && error.message.trim().length > 0
      ? error.message.trim().toLowerCase()
      : '';
  const response = (error as any)?.context as Response | undefined;

  if (!response) {
    return true;
  }

  const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  if (transientStatuses.has(response.status)) {
    return true;
  }

  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('timeout') ||
    message.includes('gateway') ||
    message.includes('temporarily busy')
  );
};

const uploadToMedicalReportsBucket = async (params: {
  filePath: string;
  fileName: string;
  fileUri: string;
  mimeType: string;
}): Promise<{ byteSize: number | null }> => {
  const { filePath, fileName, fileUri, mimeType } = params;
  const errors: string[] = [];

  // Strategy 1: Blob upload (preferred)
  try {
    const fileResponse = await fetch(fileUri);
    const fileBlob = await fileResponse.blob();
    const { error } = await supabase.storage
      .from('medical-reports')
      .upload(filePath, fileBlob, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      throw error;
    }

    return { byteSize: Number((fileBlob as any)?.size || 0) || null };
  } catch (blobError: any) {
    errors.push(`blob:${blobError?.message || 'failed'}`);
  }

  // Strategy 2: FormData URI upload fallback (more compatible on some Android devices)
  try {
    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: mimeType,
    } as any);

    const { error } = await supabase.storage
      .from('medical-reports')
      .upload(filePath, formData as any, {
        upsert: false,
      });

    if (error) {
      const message = typeof (error as any)?.message === 'string' ? (error as any).message.toLowerCase() : '';
      if (message.includes('deleted_at') || message.includes('deleted_by')) {
        throw new Error('Soft-delete migration is missing. Please run latest Supabase migration and retry.');
      }
      throw error;
    }

    return { byteSize: null };
  } catch (formError: any) {
    errors.push(`form:${formError?.message || 'failed'}`);
  }

  // Strategy 3: Raw bytes upload fallback
  try {
    const fileResponse = await fetch(fileUri);
    const fileArrayBuffer = await fileResponse.arrayBuffer();
    const fileBytes = new Uint8Array(fileArrayBuffer);
    const { error } = await supabase.storage
      .from('medical-reports')
      .upload(filePath, fileBytes, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      const message = typeof (error as any)?.message === 'string' ? (error as any).message.toLowerCase() : '';
      if (message.includes('deleted_at') || message.includes('deleted_by')) {
        throw new Error('Soft-delete migration is missing. Please run latest Supabase migration and retry.');
      }
      throw error;
    }

    return { byteSize: Number(fileBytes.byteLength || 0) || null };
  } catch (bytesError: any) {
    errors.push(`bytes:${bytesError?.message || 'failed'}`);
    throw new Error(errors.join(' | '));
  }
};

const mapReportRow = (row: any): MedicalReport => ({
  id: row.id,
  patientId: row.patient_id,
  fileName: row.file_name || 'Report',
  filePath: row.file_path || '',
  mimeType: row.mime_type || 'application/octet-stream',
  fileSizeBytes: Number(row.file_size_bytes || 0),
  source: row.source || 'upload',
  reportType: row.report_type || null,
  analysisStatus: (row.analysis_status || 'pending') as MedicalReportStatus,
  aiSummary: row.ai_summary || '',
  aiKeyPoints: Array.isArray(row.ai_key_points) ? row.ai_key_points : [],
  aiStructured: typeof row.ai_structured === 'object' && row.ai_structured ? row.ai_structured : {},
  extractedText: row.extracted_text || '',
  analysisError: row.analysis_error || null,
  analyzedAt: row.analyzed_at || null,
  deletedAt: row.deleted_at || null,
  createdAt: row.created_at || new Date().toISOString(),
  updatedAt: row.updated_at || new Date().toISOString(),
});

const mapMessageRow = (row: any): MedicalReportChatMessage => ({
  id: row.id,
  reportId: row.report_id,
  patientId: row.patient_id,
  role: row.role === 'assistant' ? 'assistant' : 'user',
  content: row.content || '',
  createdAt: row.created_at || new Date().toISOString(),
});

const isSubscriptionCurrentlyActive = (subscription?: {
  status?: string | null;
  expiresAt?: string | null;
} | null): boolean => {
  const status = String(subscription?.status || '').toLowerCase();
  if (!PRO_ACTIVE_STATUSES.has(status)) return false;

  const expiryRaw = String(subscription?.expiresAt || '').trim();
  if (!expiryRaw) return true;

  const expiryMs = new Date(expiryRaw).getTime();
  return Number.isFinite(expiryMs) ? expiryMs > Date.now() : true;
};

const hasActiveProSubscriptionInDb = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('status, expires_at')
    .eq('user_id', userId)
    .eq('plan_code', 'pro')
    .in('status', Array.from(PRO_ACTIVE_STATUSES))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('Could not verify pro subscription from DB:', error.message);
    return false;
  }

  if (!data) return false;

  const expiryRaw = String(data.expires_at || '').trim();
  if (!expiryRaw) return true;

  const expiryMs = new Date(expiryRaw).getTime();
  return Number.isFinite(expiryMs) ? expiryMs > Date.now() : true;
};

const normalizeUploadInput = (
  value: DocumentPicker.DocumentPickerAsset | { asset: DocumentPicker.DocumentPickerAsset; category?: ReportUploadCategory }
): { asset: DocumentPicker.DocumentPickerAsset; category: ReportUploadCategory } => {
  if (value && typeof value === 'object' && 'asset' in value) {
    return {
      asset: value.asset,
      category: value.category === 'prescription' ? 'prescription' : 'report',
    };
  }

  return {
    asset: value as DocumentPicker.DocumentPickerAsset,
    category: 'report',
  };
};

const formatRetryDuration = (ms: number): string => {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalMinutes = Math.max(1, Math.ceil(safeMs / (60 * 1000)));

  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${hours}h ${minutes}m`;
};

export const useMedicalReports = () => {
  const { session } = useAuthContext();

  return useQuery({
    queryKey: MEDICAL_REPORT_QUERY_KEYS.reports,
    enabled: !!session?.user?.id,
    queryFn: async () => {
      if (!session?.user?.id) {
        return [] as MedicalReport[];
      }

      const { data, error } = await supabase
        .from('medical_reports')
        .select('*')
        .eq('patient_id', session.user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        const message = typeof (error as any)?.message === 'string' ? (error as any).message.toLowerCase() : '';
        if (message.includes('deleted_at') || message.includes('deleted_by')) {
          throw new Error('Soft-delete migration is missing. Please run latest Supabase migration and retry.');
        }
        throw error;
      }

      return (data || []).map(mapReportRow);
    },
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });
};

export const useUploadMedicalReport = () => {
  const queryClient = useQueryClient();
  const { session, user } = useAuthContext();

  return useMutation({
    mutationFn: async (
      uploadInput:
        | DocumentPicker.DocumentPickerAsset
        | { asset: DocumentPicker.DocumentPickerAsset; category?: ReportUploadCategory }
    ) => {
      try {
        if (!session?.user?.id || !session.access_token) {
          throw new Error('Please login again to upload report.');
        }

        const { asset, category } = normalizeUploadInput(uploadInput);

        if (!asset?.uri) {
          throw new Error('Selected file is invalid. Please choose a valid file.');
        }
        if (typeof asset.size === 'number' && asset.size > MAX_REPORT_UPLOAD_BYTES) {
          throw new Error(`Max upload size is ${MAX_REPORT_UPLOAD_MB} MB. Please upload a smaller report.`);
        }

        let isProUser = isSubscriptionCurrentlyActive({
          status: user?.subscription?.status,
          expiresAt: user?.subscription?.expiresAt || null,
        });

        if (!isProUser) {
          isProUser = await hasActiveProSubscriptionInDb(session.user.id);
        }

        const uploadsWindowStartIso = new Date(Date.now() - FREE_PLAN_REPORT_UPLOAD_WINDOW_MS).toISOString();
        const { data: recentUploads, error: recentUploadsError } = await supabase
          .from('medical_reports')
          .select('id, created_at')
          .eq('patient_id', session.user.id)
          .gte('created_at', uploadsWindowStartIso)
          .order('created_at', { ascending: true })
          .limit(FREE_PLAN_REPORT_UPLOAD_LIMIT);

        if (recentUploadsError) {
          throw recentUploadsError;
        }

        const uploadedInWindow = Array.isArray(recentUploads) ? recentUploads.length : 0;
        if (!isProUser && uploadedInWindow >= FREE_PLAN_REPORT_UPLOAD_LIMIT) {
          const oldestUploadMs = new Date(recentUploads?.[0]?.created_at || '').getTime();
          const retryAfterMs = Number.isFinite(oldestUploadMs)
            ? Math.max(0, oldestUploadMs + FREE_PLAN_REPORT_UPLOAD_WINDOW_MS - Date.now())
            : FREE_PLAN_REPORT_UPLOAD_WINDOW_MS;
          const retryAfterLabel = formatRetryDuration(retryAfterMs);

          throw new Error(
            `Free plan allows up to ${FREE_PLAN_REPORT_UPLOAD_LIMIT} uploads in ${FREE_PLAN_REPORT_UPLOAD_WINDOW_HOURS} hours. Please try again in ${retryAfterLabel}, or upgrade to Pro for higher limits.`
          );
        }

        const fileName = sanitizeFileName(asset.name || `report_${Date.now()}`);
        const filePath = `${session.user.id}/${Date.now()}_${fileName}`;
        const mimeType = asset.mimeType || 'application/octet-stream';
        const uploadResult = await uploadToMedicalReportsBucket({
          filePath,
          fileName,
          fileUri: asset.uri,
          mimeType,
        });

        const { data: inserted, error: insertError } = await supabase
          .from('medical_reports')
          .insert({
            patient_id: session.user.id,
            file_name: fileName,
            file_path: filePath,
            mime_type: mimeType,
            file_size_bytes: Number(asset.size || uploadResult.byteSize || 0),
            source: category === 'prescription' ? 'prescription_upload' : 'upload',
            analysis_status: 'pending',
          })
          .select('*')
          .single();

        if (insertError || !inserted) {
          throw insertError || new Error('Report row insert failed.');
        }

        const functionsClient = supabase.functions;
        functionsClient.setAuth(session.access_token);

        // Fire-and-forget analysis so UI can open report assistant immediately after upload.
        void (async () => {
          try {
            const { data: analyzeData, error: analyzeError } = await functionsClient.invoke('analyze-medical-report', {
              body: {
                reportId: inserted.id,
                responseLanguage: 'en',
              },
            });

            if (analyzeError && isTransientAnalyzeInvokeFailure(analyzeError)) {
              console.warn('Analyze request timed out/transient error. Keeping report in processing state.', analyzeError);
              return;
            }

            const analyzeFailureMessage = analyzeError
              ? await extractEdgeFunctionErrorMessage(analyzeError)
              : analyzeData && analyzeData.success === false
              ? typeof analyzeData.message === 'string' && analyzeData.message.trim()
                ? normalizeAnalysisErrorMessage(analyzeData.message.trim())
                : 'AI analysis failed.'
              : null;

            if (analyzeFailureMessage) {
              await supabase
                .from('medical_reports')
                .update({
                  analysis_status: 'failed',
                  analysis_error: analyzeFailureMessage,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', inserted.id)
                .eq('patient_id', session.user.id);
            }
          } catch {
            // keep upload successful; analysis state will remain processing until next retry
          } finally {
            await queryClient.invalidateQueries({ queryKey: MEDICAL_REPORT_QUERY_KEYS.reports });
          }
        })();

        const normalizedInserted = {
          ...inserted,
          analysis_status: 'processing',
          analysis_error: null,
          updated_at: new Date().toISOString(),
        };

        return mapReportRow(normalizedInserted);
      } catch (error: any) {
        throw new Error(getReadableUploadError(error));
      }
    },
    onSuccess: (createdReport) => {
      queryClient.setQueryData(MEDICAL_REPORT_QUERY_KEYS.reports, (existing: MedicalReport[] | undefined) => {
        const list = Array.isArray(existing) ? existing : [];
        const withoutCurrent = list.filter((item) => item.id !== createdReport.id);
        return [createdReport, ...withoutCurrent];
      });
    },
  });
};

export const useReanalyzeMedicalReport = () => {
  const queryClient = useQueryClient();
  const { session } = useAuthContext();

  return useMutation({
    mutationFn: async ({ reportId }: { reportId: string }) => {
      if (!session?.user?.id || !session.access_token) {
        throw new Error('Please login again to re-analyze report.');
      }
      if (!reportId) {
        throw new Error('Report id is required.');
      }

      // Reset status to processing
      await supabase
        .from('medical_reports')
        .update({
          analysis_status: 'processing',
          analysis_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reportId)
        .eq('patient_id', session.user.id);

      // Clear old chat messages so the new initial message shows fresh
      await supabase
        .from('medical_report_chat_messages')
        .delete()
        .eq('report_id', reportId)
        .eq('patient_id', session.user.id);

      // Re-invoke analysis edge function
      const functionsClient = supabase.functions;
      functionsClient.setAuth(session.access_token);
      const { data: analyzeData, error: analyzeError } = await functionsClient.invoke('analyze-medical-report', {
        body: { reportId, responseLanguage: 'en' },
      });

      if (analyzeError && isTransientAnalyzeInvokeFailure(analyzeError)) {
        return { reportId, queued: true };
      }

      const analyzeFailureMessage = analyzeError
        ? await extractEdgeFunctionErrorMessage(analyzeError)
        : analyzeData && analyzeData.success === false
        ? typeof analyzeData.message === 'string' && analyzeData.message.trim()
          ? normalizeAnalysisErrorMessage(analyzeData.message.trim())
          : 'AI re-analysis failed.'
        : null;

      if (analyzeFailureMessage) {
        await supabase
          .from('medical_reports')
          .update({
            analysis_status: 'failed',
            analysis_error: analyzeFailureMessage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reportId)
          .eq('patient_id', session.user.id);
      }

      return { reportId };
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: MEDICAL_REPORT_QUERY_KEYS.reports });
      queryClient.invalidateQueries({ queryKey: MEDICAL_REPORT_QUERY_KEYS.reportMessages(variables.reportId) });
    },
  });
};

export const useMedicalReportMessages = (
  reportId: string | null,
  options?: { enabled?: boolean }
) => {
  const { session } = useAuthContext();
  const queryEnabled = options?.enabled ?? true;

  return useQuery({
    queryKey: MEDICAL_REPORT_QUERY_KEYS.reportMessages(reportId),
    enabled: queryEnabled && !!session?.user?.id && !!reportId,
    queryFn: async () => {
      if (!session?.user?.id || !reportId) {
        return [] as MedicalReportChatMessage[];
      }

      const { data, error } = await supabase
        .from('medical_report_chat_messages')
        .select('*')
        .eq('patient_id', session.user.id)
        .eq('report_id', reportId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      return (data || []).map(mapMessageRow);
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
};

export const useSoftDeleteMedicalReport = () => {
  const queryClient = useQueryClient();
  const { session } = useAuthContext();

  return useMutation({
    mutationFn: async ({ reportId }: { reportId: string }) => {
      if (!session?.user?.id) {
        throw new Error('Please login again to delete report.');
      }
      if (!reportId) {
        throw new Error('Report id is required.');
      }

      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('medical_reports')
        .update({
          deleted_at: nowIso,
          deleted_by: session.user.id,
          updated_at: nowIso,
        })
        .eq('id', reportId)
        .eq('patient_id', session.user.id)
        .is('deleted_at', null);

      if (error) {
        throw error;
      }
      return { reportId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEDICAL_REPORT_QUERY_KEYS.reports });
    },
  });
};

export const useAskMedicalReportQuestion = () => {
  const queryClient = useQueryClient();
  const { session } = useAuthContext();

  return useMutation({
    mutationFn: async ({ reportId, question }: { reportId: string; question: string }) => {
      if (!session?.access_token) {
        throw new Error('Please login again to continue report chat.');
      }

      const functionsClient = supabase.functions;
      functionsClient.setAuth(session.access_token);
      const { data, error } = await functionsClient.invoke('medical-report-chat', {
        body: { reportId, question, responseLanguage: 'en' },
      });

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.message || 'Could not answer this question.');
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: MEDICAL_REPORT_QUERY_KEYS.reportMessages(variables.reportId) });
    },
  });
};

export const useGetMedicalReportFileUrl = () => {
  return useMutation({
    mutationFn: async ({ filePath }: { filePath: string }) => {
      const { data, error } = await supabase.storage
        .from('medical-reports')
        .createSignedUrl(filePath, 60 * 10);

      if (error || !data?.signedUrl) {
        throw error || new Error('Could not create file URL.');
      }

      return data.signedUrl;
    },
  });
};

export interface ParsedPrescriptionMedicine {
  medicine_name: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
}

export const useParseDoctorPrescription = () => {
  const { session } = useAuthContext();

  return useMutation({
    mutationFn: async ({ doctorText }: { doctorText: string }): Promise<{ medicines: ParsedPrescriptionMedicine[] }> => {
      if (!session?.access_token) {
        throw new Error('Please login again to parse prescription.');
      }

      const functionsClient = supabase.functions;
      functionsClient.setAuth(session.access_token);
      const { data, error } = await functionsClient.invoke('parse-doctor-prescription', {
        body: { doctorText },
      });

      if (error) {
        throw error;
      }
      if (!data?.success) {
        throw new Error(data?.message || 'Could not parse prescription from doctor text.');
      }

      const medicines = Array.isArray(data?.data?.medicines) ? data.data.medicines : [];
      return { medicines };
    },
  });
};

