import React, { useMemo } from 'react';
import {
  StyleProp,
  StyleSheet,
  TextInput as RNTextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../constants/Colors';

type AppInputProps = TextInputProps & {
  theme: Theme;
  isDark?: boolean;
  error?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  borderColor?: string;
  gradientColors?: [string, string];
};

const AppInput = React.forwardRef<RNTextInput, AppInputProps>(
  (
    {
      theme,
      isDark = false,
      error = false,
      containerStyle,
      contentStyle,
      inputStyle,
      leftSlot,
      rightSlot,
      borderColor,
      gradientColors,
      placeholderTextColor,
      multiline,
      style: nativeInputStyle,
      ...textInputProps
    },
    ref
  ) => {
    const colors = useMemo<[string, string]>(() => {
      if (gradientColors) {
        return gradientColors;
      }

      return isDark ? ['#252A31', '#171B20'] : ['#FFFFFF', '#EEF3F8'];
    }, [gradientColors, isDark]);

    const resolvedBorderColor = borderColor || (error ? theme.badgeText : isDark ? '#343B45' : theme.borderColor);
    const resolvedPlaceholderColor = placeholderTextColor || (isDark ? '#9AA3AF' : theme.textSecondary);

    return (
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.shell, { borderColor: resolvedBorderColor }, containerStyle]}
      >
        <View style={[styles.content, multiline && styles.multilineContent, contentStyle]}>
          {leftSlot ? <View style={styles.leftSlot}>{leftSlot}</View> : null}
          <RNTextInput
            ref={ref}
            multiline={multiline}
            placeholderTextColor={resolvedPlaceholderColor}
            style={[
              styles.input,
              { color: theme.text },
              multiline ? styles.multilineInput : null,
              leftSlot ? styles.inputWithLeft : null,
              rightSlot ? styles.inputWithRight : null,
              nativeInputStyle,
              inputStyle,
            ]}
            {...textInputProps}
          />
          {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
        </View>
      </LinearGradient>
    );
  }
);

AppInput.displayName = 'AppInput';

const styles = StyleSheet.create({
  shell: {
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 50,
    overflow: 'hidden',
  },
  content: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  multilineContent: {
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 46,
    paddingVertical: 0,
  },
  multilineInput: {
    minHeight: 88,
    paddingTop: 0,
    textAlignVertical: 'top',
  },
  inputWithLeft: {
    marginLeft: 8,
  },
  inputWithRight: {
    marginRight: 8,
  },
  leftSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AppInput;
