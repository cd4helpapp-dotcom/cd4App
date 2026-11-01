import React, { forwardRef, useRef, useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useKeyboardScroll } from './KeyboardAwareScrollView';

type FormFieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;
  // Renders a show/hide toggle and manages secureTextEntry itself.
  isPassword?: boolean;
  // Fixed text shown before the input, e.g. "+91".
  prefix?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

const FormField = forwardRef<TextInputInstance, FormFieldProps>(
  ({ label, error, hint, leftIcon, rightSlot, isPassword, prefix, containerStyle, onFocus, onBlur, editable = true, multiline, ...inputProps }, ref) => {
    const { theme } = useAppTheme();
    const [isFocused, setIsFocused] = useState(false);
    const [isSecureVisible, setIsSecureVisible] = useState(false);
    const keyboardScroll = useKeyboardScroll();
    const innerRef = useRef<TextInputInstance | null>(null);
    const setRefs = (node: TextInputInstance | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<TextInputInstance | null>).current = node;
    };

    const borderColor = error ? theme.danger : isFocused ? theme.primary : theme.borderColor;

    return (
      <View style={[styles.wrapper, containerStyle]}>
        {label ? <Text style={[styles.label, { color: theme.text }]}>{label}</Text> : null}

        {/* Tapping anywhere in the box (icon, padding, prefix) focuses the input and opens the keyboard. */}
        <Pressable
          onPress={() => editable && innerRef.current?.focus()}
          accessible={false}
          style={[
            styles.control,
            multiline && styles.controlMultiline,
            {
              borderColor,
              backgroundColor: editable ? theme.inputBackground : theme.surfaceMuted,
            },
            isFocused && !error ? { shadowColor: theme.primary, ...focusRing } : null,
          ]}
        >
          {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}
          {prefix ? (
            <View style={[styles.prefix, { borderRightColor: theme.borderColor }]}>
              <Text style={[Typography.bodyStrong, { color: theme.text }]}>{prefix}</Text>
            </View>
          ) : null}

          <TextInput
            ref={setRefs}
            editable={editable}
            multiline={multiline}
            placeholderTextColor={theme.textTertiary}
            secureTextEntry={isPassword ? !isSecureVisible : inputProps.secureTextEntry}
            accessibilityLabel={inputProps.accessibilityLabel || label}
            onFocus={(event) => {
              setIsFocused(true);
              keyboardScroll?.scrollToFocusedInput();
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setIsFocused(false);
              onBlur?.(event);
            }}
            {...inputProps}
            style={[
              styles.input,
              multiline && styles.inputMultiline,
              { color: theme.text },
              Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
              inputProps.style,
            ]}
          />

          {isPassword ? (
            <Pressable
              onPress={() => setIsSecureVisible((value) => !value)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={isSecureVisible ? 'Hide password' : 'Show password'}
              style={styles.rightSlot}
            >
              {isSecureVisible ? <EyeOff size={20} color={theme.textSecondary} /> : <Eye size={20} color={theme.textSecondary} />}
            </Pressable>
          ) : rightSlot ? (
            <View style={styles.rightSlot}>{rightSlot}</View>
          ) : null}
        </Pressable>

        {error ? (
          <Text style={[styles.helper, { color: theme.danger }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : hint ? (
          <Text style={[styles.helper, { color: theme.textSecondary }]}>{hint}</Text>
        ) : null}
      </View>
    );
  }
);

FormField.displayName = 'FormField';

const focusRing = Platform.select<ViewStyle>({
  ios: { shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  default: {},
});

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
  },
  label: {
    ...Typography.label,
  },
  // Fixed height for single-line fields. Percent heights / minHeight on the row resolved differently on
  // Android (field stretched to ~100px), so nothing inside the row uses a percentage.
  control: {
    height: Layout.controlHeight,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md + 2,
  },
  controlMultiline: {
    height: undefined,
    minHeight: 96,
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
  },
  leftIcon: {
    marginRight: Spacing.sm + 2,
  },
  prefix: {
    paddingRight: Spacing.md,
    marginRight: Spacing.md,
    borderRightWidth: 1,
    height: 24,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    height: Layout.controlHeight - 2,
    fontSize: 15,
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  inputMultiline: {
    height: undefined,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  rightSlot: {
    marginLeft: Spacing.sm,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  helper: {
    ...Typography.caption,
  },
});

export default FormField;
