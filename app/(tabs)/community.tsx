import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  useColorScheme,
  Image,
  Pressable,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Alert,
  Share,
  Linking,
} from 'react-native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Camera,
  Tag,
  X,
  Send,
  Megaphone,
  Share2,
  EyeOff,
  Pencil,
  Trash2,
  Flag,
  UserX,
  VolumeX,
  MessageCircle,
} from 'lucide-react-native';
import PostCard, { CommunityPostCard } from '../../ui/PostCard';
import Colors from '../../constants/Colors';
import { CommunityTabSkeleton } from '../../ui/common/TabLoadingSkeletons';
import {
  CommunityAd,
  CommunityCategory,
  CommunityMediaAssetInput,
  CommunityPost,
  CommunityComment,
  useBlockCommunityUser,
  useAddCommunityComment,
  useCommunityComments,
  useCommunityFeed,
  useCreateCommunityPost,
  useDeleteCommunityPost,
  useEditCommunityPost,
  useMuteCommunityKeyword,
  useReportCommunityPost,
  useTrackCommunityAdEvent,
  useToggleCommunityLike,
  useTrackCommunityShare,
  useCommunityPostLikes,
  patchFeedPostsInCache,
} from '../../hooks/useCommunity';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { useAuthContext } from '../../context/AuthContext';
import { useDeferredFocusSync } from '../../hooks/useDeferredFocusSync';

type FeedFilter = 'all' | CommunityCategory;
type FeedItem = { type: 'post'; id: string; post: CommunityPost } | { type: 'ad'; id: string; ad: CommunityAd };

const FEED_FILTERS: Array<{ label: string; value: FeedFilter }> = [
  { label: 'All Posts', value: 'all' },
  { label: 'Success Stories', value: 'success_stories' },
  { label: 'Challenges', value: 'challenges' },
  { label: 'Mentor Tips', value: 'mentor_tips' },
];

const COMPOSER_CATEGORY_SEQUENCE: CommunityCategory[] = ['general', 'success_stories', 'challenges', 'mentor_tips'];

const getComposerCategoryLabel = (value: CommunityCategory): string => {
  if (value === 'success_stories') return 'Success Story';
  if (value === 'challenges') return 'Challenge';
  if (value === 'mentor_tips') return 'Mentor Tip';
  return 'General';
};

const formatCommentTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'now';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const mapPostToCardModel = (post: CommunityPost): CommunityPostCard => ({
  id: post.id,
  content: post.content,
  imageUrl: post.imageUrl,
  category: post.category,
  createdAt: post.createdAt,
  isPinned: post.isPinned,
  likeCount: post.likeCount,
  commentCount: post.commentCount,
  shareCount: post.shareCount,
  likedByMe: post.likedByMe,
  media: post.media,
  author: {
    id: post.author.id,
    name: post.author.fullName,
    avatar: post.author.profilePicture,
    role: post.author.role,
    isVerified: post.author.isVerified,
  },
});

const COMMUNITY_POST_DEEPLINK_PREFIX = 'cd4://community/post';
const COMMUNITY_POST_WEB_LINK_PREFIX = 'https://cd4.app/community/post';

