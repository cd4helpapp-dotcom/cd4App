import React from 'react';
import { Animated, FlatList, Image, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Heart, MessageCircle, MoreHorizontal, Pin, Play, Share2, ShieldCheck } from 'lucide-react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Theme } from '../constants/Colors';
import { elevation, Radius, Spacing, Typography } from '../constants/Design';
import { useAppLanguage } from '../context/AppLanguageContext';
import CommunityAvatar from './community/CommunityAvatar';
import { communityCategoryLabel, formatCommunityTime } from './community/communityFormat';

const DEFAULT_IMAGE_RATIO = 1.25;
const LONG_POST_CHARS = 240;
const COLLAPSED_LINES = 5;

export type CommunityAuthorCard = {
  id: string;
  name: string;
  avatar?: string | null;
  role: 'doctor' | 'patient' | 'admin' | 'unknown';
  isVerified?: boolean;
};

export type CommunityMediaItem = {
  url: string;
  type: 'image' | 'video';
  thumbnail?: string;
};

export type CommunityPostCard = {
  id: string;
  content: string;
  imageUrl?: string | null;
  media?: CommunityMediaItem[];
  category: 'general' | 'success_stories' | 'challenges' | 'mentor_tips';
  createdAt: string;
  isPinned: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  likedByMe: boolean;
  followedByMe?: boolean;
  author: CommunityAuthorCard;
};

interface PostCardProps {
  theme: Theme;
  post: CommunityPostCard;
  onPressAuthor?: (post: CommunityPostCard) => void;
  onLongPress?: (post: CommunityPostCard) => void;
  onPressLike: (post: CommunityPostCard) => void;
  onPressComment: (post: CommunityPostCard) => void;
  onPressShare: (post: CommunityPostCard) => void;
  onPressLikeCount?: (post: CommunityPostCard) => void;
  onPressMenu?: (post: CommunityPostCard) => void;
  onPressFollow?: (post: CommunityPostCard) => void;
  commentDisabled?: boolean;
}

const normalizeImageAspectRatio = (ratio: number): number => {
  if (!Number.isFinite(ratio) || ratio <= 0) return DEFAULT_IMAGE_RATIO;
  return Math.max(0.8, Math.min(1.6, ratio));
};

// Created only when tapped: a video player per post in a long feed is the heaviest thing this screen could do.
function VideoPlayer({ url, isActive }: { url: string; isActive: boolean }) {
  const player = useVideoPlayer({ uri: url }, (instance) => {
    instance.loop = true;
    instance.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  React.useEffect(() => {
    if (!isActive) player.pause();
  }, [isActive, player]);

  return (
    <View style={styles.fill}>
      <VideoView player={player} style={styles.fill} contentFit="cover" nativeControls={false} />
      <Pressable style={styles.videoOverlay} onPress={() => (isPlaying ? player.pause() : player.play())}>
        {!isPlaying ? (
          <View style={styles.playButton}>
            <Play size={28} color="#fff" fill="#fff" />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function VideoTile({ url, isActive }: { url: string; isActive: boolean }) {
  const [started, setStarted] = React.useState(false);
  if (started) return <VideoPlayer url={url} isActive={isActive} />;
  return (
    <Pressable style={styles.videoPoster} onPress={() => setStarted(true)} accessibilityRole="button" accessibilityLabel="Play video">
      <View style={styles.playButton}>
        <Play size={28} color="#fff" fill="#fff" />
      </View>
    </Pressable>
  );
}

function PostMedia({ media, theme }: { media: CommunityMediaItem[]; theme: Theme }) {
  const [width, setWidth] = React.useState(0);
  const [ratio, setRatio] = React.useState(DEFAULT_IMAGE_RATIO);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next && next !== width) setWidth(next);
  };

  // The size comes with the picture itself, so nothing is downloaded twice just to measure it.
  const onImageLoad = (event: any) => {
    const source = event?.nativeEvent?.source;
    if (source?.width > 0 && source?.height > 0) setRatio(normalizeImageAspectRatio(source.width / source.height));
  };

  const renderItem = (item: CommunityMediaItem, index: number) =>
    item.type === 'video' ? (
      <VideoTile url={item.url} isActive={index === activeIndex} />
    ) : (
      <Image source={{ uri: item.url }} style={styles.fill} resizeMode="cover" onLoad={index === 0 ? onImageLoad : undefined} />
    );

  return (
    <View style={[styles.mediaWrap, { backgroundColor: theme.surfaceMuted }]} onLayout={onLayout}>
      {media.length === 1 ? (
        <View style={{ aspectRatio: media[0].type === 'video' ? 1 : ratio }}>{renderItem(media[0], 0)}</View>
      ) : width > 0 ? (
        <>
          <FlatList
            data={media}
            horizontal
            pagingEnabled
            initialNumToRender={1}
            windowSize={3}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `${item.url}-${index}`}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(event) => setActiveIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index }) => <View style={{ width, aspectRatio: ratio }}>{renderItem(item, index)}</View>}
          />
          <View style={styles.pagination}>
            {media.map((item, index) => (
              <View
                key={`${item.url}-dot-${index}`}
                style={[styles.dot, { backgroundColor: index === activeIndex ? theme.primary : theme.borderColor }]}
              />
            ))}
          </View>
        </>
      ) : (
        <View style={{ aspectRatio: ratio }} />
      )}
    </View>
  );
}

