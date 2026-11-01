import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Layout, Radius, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'md' | 'lg' | 'sm';

type AppButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

const HEIGHTS: Record<Size, number> = { sm: 36, md: Layout.controlHeightCompact, lg: Layout.controlHeight };

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  fullWidth = true,
  leftIcon,
  rightIcon,
  style,
  accessibilityLabel,
  testID,
}: AppButtonProps) {
  const { theme } = useAppTheme();
  const isInactive = disabled || loading;

  const palette: Record<Variant, { bg: string; bgPressed: string; fg: string; border: string }> = {
    primary: { bg: theme.buttonPrimary, bgPressed: theme.primaryPressed, fg: theme.buttonText, border: theme.buttonPrimary },
    secondary: { bg: theme.primarySoft, bgPressed: theme.primaryBorder, fg: theme.primary, border: theme.primarySoft },
    outline: { bg: theme.cardBackground, bgPressed: theme.surfaceMuted, fg: theme.text, border: theme.borderColor },
    ghost: { bg: 'transparent', bgPressed: theme.surfaceMuted, fg: theme.primary, border: 'transparent' },
    danger: { bg: theme.danger, bgPressed: theme.danger, fg: theme.textInverse, border: theme.danger },
  };
  const colors = palette[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHTS[size],
          paddingHorizontal: size === 'sm' ? 14 : 20,
          backgroundColor: pressed ? colors.bgPressed : colors.bg,
          borderColor: colors.border,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: isInactive && !loading ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <View style={styles.content}>
          {leftIcon}
          <Text
            numberOfLines={1}
            style={[size === 'sm' ? Typography.label : Typography.bodyStrong, { color: colors.fg }]}
          >
            {title}
          </Text>
          {rightIcon}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