const clipShareText = (value: string, max: number): string => {
  const text = (value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

type PostActionItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  danger?: boolean;
  onPress: () => void;
};

export default function CommunityScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user, session } = useAuthContext();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [composerText, setComposerText] = React.useState('');
  const [composerCategory, setComposerCategory] = React.useState<CommunityCategory>('general');
  const [composerAssets, setComposerAssets] = React.useState<ImagePicker.ImagePickerAsset[]>([]);
  const [composerStage, setComposerStage] = React.useState<'uploading' | 'scanning' | 'publishing' | null>(null);
  const [activeFilter, setActiveFilter] = React.useState<FeedFilter>('all');
  const [activePost, setActivePost] = React.useState<CommunityPost | null>(null);
  const [commentsVisible, setCommentsVisible] = React.useState(false);
  const [commentText, setCommentText] = React.useState('');
  const [isPullRefreshing, setIsPullRefreshing] = React.useState(false);
  const [isTabSwitchLoading, setIsTabSwitchLoading] = React.useState(false);
  const [pendingLikePostIds, setPendingLikePostIds] = React.useState<Record<string, true>>({});
  const [pendingSharePostIds, setPendingSharePostIds] = React.useState<Record<string, true>>({});
  const [hiddenPostIds, setHiddenPostIds] = React.useState<Record<string, true>>({});
  const [postActionsVisible, setPostActionsVisible] = React.useState(false);
  const [postActionsTarget, setPostActionsTarget] = React.useState<CommunityPost | null>(null);
  const [editPostVisible, setEditPostVisible] = React.useState(false);
  const [editPostId, setEditPostId] = React.useState<string | null>(null);
  const [editPostText, setEditPostText] = React.useState('');
  const [editPostAssets, setEditPostAssets] = React.useState<ImagePicker.ImagePickerAsset[]>([]);
  const [replyTo, setReplyTo] = React.useState<CommunityComment | null>(null);
  const [likesVisible, setLikesVisible] = React.useState(false);
  const [activeLikesPostId, setActiveLikesPostId] = React.useState<string | null>(null);
  const [modalKeyboardHeight, setModalKeyboardHeight] = React.useState(0);
  const commentInputRef = React.useRef<TextInput>(null);
  const tabSwipeHandlers = useTabSwipeNavigation('community', {
    disabled: commentsVisible || postActionsVisible || editPostVisible || likesVisible,
  });
  const seenAdImpressionsRef = React.useRef(new Set<string>());
  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 60 }).current;

  const feedQuery = useCommunityFeed(user?.id || null);
  const createPostMutation = useCreateCommunityPost(user?.id || null);
  const deletePostMutation = useDeleteCommunityPost(user?.id || null);
  const editPostMutation = useEditCommunityPost(user?.id || null);
  const toggleLikeMutation = useToggleCommunityLike(user?.id || null);
  const addCommentMutation = useAddCommunityComment(user?.id || null);
  const reportPostMutation = useReportCommunityPost(user?.id || null);
  const blockUserMutation = useBlockCommunityUser(user?.id || null);
  const muteKeywordMutation = useMuteCommunityKeyword(user?.id || null);
  const trackAdEventMutation = useTrackCommunityAdEvent(user?.id || null);
  const trackShareMutation = useTrackCommunityShare(user?.id || null);
  const commentsQuery = useCommunityComments(activePost?.id || null, commentsVisible);
  const refetchFeed = feedQuery.refetch;

  // Keyboard listeners are no longer needed for manual padding as we'll use standard KeyboardAvoidingView
  React.useEffect(() => {
    return () => {
      setModalKeyboardHeight(0);
    };
  }, []);

  const pagedFeed = feedQuery.data?.pages || [];
  const posts = React.useMemo(() => {
    if (pagedFeed.length === 0) return [];
    const seen = new Set<string>();
    const merged: CommunityPost[] = [];
    pagedFeed.forEach((page) => {
      page.posts.forEach((post) => {
        if (!seen.has(post.id)) {
          seen.add(post.id);
          merged.push(post);
        }
      });
    });
    return merged;
  }, [pagedFeed]);
  const activeAds = React.useMemo(() => {
    const firstPageWithAds = pagedFeed.find((page) => page.ads.length > 0);
    return firstPageWithAds?.ads || [];
  }, [pagedFeed]);
  const comments = commentsQuery.data || [];
  const modalBottomInset = Math.max(insets.bottom + 8, 14);

  const filteredPosts = React.useMemo(() => {
    const basePosts = activeFilter === 'all' ? posts : posts.filter((post) => post.category === activeFilter);
    return basePosts.filter((post) => !hiddenPostIds[post.id]);
  }, [activeFilter, hiddenPostIds, posts]);

  const feedItems: FeedItem[] = React.useMemo(() => {
    const postItems: FeedItem[] = filteredPosts.map((post) => ({ type: 'post', id: post.id, post }));
    if (activeAds.length === 0) return postItems;

    const items: FeedItem[] = [];
    const firstAd = activeAds[0];
    const interval = Math.max(2, firstAd.frequencyInterval || 4);

    postItems.forEach((item, index) => {
      items.push(item);
      if ((index + 1) % interval === 0) {
        const ad = activeAds[index % activeAds.length] || firstAd;
        items.push({ type: 'ad', id: `ad-${ad.id}-${index}`, ad });
      }
    });

    if (items.length === 0 && firstAd) {
      items.push({ type: 'ad', id: `ad-${firstAd.id}-empty`, ad: firstAd });
    }

    return items;
  }, [activeAds, filteredPosts]);

  const cycleComposerCategory = () => {
    const currentIndex = COMPOSER_CATEGORY_SEQUENCE.indexOf(composerCategory);
    const nextIndex = (currentIndex + 1) % COMPOSER_CATEGORY_SEQUENCE.length;
    setComposerCategory(COMPOSER_CATEGORY_SEQUENCE[nextIndex]);
  };

  const pickComposerAssets = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow media permission to attach photos or videos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.7,
      });

      if (result.canceled || !result.assets?.length) return;
      
      // Merge with existing or replace? User expects merge usually
      setComposerAssets((prev) => [...prev, ...result.assets].slice(0, 10));
    } catch {
      Alert.alert('Media Error', 'Could not open media library right now.');
    }
  };

  const removeComposerAsset = (index: number) => {
    setComposerAssets((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreatePost = async () => {
    if (!user?.id) {
      Alert.alert('Login Required', 'Please login to create posts.');
      return;
    }

    try {
      setComposerStage(composerAssets.length > 0 ? 'uploading' : 'publishing');
      const result = await createPostMutation.mutateAsync({
        content: composerText,
        category: composerCategory,
        assets: composerAssets.map(a => ({
          uri: a.uri,
          fileName: a.fileName || `media_${Date.now()}`,
          mimeType: a.mimeType || 'image/jpeg',
          fileSize: a.fileSize || 0,
        })),
      });
      setComposerText('');
      setComposerCategory('general');
      setComposerAssets([]);
      setComposerStage(null);
    } catch (error: any) {
      setComposerStage(null);
      Alert.alert('Post Failed', error?.message || 'Could not publish post.');
    }
  };

  const handleLike = async (post: CommunityPostCard) => {
    const target = posts.find((item) => item.id === post.id);
    if (!target) return;
    if (pendingLikePostIds[target.id]) return;

    setPendingLikePostIds((prev) => ({ ...prev, [target.id]: true }));
    try {
      await toggleLikeMutation.mutateAsync({ postId: target.id, currentlyLiked: target.likedByMe });
    } catch (error: any) {
      Alert.alert('Like Failed', error?.message || 'Could not update like right now.');
    } finally {
      setPendingLikePostIds((prev) => {
        if (!prev[target.id]) return prev;
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
    }
  };

  const handleOpenLikes = (post: CommunityPostCard) => {
    setActiveLikesPostId(post.id);
    setLikesVisible(true);
  };

  const handleOpenComments = (post: CommunityPostCard) => {
    const target = posts.find((item) => item.id === post.id);
    if (!target) return;
    setActivePost(target);
    setCommentText('');
    setReplyTo(null);
    setCommentsVisible(true);
  };

  const handleOpenAuthorProfile = (post: CommunityPostCard) => {
    const authorId = post?.author?.id;
    if (!authorId) return;
    router.push({ pathname: '/user/[id]', params: { id: authorId, source: 'community' } } as any);
  };

  const closeCommentsModal = React.useCallback(() => {
    Keyboard.dismiss();
    setCommentsVisible(false);
    setReplyTo(null);
  }, []);

  const handleSubmitComment = async () => {
    if (!activePost) return;
    try {
      await addCommentMutation.mutateAsync({
        postId: activePost.id,
        content: commentText,
        parentId: replyTo?.id,
      });
      setCommentText('');
      setReplyTo(null);
    } catch (error: any) {
      Alert.alert('Comment Failed', error?.message || 'Could not add comment.');
    }
  };

  const handleShare = async (post: CommunityPostCard) => {
    const target = posts.find((item) => item.id === post.id);
    if (!target) return;
    if (pendingSharePostIds[target.id]) return;

    setPendingSharePostIds((prev) => ({ ...prev, [target.id]: true }));
    try {
      const deepLink = `${COMMUNITY_POST_DEEPLINK_PREFIX}/${target.id}`;
      const webLink = `${COMMUNITY_POST_WEB_LINK_PREFIX}/${target.id}`;
      const postPreview = clipShareText(post.content, 220);
      const startedAt = Date.now();
      
      const result = await Share.share({
        message: `${post.author.name}: ${postPreview}\n\n📲 Open in CD4 App (Internal):\n${deepLink}\n\n🌐 Web Link (Coming Soon):\n${webLink}`,
      });

      const elapsedMs = Date.now() - startedAt;
      const isDismissed = result.action === Share.dismissedAction;
      const isShared = result.action === Share.sharedAction;

      if (isDismissed) {
        return;
      }

      // Android share sheet often reports "shared" immediately on dismiss.
      // We treat extremely short sessions (< 700ms) as likely dismissals.
      if (Platform.OS === 'android' && !isShared && elapsedMs < 700) {
        return;
      }

      trackShareMutation.mutate({ postId: target.id, platform: 'native' });
    } catch (error: any) {
      Alert.alert('Share Failed', error?.message || 'Could not share this post.');
    } finally {
      setPendingSharePostIds((prev) => {
        if (!prev[target.id]) return prev;
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
    }
  };

  const handleManualRefresh = React.useCallback(async () => {
    if (isPullRefreshing) return;
    setIsPullRefreshing(true);
    try {
      await refetchFeed();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [isPullRefreshing, refetchFeed]);

  const syncCommunityOnFocus = React.useCallback(async () => {
    await refetchFeed();
  }, [refetchFeed]);
  const shouldShowCommunityInitialLoading = React.useCallback(
    () => posts.length === 0,
    [posts.length]
  );
  const showCommunityInitialLoading = React.useCallback(() => setIsTabSwitchLoading(true), []);
  const hideCommunityInitialLoading = React.useCallback(() => setIsTabSwitchLoading(false), []);

  useDeferredFocusSync({
    sync: syncCommunityOnFocus,
    shouldShowInitialLoading: shouldShowCommunityInitialLoading,
    onInitialLoadingStart: showCommunityInitialLoading,
    onInitialLoadingEnd: hideCommunityInitialLoading,
  });

  const showFeedSkeleton = (isTabSwitchLoading || (feedQuery.isLoading && posts.length === 0)) && !isPullRefreshing;
  const showFeedSkeletonRef = React.useRef(showFeedSkeleton);
  const trackAdEventMutationRef = React.useRef(trackAdEventMutation);

  React.useEffect(() => {
    showFeedSkeletonRef.current = showFeedSkeleton;
  }, [showFeedSkeleton]);

  React.useEffect(() => {
    trackAdEventMutationRef.current = trackAdEventMutation;
  }, [trackAdEventMutation]);

  const handleAdOpen = async (ad: CommunityAd) => {
    if (!ad.ctaUrl) return;
    try {
      const canOpen = await Linking.canOpenURL(ad.ctaUrl);
      if (!canOpen) {
        Alert.alert('Invalid Link', 'Could not open this ad link.');
        return;
      }
      trackAdEventMutation.mutate({ adId: ad.id, eventType: 'click', source: 'community_feed' });
      await Linking.openURL(ad.ctaUrl);
    } catch {
      Alert.alert('Link Error', 'Could not open this ad right now.');
    }
  };

  const deriveMuteKeywordFromPost = (postText: string): string | null => {
    const words = (postText || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 4 && !['with', 'that', 'this', 'from', 'have', 'your', 'about'].includes(word));
    return words[0] || null;
  };

  const hidePostFromFeed = (postId: string) => {
    setHiddenPostIds((prev) => ({ ...prev, [postId]: true }));
  };

  const closePostActionsModal = () => {
    setPostActionsVisible(false);
    setPostActionsTarget(null);
  };

  const handleDeletePost = async (postId: string) => {
    try {
      await deletePostMutation.mutateAsync({ postId });
      hidePostFromFeed(postId);
      Alert.alert('Post Deleted', 'Your post has been removed.');
    } catch (error: any) {
      Alert.alert('Delete Failed', error?.message || 'Could not delete this post.');
    }
  };

  const handleSaveEditedPost = async () => {
    if (!editPostId) return;
    try {
      await editPostMutation.mutateAsync({
        postId: editPostId,
        content: editPostText,
        assets: editPostAssets.length > 0 ? editPostAssets.map(a => ({
          uri: a.uri,
          fileName: a.fileName || `edit_${Date.now()}`,
          mimeType: a.mimeType || 'image/jpeg',
          fileSize: a.fileSize || 0,
        })) : undefined,
      });
      setEditPostVisible(false);
      setEditPostId(null);
      setEditPostText('');
      setEditPostAssets([]);
      Alert.alert('Post Updated', 'Your post has been updated.');
    } catch (error: any) {
      Alert.alert('Edit Failed', error?.message || 'Could not update this post.');
    }
  };

  const openPostActions = (post: CommunityPostCard) => {
    const target = posts.find((item) => item.id === post.id);
    if (!target) return;
    setPostActionsTarget(target);
    setPostActionsVisible(true);
  };

  const handleLongPressPost = (post: CommunityPostCard) => {
    openPostActions(post);
  };

  const postActionItems: PostActionItem[] = React.useMemo(() => {
    if (!postActionsTarget) return [];

    const target = postActionsTarget;
    const isOwnPost = target.authorId === user?.id;
    const muteKeyword = deriveMuteKeywordFromPost(target.content);
    const asCard = mapPostToCardModel(target);
    const items: PostActionItem[] = [
      {
        key: 'share',
        label: 'Share',
        icon: Share2,
        onPress: () => {
          closePostActionsModal();
          void handleShare(asCard);
        },
      },
      {
        key: 'hide',
        label: 'Hide Post',
        icon: EyeOff,
        onPress: () => {
          hidePostFromFeed(target.id);
          closePostActionsModal();
        },
      },
    ];

    if (isOwnPost) {
      items.push({
        key: 'edit',
        label: 'Edit Post',
        icon: Pencil,
        onPress: () => {
          setEditPostId(target.id);
          setEditPostText(target.content);
          setEditPostAssets([]); // Reset assets when opening edit
          setEditPostVisible(true);
          closePostActionsModal();
        },
      });
      items.push({
        key: 'delete',
        label: 'Delete Post',
        icon: Trash2,
        danger: true,
        onPress: () => {
          closePostActionsModal();
          Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                void handleDeletePost(target.id);
              },
            },
          ]);
        },
      });
    }

    items.push({
      key: 'report',
      label: 'Report Post',
      icon: Flag,
      danger: true,
      onPress: () => {
        closePostActionsModal();
        reportPostMutation.mutate(
          { postId: target.id, reason: 'abuse', details: 'Reported from community feed.' },
          {
            onSuccess: () => Alert.alert('Reported', 'Thanks. This post has been reported for review.'),
            onError: (error: any) => Alert.alert('Could not report', error?.message || 'Please try again.'),
          }
        );
      },
    });

    if (target.authorId && target.authorId !== user?.id) {
      items.push({
        key: 'block-user',
        label: 'Block User',
        icon: UserX,
        onPress: () => {
          closePostActionsModal();
          blockUserMutation.mutate(
            { blockedUserId: target.authorId },
            {
              onSuccess: () => Alert.alert('User Blocked', 'You will not see posts from this user anymore.'),
              onError: (error: any) => Alert.alert('Could not block', error?.message || 'Please try again.'),
            }
          );
        },
      });
    }

    if (muteKeyword) {
      items.push({
        key: 'mute-keyword',
        label: `Mute "${muteKeyword}"`,
        icon: VolumeX,
        onPress: () => {
          closePostActionsModal();
          muteKeywordMutation.mutate(
            { keyword: muteKeyword },
            {
              onSuccess: () => Alert.alert('Muted', `Posts containing "${muteKeyword}" will be hidden.`),
              onError: (error: any) => Alert.alert('Could not mute', error?.message || 'Please try again.'),
            }
          );
        },
      });
    }

    return items;
  }, [
    blockUserMutation,
    muteKeywordMutation,
    postActionsTarget,
    reportPostMutation,
    user?.id,
  ]);

  const handleLoadMore = React.useCallback(() => {
    if (showFeedSkeletonRef.current || !feedQuery.hasNextPage || feedQuery.isFetchingNextPage || feedQuery.isLoading) {
      return;
    }
    feedQuery.fetchNextPage();
  }, [feedQuery]);

  const onViewableItemsChanged = React.useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: FeedItem; isViewable?: boolean }> }) => {
      if (showFeedSkeletonRef.current) return;
      viewableItems.forEach((viewable) => {
        if (!viewable?.isViewable) return;
        const entry = viewable.item;
        if (!entry || entry.type !== 'ad') return;
        if (seenAdImpressionsRef.current.has(entry.ad.id)) return;
        seenAdImpressionsRef.current.add(entry.ad.id);
        trackAdEventMutationRef.current.mutate({
          adId: entry.ad.id,
          eventType: 'impression',
          source: 'community_feed',
        });
      });
    }
  ).current;

  const renderAdCard = (ad: CommunityAd) => {
    return (
      <View style={[styles.adCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <View style={styles.adHeader}>
          <View style={[styles.adIconWrap, { backgroundColor: theme.successLight }]}>
            <Megaphone size={16} color={theme.success} />
          </View>
          <Text style={[styles.adMeta, { color: theme.textSecondary }]}>Sponsored</Text>
        </View>
        <Text style={[styles.adTitle, { color: theme.text }]}>{ad.title}</Text>
        {!!ad.body && <Text style={[styles.adBody, { color: theme.textSecondary }]}>{ad.body}</Text>}
        {ad.imageUrl ? <Image source={{ uri: ad.imageUrl }} style={styles.adImage} /> : null}
        {ad.ctaLabel && ad.ctaUrl ? (
          <TouchableOpacity
            style={[styles.adCtaButton, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}
            onPress={() => handleAdOpen(ad)}
          >
            <Text style={[styles.adCtaText, { color: theme.success }]}>{ad.ctaLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const headerComponent = (
    <View>
      <View style={styles.headerContainer}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Community Circle</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
            Real stories, trusted guidance, and support for your health journey.
          </Text>
        </View>
      </View>

      {/* Temporarily disabled static challenge card until dynamic challenge API is integrated. */}
      {/* <View style={[styles.challengeCard, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
        <View style={styles.challengeHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.challengeIcon, { backgroundColor: theme.success }]}>
              <TrendingDown size={18} color="#fff" />
            </View>
            <View>
              <Text style={[styles.challengeTitle, { color: theme.text }]}>Active Challenge</Text>
              <Text style={[styles.challengeSubtitle, { color: theme.textSecondary }]}>Post-Meal Walk • Day 3/7</Text>
            </View>
          </View>
          <Text style={[styles.challengeStatus, { color: theme.success, backgroundColor: theme.background }]}>On Track</Text>
        </View>
        <View style={[styles.progressBarBg, { backgroundColor: theme.background }]}>
          <View style={[styles.progressBarFill, { backgroundColor: theme.success, width: '45%' }]} />
        </View>
        <Text style={[styles.challengeMotivational, { color: theme.textSecondary }]}>You are on a streak. Keep it up.</Text>
      </View> */}

      <View style={[styles.createPostCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <View style={styles.inputRow}>
          <View style={[styles.currentUserAvatar, { backgroundColor: theme.borderColor }]}>
            <Image
              source={{
                uri:
                  user?.profilePicture?.trim() ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(`${user?.firstName || 'User'} ${user?.lastName || ''}`.trim())}`,
              }}
              style={styles.avatarImage}
            />
          </View>
          <TextInput
            value={composerText}
            onChangeText={setComposerText}
            placeholder="Share your reversal progress with the community..."
            placeholderTextColor={theme.textSecondary}
            style={[styles.textInput, { color: theme.text }]}
            multiline
          />
        </View>
        {composerAssets.length > 0 ? (
          <FlatList
            data={composerAssets}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `${item.uri}-${index}`}
            contentContainerStyle={styles.composerMediaList}
            renderItem={({ item, index }) => (
              <View style={styles.composerAssetWrap}>
                <Image source={{ uri: item.uri }} style={styles.composerAssetPreview} />
                {item.mimeType?.startsWith('video/') && (
                  <View style={styles.videoBadge}>
                    <Text style={styles.videoBadgeText}>VIDEO</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.composerAssetRemove, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                  onPress={() => removeComposerAsset(index)}
                >
                  <X size={12} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
            )}
          />
        ) : null}
        <View style={[styles.postActions, { borderTopColor: theme.borderColor }]}>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.background }]} onPress={pickComposerAssets}>
            <Camera size={16} color={theme.success} />
            <Text style={[styles.actionButtonText, { color: theme.textSecondary }]}>
              {composerAssets.length > 0 ? `${composerAssets.length} Selected` : 'Media'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.background }]}
            onPress={cycleComposerCategory}
          >
            <Tag size={16} color={theme.success} />
            <Text style={[styles.actionButtonText, { color: theme.textSecondary }]}>
              {getComposerCategoryLabel(composerCategory)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.postButton, { backgroundColor: theme.success, opacity: createPostMutation.isPending ? 0.7 : 1 }]}
            disabled={createPostMutation.isPending}
            onPress={handleCreatePost}
          >
            {createPostMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.postButtonText}>Post</Text>
            )}
          </TouchableOpacity>
        </View>
        {createPostMutation.isPending && composerStage ? (
          <Text style={[styles.composerStageText, { color: theme.textSecondary }]}>
            {composerStage === 'uploading'
              ? `Uploading ${composerAssets.length} item(s)...`
              : composerStage === 'scanning'
              ? 'Safety scan in progress...'
              : 'Publishing your post...'}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={FEED_FILTERS}
        horizontal
        keyExtractor={(item) => item.value}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.filterListContent}
        renderItem={({ item }) => {
          const selected = activeFilter === item.value;
          return (
            <TouchableOpacity
              style={[
                styles.filterChip,
                {
                  backgroundColor: selected ? theme.text : theme.cardBackground,
                  borderColor: selected ? theme.text : theme.borderColor,
                },
              ]}
              onPress={() => setActiveFilter(item.value)}
            >
              <Text style={[styles.filterText, { color: selected ? theme.background : theme.textSecondary }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );

  return (
    <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={showFeedSkeleton ? [] : feedItems}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={showFeedSkeleton ? null : headerComponent}
        renderItem={({ item }) => {
          if (item.type === 'ad') {
            return renderAdCard(item.ad);
          }
          return (
            <PostCard
              theme={theme}
              post={mapPostToCardModel(item.post)}
              onLongPress={handleLongPressPost}
              onPressMenu={openPostActions}
              onPressLike={handleLike}
              onPressLikeCount={handleOpenLikes}
              onPressComment={handleOpenComments}
              onPressShare={handleShare}
              onPressAuthor={handleOpenAuthorProfile}
              likeDisabled={Boolean(pendingLikePostIds[item.post.id])}
              commentDisabled={false}
              shareDisabled={Boolean(pendingSharePostIds[item.post.id])}
              menuDisabled={deletePostMutation.isPending}
            />
          );
        }}
        ListEmptyComponent={
          showFeedSkeleton || feedQuery.isLoading ? (
            <CommunityTabSkeleton theme={theme} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No posts yet</Text>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                Be the first to share your health progress.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          showFeedSkeleton ? null : feedQuery.isFetchingNextPage ? (
            <View style={styles.listFooterLoader}>
              <ActivityIndicator color={theme.success} />
            </View>
          ) : (
            <View style={styles.listFooterSpace} />
          )
        }
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isPullRefreshing} onRefresh={handleManualRefresh} />}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.45}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      <Modal visible={postActionsVisible} transparent animationType="slide" onRequestClose={closePostActionsModal}>
        <Pressable style={styles.actionSheetBackdrop} onPress={closePostActionsModal}>
          <Pressable
            style={[
              styles.actionSheetCard,
              { backgroundColor: theme.cardBackground, borderColor: theme.borderColor, paddingBottom: modalBottomInset },
            ]}
            onPress={() => {}}
          >
            <View style={[styles.actionSheetGrabber, { backgroundColor: theme.borderColor }]} />
            {postActionItems.map((action, index) => {
              const dangerColor = '#DC2626';
              const toneColor = action.danger ? dangerColor : theme.text;
              const iconColor = action.danger ? dangerColor : theme.textSecondary;
              const Icon = action.icon;
              return (
                <TouchableOpacity
                  key={action.key}
                  style={[
                    styles.actionSheetRow,
                    {
                      borderBottomColor: theme.borderColor,
                      borderBottomWidth: index === postActionItems.length - 1 ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                  onPress={action.onPress}
                >
                  <View
                    style={[
                      styles.actionSheetIconWrap,
                      {
                        backgroundColor: action.danger ? '#FEE2E2' : theme.background,
                        borderColor: action.danger ? '#FECACA' : theme.borderColor,
                      },
                    ]}
                  >
                    <Icon size={16} color={iconColor} />
                  </View>
                  <Text style={[styles.actionSheetText, { color: toneColor }]}>{action.label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.actionSheetCancel, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
              onPress={closePostActionsModal}
            >
              <Text style={[styles.actionSheetCancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <LikesUserListModal 
        visible={likesVisible}
        onClose={() => setLikesVisible(false)}
        postId={activeLikesPostId}
        theme={theme}
      />

      <Modal visible={editPostVisible} transparent animationType="slide" onRequestClose={() => setEditPostVisible(false)}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalWrap}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <View style={[styles.editCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={[styles.modalHeader, { borderBottomColor: theme.borderColor }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Post</Text>
              <TouchableOpacity onPress={() => setEditPostVisible(false)}>
                <X size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={[styles.editBody, { paddingBottom: modalBottomInset }]}>
              <TextInput
                value={editPostText}
                onChangeText={setEditPostText}
                placeholder="Update your post..."
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.editInput,
                  {
                    color: theme.text,
                    borderColor: theme.borderColor,
                    backgroundColor: theme.background,
                  },
                ]}
                multiline
              />

              {editPostAssets.length > 0 ? (
                <FlatList
                  data={editPostAssets}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item, index) => `edit-media-${index}`}
                  contentContainerStyle={styles.composerMediaList}
                  renderItem={({ item, index }) => (
                    <View style={styles.composerAssetWrap}>
                      <Image source={{ uri: item.uri }} style={styles.composerAssetPreview} />
                      <TouchableOpacity
                        style={[styles.composerAssetRemove, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                        onPress={() => setEditPostAssets(prev => prev.filter((_, i) => i !== index))}
                      >
                        <X size={12} color={theme.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              ) : null}

              <TouchableOpacity 
                style={[styles.actionButton, { marginTop: 12, backgroundColor: theme.background, alignSelf: 'flex-start' }]} 
                onPress={async () => {
                  try {
                    const result = await ImagePicker.launchImageLibraryAsync({
                      mediaTypes: ImagePicker.MediaTypeOptions.All,
                      allowsMultipleSelection: true,
                      quality: 0.7,
                    });
                    if (!result.canceled && result.assets?.length) {
                      setEditPostAssets(result.assets);
                    }
                  } catch {
                    Alert.alert('Error', 'Could not open media library.');
                  }
                }}
              >
                <Camera size={16} color={theme.success} />
                <Text style={[styles.actionButtonText, { color: theme.textSecondary }]}>
                  {editPostAssets.length > 0 ? 'Replace Media' : 'Add/Change Media'}
                </Text>
              </TouchableOpacity>

              <View style={styles.editActionsRow}>
                <TouchableOpacity
                  style={[styles.editCancelBtn, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                  onPress={() => setEditPostVisible(false)}
                >
                  <Text style={[styles.editCancelText, { color: theme.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editSaveBtn, { backgroundColor: theme.success, opacity: editPostMutation.isPending ? 0.7 : 1 }]}
                  disabled={editPostMutation.isPending}
                  onPress={handleSaveEditedPost}
                >
                  {editPostMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.editSaveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={commentsVisible} transparent animationType="slide" onRequestClose={closeCommentsModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalWrap}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <Pressable style={styles.modalTapCatch} onPress={closeCommentsModal} />
          <View style={[styles.modalCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={[styles.modalHeader, { borderBottomColor: theme.borderColor }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Comments</Text>
              <TouchableOpacity onPress={closeCommentsModal}>
                <X size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              style={styles.commentsList}
              contentContainerStyle={[
                styles.commentsListContent,
                comments.length === 0 && { flexGrow: 1, justifyContent: 'center' }
              ]}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => {
                const parentComment = item.parentId ? comments.find(c => c.id === item.parentId) : null;
                const nextItem = comments[index + 1];
                const isEndOfThread = !nextItem || !nextItem.parentId;
                const isLastItem = index === comments.length - 1;

                return (
                  <View style={[
                    styles.commentRow, 
                    { 
                      borderBottomColor: theme.borderColor,
                      borderBottomWidth: isEndOfThread ? StyleSheet.hairlineWidth : 0,
                      paddingBottom: isLastItem ? 32 : (isEndOfThread ? 16 : 8),
                      marginBottom: (isEndOfThread && !isLastItem) ? 12 : 0,
                    },
                    item.parentId ? { marginLeft: 38, paddingTop: 4 } : { paddingTop: 8 }
                  ]}>
                    {item.parentId && (
                      <View style={{
                        position: 'absolute',
                        left: -18,
                        top: -12,
                        width: 16,
                        height: 28,
                        borderBottomLeftRadius: 10,
                        borderLeftWidth: 1.5,
                        borderBottomWidth: 1.5,
                        borderColor: theme.borderColor,
                      }} />
                    )}
                    <Image
                      source={{
                        uri:
                          item.author.profilePicture?.trim() ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(item.author.fullName)}`,
                      }}
                      style={[styles.commentAvatar, { backgroundColor: theme.borderColor, width: item.parentId ? 28 : 32, height: item.parentId ? 28 : 32 }]}
                    />
                    <View style={styles.commentContentWrap}>
                      <View style={styles.commentMetaRow}>
                        <Text style={[styles.commentName, { color: theme.text, fontSize: item.parentId ? 12 : 13 }]}>{item.author.fullName}</Text>
                        <Text style={[styles.commentTime, { color: theme.textSecondary }]}>{formatCommentTime(item.createdAt)}</Text>
                      </View>
                      
                      {parentComment && (
                        <Text style={{ fontSize: 11, color: theme.success, marginBottom: 2, fontWeight: '600' }}>
                          Replying to <Text style={{ color: theme.textSecondary }}>@{parentComment.author.fullName}</Text>
                        </Text>
                      )}

                      <Text style={[styles.commentBody, { color: theme.textSecondary, fontSize: item.parentId ? 12 : 13 }]}>{item.content}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <TouchableOpacity 
                          onPress={() => {
                            setReplyTo(item);
                            setTimeout(() => commentInputRef.current?.focus(), 100);
                          }}
                          style={{ marginRight: 16 }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textSecondary }}>Reply</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                commentsQuery.isLoading ? (
                  <View style={styles.commentsLoadingWrap}>
                    <ActivityIndicator color={theme.success} />
                  </View>
                ) : (
                  <View style={[styles.commentsLoadingWrap, { flex: 1 }]}>
                    <MessageCircle size={44} color={theme.textSecondary} style={{ opacity: 0.2, marginBottom: 16 }} />
                    <Text style={[styles.emptyTitle, { color: theme.text, fontSize: 16, fontWeight: '700' }]}>No comments yet</Text>
                    <Text style={[styles.emptyText, { color: theme.textSecondary, textAlign: 'center', paddingHorizontal: 40 }]}>
                      Be the first one to share your thoughts on this!
                    </Text>
                  </View>
                )
              }
            />

            {replyTo && (
              <View style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingVertical: 8,
                backgroundColor: theme.background,
                borderTopWidth: 1,
                borderTopColor: theme.borderColor
              }}>
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                  Replying to <Text style={{ fontWeight: '700', color: theme.text }}>{replyTo.author.fullName}</Text>
                </Text>
                <TouchableOpacity onPress={() => setReplyTo(null)}>
                  <X size={14} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
            )}

            <View style={[styles.commentComposer, { borderTopColor: theme.borderColor, paddingBottom: modalBottomInset }]}>
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                ref={commentInputRef}
                placeholder={replyTo ? `Replying to ${replyTo.author.fullName}...` : "Write a comment..."}
                placeholderTextColor={theme.textSecondary}
                style={[styles.commentInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                multiline
              />
              <TouchableOpacity
                style={[styles.commentSendBtn, { backgroundColor: theme.success, opacity: addCommentMutation.isPending ? 0.7 : 1 }]}
                disabled={addCommentMutation.isPending}
                onPress={handleSubmitComment}
              >
                {addCommentMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Send size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 28 },
  headerContainer: {
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 15,
    alignItems: 'flex-start',
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 4 },
  headerSubtitle: { fontSize: 13 },
  challengeCard: { borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1 },
  challengeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  challengeIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  challengeTitle: { fontSize: 14, fontWeight: 'bold' },
  challengeSubtitle: { fontSize: 12 },
  challengeStatus: { fontSize: 10, fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  progressBarBg: { height: 6, borderRadius: 3, marginBottom: 8, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  challengeMotivational: { fontSize: 11, fontStyle: 'italic' },
  createPostCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 15 },
  currentUserAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 12, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  textInput: { flex: 1, fontSize: 14, minHeight: 38, maxHeight: 120, paddingTop: 4 },
  composerImageWrap: {
    width: '100%',
    height: 164,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 14,
    position: 'relative',
  },
  composerImagePreview: {
    width: '100%',
    height: '100%',
  },
  composerImageRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerMediaList: {
    paddingVertical: 10,
    gap: 10,
  },
  composerAssetWrap: {
    width: 100,
    height: 100,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    marginRight: 10,
  },
  composerAssetPreview: {
    width: '100%',
    height: '100%',
  },
  composerAssetRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  videoBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
  },
  postActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
  },
  actionButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionButtonText: { fontSize: 12, marginLeft: 6, fontWeight: '600' },
  postButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, minWidth: 68, alignItems: 'center' },
  postButtonText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  composerStageText: { marginTop: 8, fontSize: 12, fontStyle: 'italic' },
  filterListContent: { paddingBottom: 20 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginRight: 10 },
  filterText: { fontSize: 13, fontWeight: '600' },
  adCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  adHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  adIconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  adMeta: { fontSize: 11, fontWeight: '700' },
  adTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  adBody: { fontSize: 13, lineHeight: 19 },
  adImage: { width: '100%', height: 150, borderRadius: 10, marginTop: 10, marginBottom: 10 },
  adCtaButton: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  adCtaText: { fontSize: 13, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 36 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyText: { fontSize: 13, textAlign: 'center' },
  listFooterLoader: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  listFooterSpace: { height: 18 },
  actionSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  actionSheetCard: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  actionSheetGrabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 12,
  },
  actionSheetRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  actionSheetIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionSheetText: {
    fontSize: 15,
    fontWeight: '600',
  },
  actionSheetCancel: {
    marginTop: 12,
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSheetCancelText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalTapCatch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    maxHeight: '85%',
    minHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  editCard: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
  },
  editBody: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
  },
  editInput: {
    minHeight: 120,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  editActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  editCancelBtn: {
    minWidth: 90,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
  editSaveBtn: {
    minWidth: 90,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  editSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  commentsList: { flex: 1 },
  commentsListContent: { paddingHorizontal: 14, paddingBottom: 16 },
  commentRow: {
    flexDirection: 'row',
  },
  commentAvatar: { width: 32, height: 32, borderRadius: 16 },
  commentContentWrap: { flex: 1, marginLeft: 10 },
  commentMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  commentName: { fontSize: 13, fontWeight: '700' },
  commentTime: { fontSize: 11 },
  commentBody: { fontSize: 13, lineHeight: 18 },
  commentsLoadingWrap: { paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  commentComposer: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    maxHeight: 96,
  },
  commentSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  likerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  likerInfo: {
    flex: 1,
  },
  likerName: {
    fontSize: 14,
    fontWeight: '700',
  },
  likerRole: {
    fontSize: 12,
    marginTop: 2,
  },
  likesEmptyWrap: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likesEmptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});

function LikesUserListModal({ visible, onClose, postId, theme }: { 
  visible: boolean; 
  onClose: () => void; 
  postId: string | null;
  theme: any;
}) {
  const { data: likers, isLoading } = useCommunityPostLikes(postId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}>
        <Pressable style={[styles.modalCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={[styles.modalHeader, { borderBottomColor: theme.borderColor }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Likes</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.commentsLoadingWrap}>
              <ActivityIndicator color={theme.tint} />
            </View>
          ) : (
            <FlatList
              data={likers}
              keyExtractor={(item) => item.id}
              style={styles.commentsList}
              contentContainerStyle={styles.commentsListContent}
              renderItem={({ item }) => (
                <View style={[styles.likerRow, { borderBottomColor: theme.borderColor }]}>
                  <Image 
                    source={{ 
                      uri: item.profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.fullName)}&background=random` 
                    }} 
                    style={styles.likerAvatar} 
                  />
                  <View style={styles.likerInfo}>
                    <Text style={[styles.likerName, { color: theme.text }]}>{item.fullName}</Text>
                    <Text style={[styles.likerRole, { color: theme.textSecondary }]}>
                      {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
                    </Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.likesEmptyWrap}>
                  <Text style={[styles.likesEmptyText, { color: theme.textSecondary }]}>
                    No likes yet. Be the first!
                  </Text>
                </View>
              }
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
