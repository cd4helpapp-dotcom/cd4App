import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, useColorScheme } from 'react-native';
import { Check, SunMoon } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { useUpdateSettings } from '../../hooks/useAuth';
import { ThemePreference, useThemePreference } from '../../context/ThemePreferenceContext';
import { useAppLanguage } from '../../context/AppLanguageContext';
import SettingsHeader from '../../ui/common/SettingsHeader';

type AppearanceOption = {
  mode: ThemePreference;
  title: string;
  description: string;
};

const toPrettyMode = (mode: ThemePreference, t: ReturnType<typeof useAppLanguage>['t']): string => {
  if (mode === 'system') return t('appearance.mode.system');
  if (mode === 'dark') return t('appearance.mode.dark');
  return t('appearance.mode.light');
};

export default function AppearanceSettings() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const updateSettingsMutation = useUpdateSettings();
  const { themePreference, resolvedColorScheme, setThemePreference } = useThemePreference();
  const { t } = useAppLanguage();
  const [selectedMode, setSelectedMode] = useState<ThemePreference>(themePreference);

  useEffect(() => {
    setSelectedMode(themePreference);
  }, [themePreference]);

  const currentDeviceMode = useMemo(
    () => (resolvedColorScheme === 'dark' ? t('appearance.mode.dark') : t('appearance.mode.light')),
    [resolvedColorScheme, t]
  );
  const activeModeLabel = useMemo(() => toPrettyMode(selectedMode, t), [selectedMode, t]);
  const appearanceOptions = useMemo<AppearanceOption[]>(
    () => [
      {
        mode: 'system',
        title: t('appearance.systemOption'),
        description: t('appearance.systemDescription'),
      },
      {
        mode: 'light',
        title: t('appearance.lightOption'),
        description: t('appearance.lightDescription'),
      },
      {
        mode: 'dark',
        title: t('appearance.darkOption'),
        description: t('appearance.darkDescription'),
      },
    ],
    [t]
  );

  const handleSelectMode = async (mode: ThemePreference) => {
    if (updateSettingsMutation.isPending || mode === selectedMode) {
      return;
    }

    const previousMode = selectedMode;
    setSelectedMode(mode);
    setThemePreference(mode);

    try {
      await updateSettingsMutation.mutateAsync({
        appearance: { mode },
      });
      Toast.show({
        type: 'success',
        text1: t('appearance.updatedTitle'),
        text2:
          mode === 'system'
            ? t('appearance.updatedSystemBody', { deviceMode: currentDeviceMode })
            : t('appearance.updatedModeBody', { mode: toPrettyMode(mode, t) }),
      });
    } catch {
      setSelectedMode(previousMode);
      setThemePreference(previousMode);
      Toast.show({
        type: 'error',
        text1: t('appearance.updateFailedTitle'),
        text2: t('appearance.updateFailedBody'),
      });
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <SettingsHeader title={t('appearance.title')} onBack={() => router.back()} theme={theme} />

      <View style={[styles.heroCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <View style={[styles.heroIconWrap, { backgroundColor: theme.tint + '14' }]}>
          <SunMoon size={18} color={theme.tint} />
        </View>
        <View style={styles.heroTextWrap}>
          <Text style={[styles.heroTitle, { color: theme.text }]}>{t('appearance.themeControl')}</Text>
          <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
            {selectedMode === 'system'
              ? t('appearance.activeSystem', { deviceMode: currentDeviceMode })
              : t('appearance.active', { mode: activeModeLabel })}
          </Text>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
        {appearanceOptions.map((option, index) => {
          const selected = selectedMode === option.mode;
          return (
            <View key={option.mode}>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.8}
                onPress={() => {
                  void handleSelectMode(option.mode);
                }}
                disabled={updateSettingsMutation.isPending}
              >
                <View style={styles.optionTextWrap}>
                  <Text style={[styles.label, { color: theme.text }]}>{option.title}</Text>
                  <Text style={[styles.optionDescription, { color: theme.textSecondary }]}>{option.description}</Text>
                </View>
                {selected ? <Check size={20} color={theme.tint} /> : null}
              </TouchableOpacity>
              {index < appearanceOptions.length - 1 ? (
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backButton: {
    marginRight: 15,
    padding: 5,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  heroCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  heroTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  heroSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
  },
  section: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  optionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  optionDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
});
