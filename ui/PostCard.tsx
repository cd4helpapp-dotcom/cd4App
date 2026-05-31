import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Animated, FlatList, Dimensions, Pressable } from 'react-native';
import { Heart, MessageSquare, Share2, Pin, ShieldCheck, MoreHorizontal, Play, Pause } from 'lucide-react-native';
import { Video, ResizeMode } from 'expo-av';
import { Theme } from '../constants/Colors';

const { width: WINDOW_WIDTH } = Dimensions.get('window');
const POST_MARGIN = 16;
const CARD_WIDTH = WINDOW_WIDTH - (POST_MARGIN * 2);

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
  likeDisabled?: boolean;
  commentDisabled?: boolean;
  shareDisabled?: boolean;
  menuDisabled?: boolean;
}

const formatRelativeTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'just now';

  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) return 'just now';
  if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)}m ago`;
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`;
  if (diffMs < 7 * dayMs) return `${Math.floor(diffMs / dayMs)}d ago`;
  return date.toLocaleDateString();
};

const getCategoryLabel = (category: CommunityPostCard['category']): string => {
  if (category === 'success_stories') return 'Success Story';
  if (category === 'challenges') return 'Challenge';
  if (category === 'mentor_tips') return 'Mentor Tip';
  return 'Community';
};

const normalizeImageAspectRatio = (ratio: number): number => {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.max(0.75, Math.min(1.5, ratio));
};