function PostCard({
  theme,
  post,
  onPressAuthor,
  onLongPress,
  onPressLike,
  onPressComment,
  onPressShare,
  onPressLikeCount,
  onPressMenu,
  onPressFollow,
  commentDisabled,
}: PostCardProps) {
  const { t } = useAppLanguage();
  const likeScale = React.useRef(new Animated.Value(1)).current;
  const prevLikedRef = React.useRef<boolean>(post.likedByMe);
  const [expanded, setExpanded] = React.useState(false);

  const media: CommunityMediaItem[] = React.useMemo(() => {
    if (post.media && post.media.length > 0) return post.media;
    return post.imageUrl ? [{ url: post.imageUrl, type: 'image' }] : [];
  }, [post.media, post.imageUrl]);

  React.useEffect(() => {
    if (!prevLikedRef.current && post.likedByMe) {
      Animated.sequence([
        Animated.spring(likeScale, { toValue: 1.25, useNativeDriver: Platform.OS !== 'web', speed: 18, bounciness: 9 }),
        Animated.spring(likeScale, { toValue: 1, useNativeDriver: Platform.OS !== 'web', speed: 14, bounciness: 7 }),
      ]).start();
    }
    prevLikedRef.current = post.likedByMe;
  }, [likeScale, post.likedByMe]);

  const isLong = post.content.length > LONG_POST_CHARS || post.content.split('\n').length > COLLAPSED_LINES;
  const isDoctor = post.author.role === 'doctor';
  const likeColor = post.likedByMe ? theme.primary : theme.textSecondary;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.cardBackground, borderColor: post.isPinned ? theme.primaryBorder : theme.borderColor },
        elevation(1),
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.authorTap}
          activeOpacity={0.75}
          onPress={onPressAuthor ? () => onPressAuthor(post) : undefined}
          disabled={!onPressAuthor}
          accessibilityRole="button"
          accessibilityLabel={post.author.name}
        >
          <CommunityAvatar name={post.author.name} uri={post.author.avatar} size={42} />
          <View style={styles.authorText}>
            <View style={styles.nameRow}>
              <Text style={[Typography.bodyStrong, styles.name, { color: theme.text }]} numberOfLines={1}>
                {post.author.name}
              </Text>
              {isDoctor ? (
                <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
                  <ShieldCheck size={11} color={theme.primary} />
                  <Text style={[styles.badgeText, { color: theme.primary }]}>{t('community.doctor')}</Text>
                </View>
              ) : post.author.isVerified ? (
                <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
                  <Text style={[styles.badgeText, { color: theme.primary }]}>{t('community.verified')}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
              {communityCategoryLabel(post.category, t)} · {formatCommunityTime(post.createdAt, t)}
            </Text>
          </View>
        </TouchableOpacity>

        {onPressFollow ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onPressFollow(post)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: Boolean(post.followedByMe) }}
            style={[
              styles.followButton,
              post.followedByMe
                ? { backgroundColor: theme.surfaceMuted, borderColor: theme.surfaceMuted }
                : { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder },
            ]}
          >
            <Text style={[styles.followText, { color: post.followedByMe ? theme.textSecondary : theme.primary }]}>
              {post.followedByMe ? t('community.following') : t('community.follow')}
            </Text>
          </TouchableOpacity>
        ) : null}

        {onPressMenu ? (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => onPressMenu(post)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Post options"
          >
            <MoreHorizontal size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {post.isPinned ? (
        <View style={styles.pinnedRow}>
          <Pin size={12} color={theme.primary} />
          <Text style={[styles.badgeText, { color: theme.primary }]}>{t('community.pinned')}</Text>
        </View>
      ) : null}

      <Pressable onLongPress={onLongPress ? () => onLongPress(post) : undefined} delayLongPress={360}>
        {post.content ? (
          <Text style={[styles.body, { color: theme.text }]} numberOfLines={isLong && !expanded ? COLLAPSED_LINES : undefined}>
            {post.content}
          </Text>
        ) : null}
        {isLong ? (
          <Text onPress={() => setExpanded((value) => !value)} style={[Typography.label, styles.seeMore, { color: theme.primary }]}>
            {expanded ? t('community.seeLess') : t('community.seeMore')}
          </Text>
        ) : null}
      </Pressable>

      {media.length > 0 ? <PostMedia media={media} theme={theme} /> : null}

      <View style={[styles.actions, { borderTopColor: theme.divider }]}>
        <View style={styles.action}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onPressLike(post)}
            hitSlop={8}
            style={styles.actionHit}
            accessibilityRole="button"
            accessibilityLabel={t('community.like')}
            accessibilityState={{ selected: post.likedByMe }}
          >
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <Heart size={19} color={likeColor} fill={post.likedByMe ? theme.primary : 'transparent'} />
            </Animated.View>
            {post.likeCount === 0 ? <Text style={[styles.actionText, { color: likeColor }]}>{t('community.like')}</Text> : null}
          </TouchableOpacity>
          {post.likeCount > 0 ? (
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={!onPressLikeCount}
              onPress={() => onPressLikeCount?.(post)}
              hitSlop={8}
              style={styles.actionHit}
              accessibilityRole="button"
              accessibilityLabel={t('community.likes')}
            >
              <Text style={[styles.actionText, { color: likeColor }]}>{post.likeCount}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          activeOpacity={0.7}
          disabled={commentDisabled}
          style={[styles.action, styles.actionHit]}
          onPress={() => onPressComment(post)}
          accessibilityRole="button"
          accessibilityLabel={t('community.comment')}
        >
          <MessageCircle size={19} color={theme.textSecondary} />
          <Text style={[styles.actionText, { color: theme.textSecondary }]}>
            {post.commentCount > 0 ? post.commentCount : t('community.comment')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          style={[styles.action, styles.actionHit]}
          onPress={() => onPressShare(post)}
          accessibilityRole="button"
          accessibilityLabel={t('community.share')}
        >
          <Share2 size={19} color={theme.textSecondary} />
          <Text style={[styles.actionText, { color: theme.textSecondary }]}>
            {post.shareCount > 0 ? post.shareCount : t('community.share')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default React.memo(PostCard);

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  card: { borderWidth: 1, borderRadius: Radius.xl, paddingTop: Spacing.lg, paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  authorTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  authorText: { flex: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.pill },
  badgeText: { fontSize: 11, fontWeight: '700' },
  followButton: { height: 32, paddingHorizontal: 12, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  followText: { fontSize: 12, fontWeight: '700' },
  menuButton: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center' },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: Spacing.sm },
  body: { fontSize: 15, lineHeight: 22 },
  seeMore: { marginTop: 2 },
  mediaWrap: { marginTop: Spacing.md, borderRadius: Radius.md, overflow: 'hidden' },
  videoPoster: { width: '100%', height: '100%', backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  videoOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  pagination: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: Spacing.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionHit: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: 13, fontWeight: '600' },
});
