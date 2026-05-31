import React from 'react';
import { PanResponder } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppMode } from '../context/AppModeContext';

type SwipeTabKey =
  | 'index'
  | 'daily-engine'
  | 'appointments'
  | 'food-log'
  | 'records'
  | 'chat'
  | 'community'
  | 'admin-dashboard'
  | 'admin-doctors'
  | 'admin-settings'
  | 'doctor-dashboard'
  | 'doctor-slots'
  | 'doctor-chats'
  | 'doctor-community'
  | 'doctor-patients';

const TAB_PATHS: Record<SwipeTabKey, string> = {
  index: '/(tabs)',
  'daily-engine': '/daily-engine',
  appointments: '/appointments',
  'food-log': '/food-log',
  records: '/records',
  chat: '/chat',
  community: '/community',
  'admin-dashboard': '/admin/dashboard',
  'admin-doctors': '/admin/doctors',
  'admin-settings': '/admin/settings',
  'doctor-dashboard': '/doctor/dashboard',
  'doctor-slots': '/doctor/slots',
  'doctor-chats': '/doctor/chats',
  'doctor-community': '/doctor/community',
  'doctor-patients': '/doctor/patients',
};

const REVERSAL_TAB_ORDER: SwipeTabKey[] = ['index', 'daily-engine', 'food-log', 'community'];
const TELECONSULT_TAB_ORDER: SwipeTabKey[] = ['index', 'appointments', 'records', 'chat', 'community'];
const ADMIN_TAB_ORDER: SwipeTabKey[] = ['admin-dashboard', 'admin-doctors', 'admin-settings'];
const DOCTOR_TAB_ORDER: SwipeTabKey[] = ['doctor-dashboard', 'doctor-slots', 'doctor-chats', 'doctor-community', 'doctor-patients'];

const SWIPE_CAPTURE_DISTANCE = 12;
const SWIPE_TRIGGER_DISTANCE = 54;
const SWIPE_MIN_VELOCITY = 0.16;
const SWIPE_DIRECTION_RATIO = 1.12;
const NAVIGATION_LOCK_MS = 260;

const canCaptureHorizontalSwipe = (dx: number, dy: number): boolean => {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < SWIPE_CAPTURE_DISTANCE) return false;
  if (absX < absY * SWIPE_DIRECTION_RATIO) return false;
  return true;
};

export const useTabSwipeNavigation = (
  currentTab: SwipeTabKey,
  options?: { disabled?: boolean }
) => {
  const router = useRouter();
  const { mode } = useAppMode();
  const isLockedRef = React.useRef(false);
  const disabled = Boolean(options?.disabled);

  const tabOrder = React.useMemo(() => {
    if (String(currentTab).startsWith('admin-')) return ADMIN_TAB_ORDER;
    if (String(currentTab).startsWith('doctor-')) return DOCTOR_TAB_ORDER;
    return mode === 'reversal' ? REVERSAL_TAB_ORDER : TELECONSULT_TAB_ORDER;
  }, [mode, currentTab]);

  const navigateToNeighborTab = React.useCallback(
    (direction: 'left' | 'right') => {
      if (disabled || isLockedRef.current) return;
      const currentIndex = tabOrder.indexOf(currentTab);
      if (currentIndex < 0) return;

      const targetIndex = direction === 'left' ? currentIndex + 1 : currentIndex - 1;
      if (targetIndex < 0 || targetIndex >= tabOrder.length) return;

      const targetTab = tabOrder[targetIndex];
      const targetPath = TAB_PATHS[targetTab];
      if (!targetPath) return;

      isLockedRef.current = true;
      router.replace(targetPath as any);
      setTimeout(() => {
        isLockedRef.current = false;
      }, NAVIGATION_LOCK_MS);
    },
    [currentTab, disabled, router, tabOrder]
  );

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          if (disabled || isLockedRef.current) return false;
          return canCaptureHorizontalSwipe(gestureState.dx, gestureState.dy);
        },
        onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
          if (disabled || isLockedRef.current) return false;
          return canCaptureHorizontalSwipe(gestureState.dx, gestureState.dy);
        },
        onPanResponderRelease: (_event, gestureState) => {
          if (disabled || isLockedRef.current) return;
          const { dx, dy, vx } = gestureState;
          if (!canCaptureHorizontalSwipe(dx, dy)) return;

          const absX = Math.abs(dx);
          const didSwipeByDistance = absX >= SWIPE_TRIGGER_DISTANCE;
          const didSwipeByVelocity = absX >= SWIPE_CAPTURE_DISTANCE && Math.abs(vx) >= SWIPE_MIN_VELOCITY;
          if (!didSwipeByDistance && !didSwipeByVelocity) return;

          if (dx < 0) {
            navigateToNeighborTab('left');
            return;
          }
          navigateToNeighborTab('right');
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => false,
      }),
    [disabled, navigateToNeighborTab]
  );

  return panResponder.panHandlers;
};
