import React from 'react';
import { runAfterInteractions } from '../src/utils/afterInteractions';
import { useFocusEffect } from 'expo-router';

type DeferredFocusSyncOptions = {
  sync: () => Promise<unknown> | unknown;
  delayMs?: number;
  shouldShowInitialLoading?: () => boolean;
  onInitialLoadingStart?: () => void;
  onInitialLoadingEnd?: () => void;
};

export const useDeferredFocusSync = ({
  sync,
  delayMs = 120,
  shouldShowInitialLoading,
  onInitialLoadingStart,
  onInitialLoadingEnd,
}: DeferredFocusSyncOptions) => {
  const hasSyncedOnceRef = React.useRef(false);
  const syncRef = React.useRef(sync);
  const shouldShowInitialLoadingRef = React.useRef(shouldShowInitialLoading);
  const onInitialLoadingStartRef = React.useRef(onInitialLoadingStart);
  const onInitialLoadingEndRef = React.useRef(onInitialLoadingEnd);

  React.useEffect(() => {
    syncRef.current = sync;
    shouldShowInitialLoadingRef.current = shouldShowInitialLoading;
    onInitialLoadingStartRef.current = onInitialLoadingStart;
    onInitialLoadingEndRef.current = onInitialLoadingEnd;
  }, [onInitialLoadingEnd, onInitialLoadingStart, shouldShowInitialLoading, sync]);

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      let delayTimer: ReturnType<typeof setTimeout> | null = null;
      let interactionTask: { cancel?: () => void } | null = null;
      const isFirstSync = !hasSyncedOnceRef.current;
      const showInitialLoading = isFirstSync && Boolean(shouldShowInitialLoadingRef.current?.());

      interactionTask = runAfterInteractions(() => {
        delayTimer = setTimeout(() => {
          if (!isActive) return;

          if (showInitialLoading) {
            onInitialLoadingStartRef.current?.();
          }

          Promise.resolve(syncRef.current())
            .catch((error) => {
              if (__DEV__) console.warn('[useDeferredFocusSync] Focus sync skipped:', error);
            })
            .finally(() => {
              if (!isActive) return;
              hasSyncedOnceRef.current = true;
              if (showInitialLoading) {
                onInitialLoadingEndRef.current?.();
              }
            });
        }, delayMs);
      });

      return () => {
        isActive = false;
        if (delayTimer) {
          clearTimeout(delayTimer);
        }
        interactionTask?.cancel?.();
        if (showInitialLoading) {
          onInitialLoadingEndRef.current?.();
        }
      };
    }, [delayMs])
  );
};
