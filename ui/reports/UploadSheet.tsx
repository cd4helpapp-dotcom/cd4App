import React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, FileText, FlaskConical, ImagePlus, Lock, Pill, Sparkles, UploadCloud, X } from 'lucide-react-native';
import { elevation, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { REPORT_MAX_UPLOAD_MB, REPORT_UPLOAD_WINDOW_HOURS, type ReportUploadCategory } from '../../hooks/useMedicalReports';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

export type PickedReportFile = { uri: string; name: string; mimeType: string; size?: number };

type Quota = { remaining: number; limit: number; isPro: boolean; resetsAt: string | null } | undefined;

type Props = {
  visible: boolean;
  initialCategory: ReportUploadCategory;
  isUploading: boolean;
  quota: Quota;
  onClose: () => void;
  onPicked: (file: PickedReportFile, category: ReportUploadCategory) => void;
};

const guessMimeType = (name: string, fallback?: string | null): string => {
  if (fallback) return fallback;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
};

export default function UploadSheet({ visible, initialCategory, isUploading, quota, onClose, onPicked }: Props) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const STEPS_REPORT = [
    { n: '1', title: t('upload.step1ReportTitle'), body: t('upload.step1ReportBody') },
    { n: '2', title: t('upload.step2Title'), body: t('upload.step2Body') },
    { n: '3', title: t('upload.step3ReportTitle'), body: t('upload.step3ReportBody') },
  ];
  const STEPS_PRESCRIPTION = [
    { n: '1', title: t('upload.step1RxTitle'), body: t('upload.step1RxBody') },
    { n: '2', title: t('upload.step2Title'), body: t('upload.step2Body') },
    { n: '3', title: t('upload.step3RxTitle'), body: t('upload.step3RxBody') },
  ];
  const TIPS = [t('upload.tipLight'), t('upload.tipPages'), t('upload.tipSize', { size: REPORT_MAX_UPLOAD_MB })];
  const insets = useSafeAreaInsets();
  const [category, setCategory] = React.useState<ReportUploadCategory>(initialCategory);
  const [isPicking, setIsPicking] = React.useState(false);

  React.useEffect(() => {
    if (visible) setCategory(initialCategory);
  }, [visible, initialCategory]);

  const isBlocked = Boolean(quota && !quota.isPro && quota.remaining <= 0);
  const busy = isUploading || isPicking;

  const finish = (file: PickedReportFile) => onPicked(file, category);

  const fromCamera = async () => {
    setIsPicking(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Toast.show({ type: 'info', text1: t('upload.cameraPermission'), text2: t('upload.cameraPermissionBody') });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const name = asset.fileName || `report_${Date.now()}.jpg`;
      finish({ uri: asset.uri, name, mimeType: guessMimeType(name, asset.mimeType), size: asset.fileSize });
    } catch (error) {
      console.warn('Could not open camera for report upload:', error);
      Toast.show({ type: 'error', text1: 'Upload unavailable', text2: 'Could not open the camera. Please try again.' });
    } finally {
      setIsPicking(false);
    }
  };

  const fromGallery = async () => {
    setIsPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Toast.show({ type: 'info', text1: 'Photo permission needed', text2: 'Allow photo library access in Settings to choose a report.' });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: false });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const name = asset.fileName || `report_${Date.now()}.jpg`;
      finish({ uri: asset.uri, name, mimeType: guessMimeType(name, asset.mimeType), size: asset.fileSize });
    } catch (error) {
      console.warn('Could not open gallery for report upload:', error);
      Toast.show({ type: 'error', text1: 'Upload unavailable', text2: 'Could not open the photo library. Please try again.' });
    } finally {
      setIsPicking(false);
    }
  };

  const fromFiles = async () => {
    setIsPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      finish({ uri: asset.uri, name: asset.name, mimeType: guessMimeType(asset.name, asset.mimeType), size: asset.size });
    } catch (error) {
      console.warn('Could not open file picker for report upload:', error);
      Toast.show({ type: 'error', text1: 'Upload unavailable', text2: 'Could not open the file picker. Please try again.' });
    } finally {
      setIsPicking(false);
    }
  };

  const sources = [
    ...(Platform.OS === 'web' ? [] : [{ key: 'camera', Icon: Camera, title: t('upload.takePhoto'), hint: t('upload.useCamera'), onPress: fromCamera }]),
    ...(Platform.OS === 'web' ? [] : [{ key: 'gallery', Icon: ImagePlus, title: t('upload.fromGallery'), hint: t('upload.pickSaved'), onPress: fromGallery }]),
    { key: 'files', Icon: FileText, title: t('upload.pdfOrFile'), hint: t('upload.chooseFromPhone'), onPress: fromFiles },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: theme.cardBackground, paddingBottom: Math.max(insets.bottom + Spacing.md, Spacing.xl) }]}>
          <View style={[styles.grabber, { backgroundColor: theme.borderColor }]} />
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text style={[Typography.title, { color: theme.text }]}>{t('upload.title')}</Text>
              <Text style={[Typography.body, { color: theme.textSecondary }]}>{t('upload.subtitle')}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={[styles.close, { backgroundColor: theme.surfaceMuted }]}>
              <X size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <Text style={[Typography.overline, { color: theme.textSecondary }]}>{t('upload.whatAdding')}</Text>
            <View style={[styles.segment, { backgroundColor: theme.surfaceMuted }]} accessibilityRole="radiogroup">
              {([
                { key: 'report' as const, label: t('upload.testReport'), Icon: FlaskConical },
                { key: 'prescription' as const, label: t('upload.prescription'), Icon: Pill },
              ]).map(({ key, label, Icon }) => {
                const active = category === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setCategory(key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[styles.segmentItem, active && [{ backgroundColor: theme.cardBackground }, elevation(1)]]}
                  >
                    <Icon size={16} color={active ? theme.primary : theme.textSecondary} />
                    <Text style={[Typography.label, { color: active ? theme.text : theme.textSecondary }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[Typography.caption, { color: theme.textSecondary }]}>
              {category === 'prescription'
                ? t('upload.rxHint')
                : t('upload.reportHint')}
            </Text>

            <View style={styles.steps}>
              {(category === 'prescription' ? STEPS_PRESCRIPTION : STEPS_REPORT).map((step) => (
                <View key={step.n} style={styles.step}>
                  <View style={[styles.stepDot, { backgroundColor: theme.primarySoft }]}>
                    <Text style={[Typography.label, { color: theme.primary }]}>{step.n}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={[Typography.bodyStrong, { color: theme.text }]}>{step.title}</Text>
                    <Text style={[Typography.caption, { color: theme.textSecondary }]}>{step.body}</Text>
                  </View>
                </View>
              ))}
            </View>

            {isBlocked ? (
              <View style={[styles.notice, { backgroundColor: theme.warningSoft, borderColor: theme.warningBorder }]}>
                <Text style={[Typography.bodyStrong, { color: theme.warning }]}>{t('upload.limitTitle')}</Text>
                <Text style={[Typography.caption, { color: theme.textSecondary }]}>
                  {t('upload.limitBody', { limit: quota?.limit, hours: REPORT_UPLOAD_WINDOW_HOURS })}
                </Text>
              </View>
            ) : (
              <View style={styles.sources}>
                {sources.map(({ key, Icon, title, hint, onPress }) => (
                  <Pressable
                    key={key}
                    onPress={onPress}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                    style={({ pressed }) => [
                      styles.source,
                      { backgroundColor: pressed ? theme.primarySoft : theme.cardBackground, borderColor: theme.borderColor, opacity: busy ? 0.6 : 1 },
                    ]}
                  >
                    <View style={[styles.sourceIcon, { backgroundColor: theme.primarySoft }]}>
                      <Icon size={22} color={theme.primary} />
                    </View>
                    <Text style={[Typography.bodyStrong, { color: theme.text }]}>{title}</Text>
                    <Text style={[Typography.caption, { color: theme.textSecondary }]}>{hint}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {busy ? (
              <View style={styles.busy}>
                <ActivityIndicator color={theme.primary} />
                <Text style={[Typography.body, { color: theme.textSecondary }]}>{isUploading ? t('upload.uploading') : t('upload.opening')}</Text>
              </View>
            ) : null}

            {quota && !quota.isPro ? (
              <Text style={[Typography.caption, styles.center, { color: theme.textSecondary }]}>
                {t('upload.quota', { remaining: quota.remaining, limit: quota.limit, hours: REPORT_UPLOAD_WINDOW_HOURS })}
              </Text>
            ) : null}

            <View style={[styles.tips, { backgroundColor: theme.surfaceMuted }]}>
              <View style={styles.tipsTitle}>
                <Sparkles size={14} color={theme.primary} />
                <Text style={[Typography.label, { color: theme.text }]}>{t('upload.bestResult')}</Text>
              </View>
              {TIPS.map((tip) => (
                <Text key={tip} style={[Typography.caption, { color: theme.textSecondary }]}>
                  •  {tip}
                </Text>
              ))}
            </View>

            <View style={styles.footerNotes}>
              <View style={styles.noteRow}>
                <Lock size={13} color={theme.textTertiary} />
                <Text style={[Typography.caption, styles.flex, { color: theme.textTertiary }]}>{t('upload.privateNote')}</Text>
              </View>
              <View style={styles.noteRow}>
                <UploadCloud size={13} color={theme.textTertiary} />
                <Text style={[Typography.caption, styles.flex, { color: theme.textTertiary }]}>{t('reports.insightsDisclaimer')}</Text>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, maxHeight: '92%', width: '100%', maxWidth: 560, alignSelf: 'center' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginBottom: Spacing.lg },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  body: { gap: Spacing.md, paddingBottom: Spacing.md },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: 4 },
  segmentItem: { flex: 1, height: 40, borderRadius: Radius.sm + 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  steps: { gap: Spacing.md, marginTop: Spacing.sm },
  step: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  stepDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sources: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  source: { flex: 1, borderWidth: 1, borderRadius: Radius.lg, paddingVertical: Spacing.lg, paddingHorizontal: Spacing.sm, alignItems: 'center', gap: 4 },
  sourceIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  notice: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  busy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  tips: { borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  tipsTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  footerNotes: { gap: Spacing.sm },
  noteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
