import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Colors from '../../constants/Colors';
import { useAdminCommunityAds, useCreateCommunityAd, useToggleCommunityAdActive } from '../../hooks/useAdmin';

const clampInterval = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(2, Math.min(20, Math.floor(parsed)));
};

export default function AdminAdsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  const adsQuery = useAdminCommunityAds();
  const createAdMutation = useCreateCommunityAd();
  const toggleAdMutation = useToggleCommunityAdActive();

  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [ctaLabel, setCtaLabel] = React.useState('');
  const [ctaUrl, setCtaUrl] = React.useState('');
  const [intervalText, setIntervalText] = React.useState('4');
  const [active, setActive] = React.useState(true);
  const [selectedImage, setSelectedImage] = React.useState<ImagePicker.ImagePickerAsset | null>(null);

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Please allow gallery access to upload ad image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    setSelectedImage(result.assets[0]);
  };

  const resetForm = () => {
    setTitle('');
    setBody('');
    setCtaLabel('');
    setCtaUrl('');
    setIntervalText('4');
    setActive(true);
    setSelectedImage(null);
  };

  const handleCreateAd = async () => {
    if (!title.trim()) {
      Alert.alert('Title Required', 'Please enter ad title.');
      return;
    }

    try {
      await createAdMutation.mutateAsync({
        title: title.trim(),
        body: body.trim(),
        ctaLabel: ctaLabel.trim(),
        ctaUrl: ctaUrl.trim(),
        frequencyInterval: clampInterval(intervalText),
        active,
        imageAsset: selectedImage
          ? {
              uri: selectedImage.uri,
              fileName: selectedImage.fileName,
              mimeType: selectedImage.mimeType,
              fileSize: selectedImage.fileSize,
            }
          : null,
      });

      Alert.alert('Ad Created', 'Ad has been saved successfully.');
      resetForm();
    } catch (error: any) {
      Alert.alert('Ad Create Failed', error?.message || 'Could not create ad.');
    }
  };

  const handleToggleAd = async (adId: string, nextActive: boolean) => {
    try {
      await toggleAdMutation.mutateAsync({ adId, active: nextActive });
    } catch (error: any) {
      Alert.alert('Update Failed', error?.message || 'Could not update ad status.');
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.text }]}>Community Ads</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Create sponsored posts and control live campaign visibility.
      </Text>

      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Create New Ad</Text>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Ad title"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Ad description"
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
        />
        <TextInput
          value={ctaLabel}
          onChangeText={setCtaLabel}
          placeholder="CTA label (optional)"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
        />
        <TextInput
          value={ctaUrl}
          onChangeText={setCtaUrl}
          placeholder="CTA URL (optional)"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          keyboardType="url"
          style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
        />

        <View style={styles.row}>
          <TextInput
            value={intervalText}
            onChangeText={setIntervalText}
            placeholder="Interval"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            style={[styles.input, styles.intervalInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
          />
          <View style={styles.toggleWrap}>
            <Text style={[styles.toggleLabel, { color: theme.textSecondary }]}>Active</Text>
            <Switch value={active} onValueChange={setActive} />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.imageButton, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
          onPress={handlePickImage}
        >
          <Text style={[styles.imageButtonText, { color: theme.text }]}>
            {selectedImage?.uri ? 'Change Ad Image' : 'Upload Ad Image'}
          </Text>
        </TouchableOpacity>

        {selectedImage?.uri ? (
          <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
        ) : null}

        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: theme.tint, opacity: createAdMutation.isPending ? 0.7 : 1 }]}
          disabled={createAdMutation.isPending}
          onPress={handleCreateAd}
        >
          {createAdMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createButtonText}>Create Ad</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Existing Ads</Text>
        {adsQuery.isLoading ? (
          <ActivityIndicator color={theme.tint} style={{ marginVertical: 18 }} />
        ) : (adsQuery.data || []).length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No ads yet.</Text>
        ) : (
          (adsQuery.data || []).map((ad) => (
            <View key={ad.id} style={[styles.adRow, { borderBottomColor: theme.borderColor }]}>
              <View style={styles.adContent}>
                <Text style={[styles.adTitle, { color: theme.text }]} numberOfLines={1}>
                  {ad.title}
                </Text>
                {!!ad.body && (
                  <Text style={[styles.adBody, { color: theme.textSecondary }]} numberOfLines={2}>
                    {ad.body}
                  </Text>
                )}
                <Text style={[styles.adMeta, { color: theme.textSecondary }]}>
                  Every {ad.frequencyInterval} posts • {ad.active ? 'Active' : 'Paused'}
                </Text>
              </View>
              <Switch
                value={ad.active}
                onValueChange={(next) => handleToggleAd(ad.id, next)}
                disabled={toggleAdMutation.isPending}
              />
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  title: { fontSize: 26, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 6, marginBottom: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  multiline: { minHeight: 84, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  intervalInput: { flex: 0.45 },
  toggleWrap: { flex: 0.55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontSize: 13, fontWeight: '600' },
  imageButton: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  imageButtonText: { fontSize: 13, fontWeight: '600' },
  previewImage: { width: '100%', height: 160, borderRadius: 10, marginBottom: 10 },
  createButton: {
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  adRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  adContent: { flex: 1 },
  adTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  adBody: { fontSize: 12, lineHeight: 16, marginBottom: 4 },
  adMeta: { fontSize: 11 },
});
