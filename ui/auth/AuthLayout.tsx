import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ArrowLeft, CalendarCheck, FileText, ShieldCheck, Stethoscope } from 'lucide-react-native';
import { Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import KeyboardAwareScrollView from '../common/KeyboardAwareScrollView';

type AuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  // Shows a back button instead of the brand mark (used by secondary screens).
  showBack?: boolean;
  onBack?: () => void;
  // Icon shown in place of the logo on secondary screens (e.g. mail, lock).
  icon?: React.ReactNode;
};

const WIDE_BREAKPOINT = 960;

const HIGHLIGHTS = [
  { Icon: Stethoscope, text: 'Consult verified doctors by video, voice or chat' },
  { Icon: CalendarCheck, text: 'Book appointments with instant confirmation' },
  { Icon: FileText, text: 'Understand your lab reports and prescriptions' },
  { Icon: ShieldCheck, text: 'Your health data stays private and encrypted' },
];

export default function AuthLayout({ title, subtitle, children, footer, showBack, onBack, icon }: AuthLayoutProps) {
  const { theme, isDark } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const handleBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/auth/login');
  };

  const formColumn = (
    <KeyboardAwareScrollView
      contentContainerStyle={[styles.scrollContent, isWide && styles.scrollContentWide]}
    >
      <View style={styles.formColumn}>
        {showBack ? (
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={({ pressed }) => [
              styles.backButton,
              { borderColor: theme.borderColor, backgroundColor: pressed ? theme.surfaceMuted : theme.cardBackground },
            ]}
          >
            <ArrowLeft size={20} color={theme.text} />
          </Pressable>
        ) : null}

        <View style={[styles.header, !isWide && styles.headerCentered]}>
          {icon ? (
            <View style={[styles.iconBadge, { backgroundColor: theme.primarySoft }]}>{icon}</View>
          ) : !isWide ? (
            <Image
              source={require('../../assets/images/cd4_logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="CD4 logo"
            />
          ) : null}
          <Text style={[Typography.display, !isWide && styles.textCentered, { color: theme.text }]} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text style={[Typography.body, !isWide && styles.textCentered, { color: theme.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>

        <View style={styles.body}>{children}</View>

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </KeyboardAwareScrollView>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        {isWide ? (
          <View style={[styles.flex, styles.row]}>
            <LinearGradient
              colors={isDark ? ['#0B3B3A', '#061F22'] : ['#059669', '#065F46']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.brandPanel}
            >
              <View style={styles.brandInner}>
                <View style={styles.brandRow}>
                  <Image source={require('../../assets/images/cd4_logo.png')} style={styles.brandLogo} resizeMode="contain" />
                  <Text style={styles.brandName}>CD4 Health</Text>
                </View>
                <Text style={styles.brandHeadline}>Care that comes to you.</Text>
                <Text style={styles.brandCopy}>
                  AI-assisted triage, verified doctors and your medical records — in one secure place.
                </Text>
                <View style={styles.highlights}>
                  {HIGHLIGHTS.map(({ Icon, text }) => (
                    <View key={text} style={styles.highlightRow}>
                      <View style={styles.highlightIcon}>
                        <Icon size={18} color="#FFFFFF" />
                      </View>
                      <Text style={styles.highlightText}>{text}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.brandFootnote}>
                For medical emergencies call 112 or visit the nearest hospital.
              </Text>
            </LinearGradient>
            <View style={styles.flex}>{formColumn}</View>
          </View>
        ) : (
          formColumn
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Layout.screenGutter,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  scrollContentWide: {
    justifyContent: 'center',
    paddingVertical: Spacing.huge,
  },
  formColumn: {
    width: '100%',
    maxWidth: Layout.formMaxWidth,
    alignSelf: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  header: {
    gap: Spacing.sm,
    marginBottom: Spacing.xxl,
  },
  headerCentered: {
    alignItems: 'center',
  },
  textCentered: {
    textAlign: 'center',
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: Spacing.md,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  body: {
    gap: Spacing.lg,
  },
  footer: {
    marginTop: Spacing.xxl,
    gap: Spacing.md,
  },
  brandPanel: {
    width: '44%',
    maxWidth: 620,
    paddingHorizontal: 56,
    paddingVertical: 48,
    justifyContent: 'space-between',
  },
  brandInner: {
    flex: 1,
    justifyContent: 'center',
    maxWidth: 460,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 40,
  },
  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  brandHeadline: {
    color: '#FFFFFF',
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  brandCopy: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 17,
    lineHeight: 26,
    marginTop: 14,
  },
  highlights: {
    marginTop: 36,
    gap: 16,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  highlightIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    lineHeight: 21,
    flex: 1,
  },
  brandFootnote: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
});
