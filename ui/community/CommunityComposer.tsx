import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { Camera, Tag, X } from 'lucide-react-native';
import { elevation, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useCreateCommunityPost, type CommunityCategory } from '../../hooks/useCommunity';
import CommunityAvatar from './CommunityAvatar';
import { communityCategoryLabel } from './communityFormat';

const CATEGORIES: CommunityCategory[] = ['general', 'success_stories', 'challenges', 'mentor_tips'];

type Props = {
  userId: string | null;
  userName: string;
  userAvatar?: string | null;
};

// Holds its own typing state. Kept in the feed screen, every letter re-rendered every post.
function CommunityComposer({ userId, userName, userAvatar }: Props) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const [text, setText] = React.useState('');
  const [category, setCategory] = React.useState<CommunityCategory>('general');
  const [assets, setAssets] = React.useState<ImagePicker.ImagePickerAsset[]>([]);
  const [focused, setFocused] = React.useState(false);
  const createPost = useCreateCommunityPost(userId);

  const isOpen = focused || text.length > 0 || assets.length > 0;
  const canPost = (text.trim().length > 0 || assets.length > 0) && !createPost.isPending;

  const pickAssets = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.length) return;
      setAssets((previous) => [...previous, ...result.assets].slice(0, 10));
    } catch (error: any) {
      Toast.show({ type: 'error', text1: t('community.actionFailed'), text2: error?.message || t('community.tryAgain') });
    }
  };

  const cycleCategory = () => setCategory((current) => CATEGORIES[(CATEGORIES.indexOf(current) + 1) % CATEGORIES.length]);

  const submit = async () => {
    if (!canPost) return;
    try {
      await createPost.mutateAsync({
        content: text,
        category,
        assets: assets.map((asset) => ({
          uri: asset.uri,
          fileName: asset.fileName || `media_${Date.now()}`,
          mimeType: asset.mimeType || 'image/jpeg',
          fileSize: asset.fileSize || 0,
        })),
      });
      setText('');
      setCategory('general');
      setAssets([]);
      setFocused(false);
    } catch (error: any) {
      Toast.show({ type: 'error', text1: t('community.actionFailed'), text2: error?.message || t('community.tryAgain') });
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
      <View style={styles.inputRow}>
        <CommunityAvatar name={userName} uri={userAvatar} size={38} />
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t('community.sharePlaceholder')}
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, { color: theme.text, backgroundColor: isOpen ? 'transparent' : theme.surfaceMuted }]}
          multiline
        />
      </View>

      {assets.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.assets}>
          {assets.map((asset, index) => (
            <View key={`${asset.uri}-${index}`} style={styles.asset}>
              <Image source={{ uri: asset.uri }} style={styles.assetImage} />
              {asset.mimeType?.startsWith('video/') ? (
                <View style={styles.videoBadge}>
                  <Text style={styles.videoBadgeText}>VIDEO</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => setAssets((previous) => previous.filter((_, position) => position !== index))}
                style={styles.assetRemove}
                accessibilityRole="button"
                accessibilityLabel={t('community.delete')}
              >
                <X size={12} color="#FFFFFF" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {isOpen ? (
        <View style={[styles.actions, { borderTopColor: theme.divider }]}>
          <TouchableOpacity style={[styles.chip, { backgroundColor: theme.surfaceMuted }]} onPress={pickAssets} accessibilityRole="button">
            <Camera size={15} color={theme.primary} />
            <Text style={[styles.chipText, { color: theme.textSecondary }]}>
              {assets.length > 0 ? t('community.mediaSelected', { count: assets.length }) : t('community.addMedia')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, { backgroundColor: theme.surfaceMuted }]} onPress={cycleCategory} accessibilityRole="button">
            <Tag size={15} color={theme.primary} />
            <Text style={[styles.chipText, { color: theme.textSecondary }]} numberOfLines={1}>
              {communityCategoryLabel(category, t)}
            </Text>
          </TouchableOpacity>
          <View style={styles.flex} />
          <TouchableOpacity
            style={[styles.post, { backgroundColor: canPost ? theme.buttonPrimary : theme.surfaceMuted }]}
            disabled={!canPost}
            onPress={submit}
            accessibilityRole="button"
          >
            {createPost.isPending ? (
              <ActivityIndicator color={theme.primary} size="small" />
            ) : (
              <Text style={[styles.postText, { color: canPost ? '#FFFFFF' : theme.textTertiary }]}>{t('community.post')}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {createPost.isPending ? (
        <Text style={[Typography.caption, styles.status, { color: theme.textSecondary }]}>
          {assets.length > 0 ? t('community.uploading') : t('community.publishing')}
        </Text>
      ) : null}
    </View>
  );
}

export default React.memo(CommunityComposer);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.md, marginBottom: Spacing.md },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  input: { flex: 1, minHeight: 38, maxHeight: 130, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 14 },
  assets: { paddingTop: Spacing.md, gap: Spacing.sm },
  asset: { width: 84, height: 84, borderRadius: Radius.sm, overflow: 'hidden' },
  assetImage: { width: '100%', height: '100%' },
  assetRemove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  videoBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  videoBadgeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  chip: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: Radius.pill, flexShrink: 1 },
  chipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  post: { height: 34, minWidth: 64, paddingHorizontal: 14, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  postText: { fontSize: 13, fontWeight: '700' },
  status: { marginTop: Spacing.sm },
});
