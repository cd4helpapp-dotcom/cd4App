import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';

type IconComponent = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

// Inset grouped list (iOS Settings style) used by patient, doctor and admin settings screens.

export function SettingsGroup({ title, children, footer }: { title?: string; children: React.ReactNode; footer?: string }) {
  const { theme } = useAppTheme();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {title ? <Text style={[Typography.overline, styles.groupTitle, { color: theme.textSecondary }]}>{title.toUpperCase()}</Text> : null}
      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        {rows.map((row, index) => (
          <View key={index}>
            {row}
            {index < rows.length - 1 ? <View style={[styles.separator, { backgroundColor: theme.divider }]} /> : null}
          </View>
        ))}
      </View>
      {footer ? <Text style={[Typography.caption, styles.groupFooter, { color: theme.textSecondary }]}>{footer}</Text> : null}
    </View>
  );
}

type SettingsRowProps = {
  icon: IconComponent;
  label: string;
  value?: string;
  badge?: number;
  onPress: () => void;
  destructive?: boolean;
  // Tints the icon tile; defaults to the brand primary.
  tone?: 'primary' | 'accent' | 'warning' | 'danger' | 'success';
};

export function SettingsRow({ icon: Icon, label, value, badge, onPress, destructive, tone = 'primary' }: SettingsRowProps) {
  const { theme } = useAppTheme();
  const toneMap = {
    primary: { fg: theme.primary, bg: theme.primarySoft },
    accent: { fg: theme.accent, bg: theme.accentSoft },
    warning: { fg: theme.warning, bg: theme.warningSoft },
    danger: { fg: theme.danger, bg: theme.dangerSoft },
    success: { fg: theme.success, bg: theme.successLight },
  };
  const colors = destructive ? toneMap.danger : toneMap[tone];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceMuted }]}
    >
      <View style={[styles.iconTile, { backgroundColor: colors.bg }]}>
        <Icon size={18} strokeWidth={2} color={colors.fg} />
      </View>
      <Text style={[Typography.body, styles.label, { color: destructive ? theme.danger : theme.text }]} numberOfLines={1}>
        {label}
      </Text>
      {badge && badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.danger }]}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      {value ? (
        <Text style={[Typography.body, styles.value, { color: theme.textSecondary }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {!destructive ? <ChevronRight size={18} color={theme.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    marginBottom: Spacing.xl,
  },
  groupTitle: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  groupFooter: {
    marginTop: Spacing.sm,
    marginHorizontal: Spacing.xs,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.md,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontWeight: '500',
  },
  value: {
    maxWidth: '40%',
  },
  separator: {
    height: StyleSheet.hairlineWidth * 2,
    marginLeft: Spacing.lg + 32 + Spacing.md,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
