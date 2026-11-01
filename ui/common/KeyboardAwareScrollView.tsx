import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import type { ScrollViewInstance } from 'react-native';

// Why this exists: the Android app runs edge-to-edge (Expo SDK 54 default), so `adjustResize`
// no longer shrinks the window when the keyboard opens. Screens that relied on it had inputs
// hidden under the keyboard. This wrapper pads for the keyboard on both platforms and scrolls
// the focused input into view (including when focus moves between fields with the keyboard open).

const GAP_ABOVE_KEYBOARD = 24;

type KeyboardScrollContextValue = { scrollToFocusedInput: () => void };
const KeyboardScrollContext = createContext<KeyboardScrollContextValue | null>(null);

// Inputs call this on focus so a field tapped while the keyboard is already open is revealed too.
export const useKeyboardScroll = () => useContext(KeyboardScrollContext);

type Props = ScrollViewProps & {
  children: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  // Height of any fixed header above this view that KeyboardAvoidingView should account for (iOS).
  keyboardVerticalOffset?: number;
};

export default function KeyboardAwareScrollView({
  children,
  containerStyle,
  keyboardVerticalOffset = 0,
  onScroll,
  onLayout,
  ...scrollProps
}: Props) {
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const isKeyboardVisibleRef = useRef(false);
  // Android: edge-to-edge means the window no longer resizes, and KeyboardAvoidingView is unreliable there.
  // Measure the keyboard ourselves and add that much space under the content so every field can scroll clear of it.
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const scrollToFocusedInput = useCallback(() => {
    if (Platform.OS === 'web') return;
    const input = TextInput.State.currentlyFocusedInput?.() as any;
    const scrollView = scrollRef.current as any;
    const innerView = scrollView?.getInnerViewRef?.() ?? scrollView?.getInnerViewNode?.();
    if (!input?.measureLayout || !innerView) return;

    // Wait one frame so KeyboardAvoidingView has applied its padding and the viewport is final.
    requestAnimationFrame(() => {
      input.measureLayout(
        innerView,
        (_x: number, y: number, _w: number, height: number) => {
          const viewport = viewportHeightRef.current;
          const top = scrollYRef.current;
          const inputBottom = y + height + GAP_ABOVE_KEYBOARD;
          if (viewport > 0 && y >= top && inputBottom <= top + viewport) return; // already visible
          const target = viewport > 0 ? Math.max(0, inputBottom - viewport) : Math.max(0, y - 120);
          scrollRef.current?.scrollTo({ y: Math.min(target, Math.max(0, y - 16)), animated: true });
        },
        () => {}
      );
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      isKeyboardVisibleRef.current = true;
      if (Platform.OS === 'android') setAndroidKeyboardHeight(event?.endCoordinates?.height || 0);
      // iOS fires before layout; give KeyboardAvoidingView time to animate.
      setTimeout(scrollToFocusedInput, Platform.OS === 'ios' ? 260 : 60);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      isKeyboardVisibleRef.current = false;
      if (Platform.OS === 'android') setAndroidKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToFocusedInput]);

  const contextValue = useMemo<KeyboardScrollContextValue>(
    () => ({
      scrollToFocusedInput: () => {
        if (isKeyboardVisibleRef.current) setTimeout(scrollToFocusedInput, 30);
      },
    }),
    [scrollToFocusedInput]
  );

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
    onScroll?.(event);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
    onLayout?.(event);
  };

  return (
    <KeyboardScrollContext.Provider value={contextValue}>
      <KeyboardAvoidingView
        style={[styles.flex, containerStyle]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={32}
          {...scrollProps}
          onScroll={handleScroll}
          onLayout={handleLayout}
          style={[styles.flex, scrollProps.style]}
        >
          {children}
          {Platform.OS === 'android' && androidKeyboardHeight > 0 ? <View style={{ height: androidKeyboardHeight }} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </KeyboardScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