function VideoPlayer({ url, theme, isActive }: { url: string; theme: Theme; isActive: boolean }) {
  const video = React.useRef<Video>(null);
  const [status, setStatus] = React.useState<any>({});

  React.useEffect(() => {
    if (!isActive) {
      video.current?.pauseAsync();
    }
  }, [isActive]);

  const togglePlay = () => {
    if (status.isPlaying) {
      video.current?.pauseAsync();
    } else {
      video.current?.playAsync();
    }
  };

  return (
    <View style={styles.videoContainer}>
      <Video
        ref={video}
        style={styles.videoPlayer}
        source={{ uri: url }}
        useNativeControls={false}
        resizeMode={ResizeMode.COVER}
        isLooping
        onPlaybackStatusUpdate={setStatus}
      />
      <Pressable style={styles.videoOverlay} onPress={togglePlay}>
        {!status.isPlaying && (
          <View style={[styles.playButton, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
            <Play size={32} color="#fff" fill="#fff" />
          </View>
        )}
      </Pressable>
    </View>
  );
}

export default function PostCard({
  theme,
  post,
  onPressAuthor,
  onLongPress,
  onPressLike,
  onPressComment,
  onPressShare,
  onPressLikeCount,
  onPressMenu,
  likeDisabled,
  commentDisabled,
  shareDisabled,
  menuDisabled,
}: PostCardProps) {
  const likeScale = React.useRef(new Animated.Value(1)).current;
  const prevLikedRef = React.useRef<boolean>(post.likedByMe);
  const [imageAspectRatio, setImageAspectRatio] = React.useState(1);
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Derive media list, prioritizing new array but falling back to single image
  const mediaList: CommunityMediaItem[] = React.useMemo(() => {
    if (post.media && post.media.length > 0) return post.media;
    if (post.imageUrl) return [{ url: post.imageUrl, type: 'image' }];
    return [];
  }, [post.media, post.imageUrl]);

  React.useEffect(() => {
    if (!prevLikedRef.current && post.likedByMe) {
      Animated.sequence([
        Animated.spring(likeScale, {
          toValue: 1.25,
          useNativeDriver: true,
          speed: 18,
          bounciness: 9,
        }),
        Animated.spring(likeScale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 14,
          bounciness: 7,
        }),
      ]).start();
    }
    prevLikedRef.current = post.likedByMe;
  }, [likeScale, post.likedByMe]);

  React.useEffect(() => {
    // We only calculate aspect ratio for single image or first media if it is an image
    const firstMedia = mediaList[0];
    if (!firstMedia || firstMedia.type !== 'image') {
      setImageAspectRatio(1.2);
      return;
    }

    let active = true;
    Image.getSize(
      firstMedia.url,
      (width, height) => {
        if (!active || width <= 0 || height <= 0) return;
        setImageAspectRatio(normalizeImageAspectRatio(width / height));
      },
      () => {
        if (active) setImageAspectRatio(1.2);
      }
    );

    return () => {
      active = false;
    };
  }, [mediaList]);

  const onScroll = React.useCallback((event: any) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = Math.floor(event.nativeEvent.contentOffset.x / slideSize + 0.5);
    if (index !== activeIndex) {
      setActiveIndex(index);
    }
  }, [activeIndex]);

  const avatarSource = post.author.avatar?.trim()
    ? { uri: post.author.avatar }
    : { uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(post.author.name || 'User')}` };

  const renderMediaItem = ({ item, index }: { item: CommunityMediaItem; index: number }) => {
    if (item.type === 'video') {
      return <VideoPlayer url={item.url} theme={theme} isActive={index === activeIndex} />;
    }
    return (
      <View style={[styles.mediaItemWrap, { aspectRatio: imageAspectRatio }]}>
        <Image source={{ uri: item.url }} style={styles.postImage} resizeMode="cover" />
      </View>
    );
  };

  return (
    <TouchableOpacity
      activeOpacity={1}
      delayLongPress={360}
      onLongPress={onLongPress ? () => onLongPress(post) : undefined}
      style={[
        styles.postCard,
        {
          backgroundColor: theme.cardBackground,
          borderColor: post.isPinned ? theme.successBorder : theme.borderColor,
          borderWidth: post.isPinned ? 1.5 : 1,
        },
      ]}
    >
      <View style={styles.postHeader}>
        <TouchableOpacity
          style={styles.authorTapArea}
          activeOpacity={0.8}
          onPress={onPressAuthor ? () => onPressAuthor(post) : undefined}
          disabled={!onPressAuthor}
        >
        <Image source={avatarSource} style={[styles.avatar, { backgroundColor: theme.borderColor }]} />
        <View style={styles.authorBlock}>
          <View style={styles.authorTopRow}>
            <Text style={[styles.userName, { color: theme.text }]}>{post.author.name}</Text>
            {post.author.role === 'doctor' && (
              <View style={[styles.roleBadge, { backgroundColor: theme.successLight }]}>
                <ShieldCheck size={11} color={theme.success} style={{ marginRight: 4 }} />
                <Text style={[styles.roleBadgeText, { color: theme.success }]}>Doctor</Text>
              </View>
            )}
            {post.author.isVerified && post.author.role !== 'doctor' && (
              <View style={[styles.roleBadge, { backgroundColor: theme.successLight }]}>
                <Text style={[styles.roleBadgeText, { color: theme.success }]}>Verified</Text>
              </View>
            )}
          </View>
          <Text style={[styles.timestamp, { color: theme.textSecondary }]}>
            {getCategoryLabel(post.category)} • {formatRelativeTime(post.createdAt)}
          </Text>
        </View>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          {onPressMenu ? (
            <TouchableOpacity
              style={[styles.menuButton, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
              activeOpacity={0.85}
              disabled={menuDisabled}
              onPress={() => onPressMenu(post)}
            >
              <MoreHorizontal size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          ) : null}
          {post.isPinned && (
            <View style={[styles.pinnedLabel, { backgroundColor: theme.successLight }]}>
              <Pin size={12} color={theme.success} style={{ marginRight: 4 }} />
              <Text style={[styles.pinnedText, { color: theme.success }]}>Pinned</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={[styles.postBody, { color: theme.text }]}>{post.content}</Text>

      {mediaList.length > 0 && (
        <View style={styles.carouselContainer}>
          <FlatList
            data={mediaList}
            renderItem={renderMediaItem}
            keyExtractor={(item, index) => `${item.url}-${index}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
          />
          {mediaList.length > 1 && (
            <View style={styles.pagination}>
              {mediaList.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.paginationDot,
                    { backgroundColor: i === activeIndex ? theme.success : theme.textSecondary + '40' },
                    i === activeIndex ? styles.paginationDotActive : null,
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      )}

      <View style={[styles.interactionRow, { borderTopColor: theme.borderColor }]}>
        <View style={styles.interactionItem}>
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={likeDisabled}
            onPress={() => onPressLike(post)}
            style={{ paddingVertical: 4, paddingRight: 6 }}
          >
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <Heart
                size={17}
                color={post.likedByMe ? theme.success : theme.textSecondary}
                fill={post.likedByMe ? theme.success : 'transparent'}
              />
            </Animated.View>
          </TouchableOpacity>
          <TouchableOpacity 
            activeOpacity={0.7} 
            disabled={!onPressLikeCount || likeDisabled}
            onPress={() => onPressLikeCount?.(post)}
            style={{ paddingVertical: 4, minWidth: 20 }}
          >
            <Text style={[styles.interactionText, { color: post.likedByMe ? theme.success : theme.textSecondary, marginLeft: 0 }]}>
              {post.likeCount}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={commentDisabled}
          style={styles.interactionItem}
          onPress={() => onPressComment(post)}
        >
          <MessageSquare size={17} color={theme.textSecondary} />
          <Text style={[styles.interactionText, { color: theme.textSecondary }]}>{post.commentCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={shareDisabled}
          style={styles.interactionItem}
          onPress={() => onPressShare(post)}
        >
          <Share2 size={17} color={theme.textSecondary} />
          <Text style={[styles.interactionText, { color: theme.textSecondary }]}>{post.shareCount}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  postCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  authorTapArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  authorBlock: {
    flex: 1,
    marginLeft: 12,
  },
  authorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    flexWrap: 'wrap',
    gap: 6,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 12,
  },
  pinnedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  headerActions: {
    marginLeft: 8,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 8,
  },
  menuButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinnedText: {
    fontSize: 10,
    fontWeight: '700',
  },
  postBody: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
  carouselContainer: {
    width: '100%',
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  mediaItemWrap: {
    width: CARD_WIDTH - 32, // Accommodate card padding
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  videoContainer: {
    width: CARD_WIDTH - 32,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  paginationDotActive: {
    width: 12,
    height: 6,
    borderRadius: 3,
  },
  interactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 22,
  },
  interactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  interactionText: {
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '600',
  },
});
