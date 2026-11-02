import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';

// Shared pieces for the doctor tabs, so every tab has the same title, stat tile and search box.

export function ScreenTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.titleRow}>
      <View style={styles.flex}>
        <Text style={[Typography.title, { color: theme.text }]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={[Typography.body, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function StatTile({ icon: Icon, label, value, hint, onPress }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; value: string; hint?: string; onPress?: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? theme.surfaceMuted : theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}
    >
      <View style={[styles.tileIcon, { backgroundColor: theme.primarySoft }]}>
        <Icon size={18} color={theme.primary} />
      </View>
      <Text style={[Typography.title, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[Typography.label, { color: theme.text }]} numberOfLines={1}>{label}</Text>
      {hint ? <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>{hint}</Text> : null}
    </Pressable>
  );
}

export function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (text: string) => void; placeholder: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
      <Search size={18} color={theme.textSecondary} />
      <TextInput
        style={[styles.searchInput, { color: theme.text }]}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <X size={16} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function PersonInitial({ name, size = 44 }: { name: string; size?: number }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.initial, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.primarySoft }]}>
      <Text style={{ color: theme.primary, fontSize: size * 0.42, fontWeight: '700' }}>{(name || 'P').trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

// Older summaries start with "Chief concern: X. Onset/Duration: Not clearly stated. ...".
export const readableSummary = (summary?: string | null): string =>
  String(summary || '')
    .replace(/^Chief concern:\s*/i, '')
    .replace(/\s*[A-Z][A-Za-z/ ]{2,30}:\s*Not (?:clearly )?(?:stated|available|provided|shared)[^.]*\.?/g, '')
    .trim();

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  tile: { flexGrow: 1, flexBasis: '46%', borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  tileIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: Layout.controlHeightCompact, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  initial: { alignItems: 'center', justifyContent: 'center' },
});
