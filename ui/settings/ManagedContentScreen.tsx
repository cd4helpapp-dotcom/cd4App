import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import SettingsHeader from '../common/SettingsHeader';
import { ManagedContentKey, useManagedAppContent } from '../../hooks/useManagedAppContent';

type ManagedContentScreenProps = {
  contentKey: ManagedContentKey;
  fallbackTitle: string;
};

export default function ManagedContentScreen({ contentKey, fallbackTitle }: ManagedContentScreenProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { data, isLoading } = useManagedAppContent(contentKey);

  const title = data?.title || fallbackTitle;

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <SettingsHeader title={title} onBack={() => router.back()} theme={theme} />

      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        {isLoading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={theme.tint} />
          </View>
        ) : (
          <>
            <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>{data?.body || ''}</Text>
            {data?.updatedAt ? (
              <Text style={[styles.updatedAt, { color: theme.textSecondary }]}>
                Last updated: {new Date(data.updatedAt).toLocaleDateString()}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
  },
  loaderWrap: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  body: { fontSize: 14, lineHeight: 22 },
  updatedAt: { marginTop: 16, fontSize: 12, fontWeight: '500' },
});

