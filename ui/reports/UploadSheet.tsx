import React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, FileText, FlaskConical, ImagePlus, Lock, Pill, Sparkles, UploadCloud, X } from 'lucide-react-native';
import { elevation, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
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

const STEPS_REPORT = [
  { n: '1', title: 'Add your report', body: 'A PDF, or a clear photo of every page.' },
  { n: '2', title: 'AI reads it', body: 'Takes about a minute. You can leave this screen.' },
  { n: '3', title: 'Understand it', body: 'Get a simple explanation and ask questions.' },
];
const STEPS_PRESCRIPTION = [
  { n: '1', title: 'Add your prescription', body: 'A clear photo or PDF of the doctor’s prescription.' },
  { n: '2', title: 'AI reads it', body: 'Takes about a minute. You can leave this screen.' },
  { n: '3', title: 'Know your medicines', body: 'What each medicine is for, when to take it, and what to avoid.' },
];

const TIPS = [
  'Good light, no shadows or glare, whole page in the frame',
  'Several pages? Choose one PDF, or add each page separately',
  `File size up to ${REPORT_MAX_UPLOAD_MB} MB (PDF, JPG or PNG)`,
];

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
        Toast.show({ type: 'info', text1: 'Camera permission needed', text2: 'Allow camera access in Settings to photograph a report.' });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const name = asset.fileName || `report_${Date.now()}.jpg`;
      finish({ uri: asset.uri, name, mimeType: guessMimeType(name, asset.mimeType), size: asset.fileSize });
    } finally {
      setIsPicking(false);
    }
  };

  const fromGallery = async () => {
    setIsPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: false });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const name = asset.fileName || `report_${Date.now()}.jpg`;
      finish({ uri: asset.uri, name, mimeType: guessMimeType(name, asset.mimeType), size: asset.fileSize });
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
    } finally {
      setIsPicking(false);
    }
  };

  const sources = [
    ...(Platform.OS === 'web' ? [] : [{ key: 'camera', Icon: Camera, title: 'Take a photo', hint: 'Use your camera', onPress: fromCamera }]),
    ...(Platform.OS === 'web' ? [] : [{ key: 'gallery', Icon: ImagePlus, title: 'From gallery', hint: 'Pick a saved photo', onPress: fromGallery }]),
    { key: 'files', Icon: FileText, title: 'PDF or file', hint: 'Choose from your phone', onPress: fromFiles },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: theme.cardBackground, paddingBottom: Math.max(insets.bottom + Spacing.md, Spacing.xl) }]}>
          <View style={[styles.grabber, { backgroundColor: theme.borderColor }]} />
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text style={[Typography.title, { color: theme.text }]}>Add a report</Text>
              <Text style={[Typography.body, { color: theme.textSecondary }]}>We turn medical jargon into plain language.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={[styles.close, { backgroundColor: theme.surfaceMuted }]}>
              <X size={18} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <Text style={[Typography.overline, { color: theme.textSecondary }]}>WHAT ARE YOU ADDING?</Text>
            <View style={[styles.segment, { backgroundColor: theme.surfaceMuted }]} accessibilityRole="radiogroup">
              {([
                { key: 'report' as const, label: 'Test report', Icon: FlaskConical },
                { key: 'prescription' as const, label: 'Prescription', Icon: Pill },
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
                ? 'We list the medicines, doses and instructions so they are easy to follow.'
                : 'Blood tests, scans, discharge summaries and other lab results.'}
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
                <Text style={[Typography.bodyStrong, { color: theme.warning }]}>Daily free limit reached</Text>
                <Text style={[Typography.caption, { color: theme.textSecondary }]}>
                  Free plan: {quota?.limit} reports every {REPORT_UPLOAD_WINDOW_HOURS} hours. Try again later or upgrade to Pro for more.
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
                <Text style={[Typography.body, { color: theme.textSecondary }]}>{isUploading ? 'Uploading your report…' : 'Opening…'}</Text>
              </View>
            ) : null}

            {quota && !quota.isPro ? (
              <Text style={[Typography.caption, styles.center, { color: theme.textSecondary }]}>
                {quota.remaining} of {quota.limit} free uploads left in {REPORT_UPLOAD_WINDOW_HOURS} hours
              </Text>
            ) : null}

            <View style={[styles.tips, { backgroundColor: theme.surfaceMuted }]}>
              <View style={styles.tipsTitle}>
                <Sparkles size={14} color={theme.primary} />
                <Text style={[Typography.label, { color: theme.text }]}>For the best result</Text>
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
                <Text style={[Typography.caption, styles.flex, { color: theme.textTertiary }]}>Private: only you can see your reports. You can delete them anytime.</Text>
              </View>
              <View style={styles.noteRow}>
                <UploadCloud size={13} color={theme.textTertiary} />
                <Text style={[Typography.caption, styles.flex, { color: theme.textTertiary }]}>AI explains your report in simple words. It is not a diagnosis; talk to a doctor about any concern.</Text>
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
