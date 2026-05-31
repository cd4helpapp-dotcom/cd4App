import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { useAuthContext } from '../context/AuthContext';
import { useMedicalReports } from './useMedicalReports';
import { useNotificationsSystem } from './useNotificationsSystem';

type LocalStorageStats = {
  localStorageBytes: number;
  localStorageKeys: number;
};

const STORAGE_INSIGHTS_QUERY_KEY = ['settings-storage-insights-local'];
const STORAGE_POLL_INTERVAL_MS = 25_000;
const CLEARABLE_KEY_PATTERNS: RegExp[] = [/^cd4_concern_interests$/i, /^cd4_cache_/i, /^react-query/i];

const getStringByteSize = (value: string): number => {
  if (!value) return 0;
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length * 2;
  }
};

const loadLocalStorageStats = async (): Promise<LocalStorageStats> => {
  const keys = await AsyncStorage.getAllKeys();
  if (!keys.length) {
    return { localStorageBytes: 0, localStorageKeys: 0 };
  }

  const entries = await AsyncStorage.multiGet(keys);
  const totalBytes = entries.reduce((sum, [key, value]) => {
    return sum + getStringByteSize(key) + getStringByteSize(value || '');
  }, 0);

  return {
    localStorageBytes: totalBytes,
    localStorageKeys: keys.length,
  };
};

export const formatBytes = (bytes: number): string => {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
  if (safeBytes < 1024 * 1024 * 1024) return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const useStorageInsights = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const notifications = useNotificationsSystem();
  const reportsQuery = useMedicalReports();

  const localStorageQuery = useQuery<LocalStorageStats>({
    queryKey: STORAGE_INSIGHTS_QUERY_KEY,
    queryFn: loadLocalStorageStats,
    staleTime: 10_000,
    refetchInterval: STORAGE_POLL_INTERVAL_MS,
  });

  useEffect(() => {
    const timer = setInterval(() => {
      void localStorageQuery.refetch();
      void reportsQuery.refetch();
      void notifications.refetch();
    }, STORAGE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [localStorageQuery.refetch, notifications.refetch, reportsQuery.refetch]);

  const reportsBytes = useMemo(
    () => (reportsQuery.data || []).reduce((sum, report) => sum + Number(report.fileSizeBytes || 0), 0),
    [reportsQuery.data]
  );
  const reportsCount = useMemo(() => (reportsQuery.data || []).length, [reportsQuery.data]);
  const unreadNotifications = Number(notifications.unreadCount || 0);

  const localStorageBytes = localStorageQuery.data?.localStorageBytes || 0;
  const localStorageKeys = localStorageQuery.data?.localStorageKeys || 0;
  const totalBytes = localStorageBytes + reportsBytes;

  const refreshAll = useCallback(async () => {
    await Promise.all([
      localStorageQuery.refetch(),
      reportsQuery.refetch(),
      notifications.refetch(),
    ]);
  }, [localStorageQuery, notifications, reportsQuery]);

  const clearLocalCache = useCallback(async () => {
    const allKeys = await AsyncStorage.getAllKeys();
    const removable = allKeys.filter((key) => CLEARABLE_KEY_PATTERNS.some((pattern) => pattern.test(key)));
    if (removable.length > 0) {
      await AsyncStorage.multiRemove(removable);
    }

    queryClient.clear();
    await refreshAll();
    return {
      removedKeys: removable.length,
    };
  }, [queryClient, refreshAll]);

  return {
    isLoading: localStorageQuery.isLoading || reportsQuery.isLoading || notifications.isLoading,
    localStorageBytes,
    localStorageKeys,
    reportsBytes,
    reportsCount,
    unreadNotifications,
    totalBytes,
    totalFormatted: formatBytes(totalBytes),
    localStorageFormatted: formatBytes(localStorageBytes),
    reportsFormatted: formatBytes(reportsBytes),
    refreshAll,
    clearLocalCache,
    refetching:
      localStorageQuery.isRefetching || reportsQuery.isRefetching || notifications.isLoading,
    userId: user?.id || null,
  };
};
