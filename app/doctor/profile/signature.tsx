import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, PenLine, Trash2, Upload } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { elevation, Layout, Radius, Spacing, Typography } from '../../../constants/Design';
import { useAuthContext } from '../../../context/AuthContext';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { confirmAction } from '../../../src/utils/confirm';
import {
  loadDoctorSignaturePath,
  pickSignatureImage,
  removeDoctorSignature,
  signatureViewUrl,
  uploadDoctorSignature,
} from '../../../src/services/doctorSignature';
import DoctorSafeScreen from '../../../ui/doctor/DoctorSafeScreen';

export default function DoctorSignatureScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { user } = useAuthContext();
  const [path, setPath] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!user?.id) return;
    const current = await loadDoctorSignaturePath(user.id);
    setPath(current);
    setPreviewUrl(current ? await signatureViewUrl(current) : null);
    setIsLoading(false);
  }, [user?.id]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpload = async () => {
    if (!user?.id || isSaving) return;
    try {
      const picked = await pickSignatureImage();
      if (!picked) return;
      setIsSaving(true);
      await uploadDoctorSignature(user.id, picked);
      await refresh();
      Toast.show({ type: 'success', text1: 'Signature saved', text2: 'It will appear on your new prescriptions.' });
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Could not save signature', text2: error?.message || 'Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!user?.id || !path) return;
    const ok = await confirmAction({
      title: 'Remove your signature?',
      message: 'New prescriptions will carry your name and registration number without it.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setIsSaving(true);
    try {
      await removeDoctorSignature(user.id, path);
      await refresh();
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Could not remove signature', text2: error?.message || 'Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DoctorSafeScreen backgroundColor={theme.background} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8} style={[styles.back, { backgroundColor: theme.surfaceMuted }]}>
            <ArrowLeft size={20} color={theme.text} />
          </Pressable>
          <Text style={[Typography.title, { color: theme.text }]}>Signature & Stamp</Text>
        </View>
        <Text style={[Typography.body, { color: theme.textSecondary }]}>
          This appears above your name and registration number on the prescriptions you send to patients.
        </Text>

        {/* White on purpose, in dark mode too: this is how the signature looks on the white PDF. */}
        <View style={[styles.preview, { borderColor: theme.borderColor }, elevation(1)]}>
          {isLoading || isSaving ? (
            <ActivityIndicator color={theme.primary} />
          ) : previewUrl ? (
            <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" accessibilityLabel="Your signature" />
          ) : (
            <View style={styles.emptyPreview}>
              <PenLine size={28} color="#94A3B8" />
              <Text style={[Typography.body, styles.emptyText]}>No signature added yet</Text>
            </View>
          )}
        </View>

        <Pressable
          onPress={handleUpload}
          disabled={isSaving}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary, opacity: isSaving ? 0.6 : 1 }]}
        >
          <Upload size={17} color="#FFFFFF" />
          <Text style={styles.primaryText}>{path ? 'Replace signature' : 'Upload signature'}</Text>
        </Pressable>

        {path ? (
          <Pressable onPress={handleRemove} disabled={isSaving} accessibilityRole="button" style={({ pressed }) => [styles.secondary, { borderColor: theme.borderColor, backgroundColor: pressed ? theme.dangerSoft : theme.cardBackground }]}>
            <Trash2 size={16} color={theme.danger} />
            <Text style={[Typography.label, { color: theme.danger }]}>Remove</Text>
          </Pressable>
        ) : null}

        <View style={[styles.tips, { backgroundColor: theme.surfaceMuted }]}>
          <Text style={[Typography.label, { color: theme.text }]}>For a clean result</Text>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>•  Sign or stamp on plain white paper, in good light</Text>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>•  Crop close around the signature</Text>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>•  PNG or JPG. A PNG with a transparent background looks best</Text>
        </View>
      </ScrollView>
    </DoctorSafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Layout.screenGutter, paddingBottom: Spacing.xxxl, gap: Spacing.md, width: '100%', maxWidth: Layout.contentMaxWidth, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  preview: { height: 150, borderWidth: 1, borderRadius: Radius.lg, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
  previewImage: { width: '100%', height: '100%' },
  emptyPreview: { alignItems: 'center', gap: Spacing.sm },
  emptyText: { color: '#64748B' },
  primary: { height: 48, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  secondary: { height: 44, borderRadius: Radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tips: { borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
});
