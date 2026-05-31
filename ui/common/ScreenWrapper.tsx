import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
  useColorScheme,
  StyleProp,
  RefreshControl,
  KeyboardAvoidingViewProps,
  ScrollViewProps
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '../../constants/Colors';

export type ScreenWrapperProps = {
  children: React.ReactNode;
  /** Whether to wrap the content in a ScrollView */
  withScrollView?: boolean;
  /** Container styles for the outermost view */
  style?: StyleProp<ViewStyle>;
  /** Styles for the content container (applies to ScrollView or inner View) */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Whether to use a KeyboardAvoidingView */
  keyboardAvoiding?: boolean;
  /** Automatically apply safe area padding to top */
  applyTopInset?: boolean;
  /** Automatically apply safe area padding to bottom */
  applyBottomInset?: boolean;
  /** Extra padding added to the bottom on top of the inset */
  extraBottomPadding?: number;
  /** Pull to refresh function */
  onRefresh?: () => void;
  /** Pull to refresh state */
  refreshing?: boolean;
  /** Extra props for KeyboardAvoidingView */
  keyboardProps?: KeyboardAvoidingViewProps;
  /** Extra props for ScrollView */
  scrollViewProps?: ScrollViewProps;
};

/**
 * A highly reusable smart Screen Wrapper component that automatically handles:
 * - Theming and Background Colors
 * - Safe Area Insets (Top/Bottom, including Android Navigation Keys)
 * - Keyboard Avoiding Context
 * - ScrollView / RefreshControl behaviors
 */
export default function ScreenWrapper({
  children,
  withScrollView = true,
  style,
  contentContainerStyle,
  keyboardAvoiding = true,
  applyTopInset = true,
  applyBottomInset = true,
  extraBottomPadding = 24,
  onRefresh,
  refreshing = false,
  keyboardProps,
  scrollViewProps,
}: ScreenWrapperProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
  const insets = useSafeAreaInsets();

  const containerStyle = [
    styles.container,
    { backgroundColor: theme.background },
    style,
  ];

  // Dynamic content styles handling safe area insets
  const scrollContentStyle = [
    applyTopInset && { paddingTop: insets.top + 10 },
    applyBottomInset && { paddingBottom: Math.max(insets.bottom + extraBottomPadding, extraBottomPadding) },
    contentContainerStyle,
  ];

  const viewContentStyle = [
    { flex: 1 },
    applyTopInset && { paddingTop: insets.top },
    applyBottomInset && { paddingBottom: insets.bottom },
    contentContainerStyle,
  ];

  const renderContent = () => {
    if (withScrollView) {
      return (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={scrollContentStyle}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.tint}
                colors={[theme.tint]} // Android
              />
            ) : undefined
          }
          {...scrollViewProps}
        >
          {children}
        </ScrollView>
      );
    }

    return <View style={viewContentStyle}>{children}</View>;
  };

  if (keyboardAvoiding) {
    return (
      <KeyboardAvoidingView
        style={containerStyle}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        {...keyboardProps}
      >
        {renderContent()}
      </KeyboardAvoidingView>
    );
  }

  return <View style={containerStyle}>{renderContent()}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
