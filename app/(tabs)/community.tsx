import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  useColorScheme,
  Image,
  Pressable,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Share,
  Linking,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Camera,
  X,
  Megaphone,
  Share2,
  EyeOff,
  Pencil,
  Trash2,
  Flag,
  UserX,
  VolumeX,
} from 'lucide-react-native';
import PostCard, { CommunityPostCard } from '../../ui/PostCard';
import CommunityAvatar from '../../ui/community/CommunityAvatar';
import CommentsSheet from '../../ui/community/CommentsSheet';
import CommunityComposer from '../../ui/community/CommunityComposer';
import { toPostCard } from '../../ui/community/communityFormat';
import Colors from '../../constants/Colors';
import { CommunityTabSkeleton } from '../../ui/common/TabLoadingSkeletons';
import {
  CommunityAd,
  CommunityCategory,
  CommunityPost,
  hydrateCommunityFeedFromDisk,
  useBlockCommunityUser,
  useCommunityFeed,
  useDeleteCommunityPost,
  useEditCommunityPost,
  useMuteCommunityKeyword,
  useReportCommunityPost,
  useTrackCommunityAdEvent,
  useToggleCommunityLike,
  useTrackCommunityShare,
  useCommunityPostLikes,
} from '../../hooks/useCommunity';
import { useToggleCommunityFollow } from '../../hooks/useCommunityFollow';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { confirmAction } from '../../src/utils/confirm';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { useAuthContext } from '../../context/AuthContext';
import { useDeferredFocusSync } from '../../hooks/useDeferredFocusSync';

type FeedFilter = 'all' | CommunityCategory;
type FeedItem = { type: 'post'; id: string; post: CommunityPost } | { type: 'ad'; id: string; ad: CommunityAd };

const FEED_FILTERS: Array<{ labelKey: 'community.filterAll' | 'community.filterStories' | 'community.filterChallenges' | 'community.filterTips'; value: FeedFilter }> = [
  { labelKey: 'community.filterAll', value: 'all' },
  { labelKey: 'community.filterStories', value: 'success_stories' },
  { labelKey: 'community.filterChallenges', value: 'challenges' },
  { labelKey: 'community.filterTips', value: 'mentor_tips' },
];

// The handler stays the same object between renders, so memoised post cards do not re-render when the screen does.
const useStableCallback = <Args extends any[], Result>(handler: (...args: Args) => Result) => {
  const latest = React.useRef(handler);
  latest.current = handler;
  return React.useCallback((...args: Args) => latest.current(...args), []);
};

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
  const { user } = useAuthContext();
  const { t } = useAppLanguage();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [activeFilter, setActiveFilter] = React.useState<FeedFilter>('all');
  const [commentsPostId, setCommentsPostId] = React.useState<string | null>(null);
  const [commentsVisible, setCommentsVisible] = React.useState(false);
  const [isPullRefreshing, setIsPullRefreshing] = React.useState(false);
  const [isTabSwitchLoading, setIsTabSwitchLoading] = React.useState(false);
  // Refs, not state: a tap in progress should block a second tap without re-rendering the feed.
  const pendingLikesRef = React.useRef(new Set<string>());
  const pendingSharesRef = React.useRef(new Set<string>());
  const [hiddenPostIds, setHiddenPostIds] = React.useState<Record<string, true>>({});
  const [postActionsVisible, setPostActionsVisible] = React.useState(false);
  const [postActionsTarget, setPostActionsTarget] = React.useState<CommunityPost | null>(null);
  const [editPostVisible, setEditPostVisible] = React.useState(false);
  const [editPostId, setEditPostId] = React.useState<string | null>(null);
  const [editPostText, setEditPostText] = React.useState('');
  const [editPostAssets, setEditPostAssets] = React.useState<ImagePicker.ImagePickerAsset[]>([]);
  const [likesVisible, setLikesVisible] = React.useState(false);
  const [activeLikesPostId, setActiveLikesPostId] = React.useState<string | null>(null);
  const tabSwipeHandlers = useTabSwipeNavigation('community', {
    disabled: commentsVisible || postActionsVisible || editPostVisible || likesVisible,
  });
  const seenAdImpressionsRef = React.useRef(new Set<string>());
  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 60 }).current;

  const feedQuery = useCommunityFeed(user?.id || null);
  const deletePostMutation = useDeleteCommunityPost(user?.id || null);
  const editPostMutation = useEditCommunityPost(user?.id || null);
  const toggleLikeMutation = useToggleCommunityLike(user?.id || null);
  const reportPostMutation = useReportCommunityPost(user?.id || null);
  const blockUserMutation = useBlockCommunityUser(user?.id || null);
  const muteKeywordMutation = useMuteCommunityKeyword(user?.id || null);
  const trackAdEventMutation = useTrackCommunityAdEvent(user?.id || null);
  const trackShareMutation = useTrackCommunityShare(user?.id || null);
  const toggleFollow = useToggleCommunityFollow(user?.id || null);
  const refetchFeed = feedQuery.refetch;
  const viewerName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

  // Shows the last feed saved on this phone straight away, while the fresh one loads.
  React.useEffect(() => {
    if (user?.id) void hydrateCommunityFeedFromDisk(queryClient, user.id);
  }, [queryClient, user?.id]);

  const showActionError = (error: any) =>
    Toast.show({ type: 'error', text1: t('community.actionFailed'), text2: error?.message || t('community.tryAgain') });

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

  const handleLike = useStableCallback(async (post: CommunityPostCard) => {
    if (pendingLikesRef.current.has(post.id)) return;
    pendingLikesRef.current.add(post.id);
    try {
      await toggleLikeMutation.mutateAsync({ postId: post.id, currentlyLiked: post.likedByMe });
    } catch (error: any) {
      showActionError(error);
    } finally {
      pendingLikesRef.current.delete(post.id);
    }
  });

  const handleFollow = useStableCallback(async (post: CommunityPostCard) => {
    try {
      await toggleFollow(post.author.id, !post.followedByMe);
    } catch (error: any) {
      showActionError(error);
    }
  });

  const handleOpenLikes = useStableCallback((post: CommunityPostCard) => {
    setActiveLikesPostId(post.id);
    setLikesVisible(true);
  });

  const handleOpenComments = useStableCallback((post: CommunityPostCard) => {
    setCommentsPostId(post.id);
    setCommentsVisible(true);
  });

  const openProfile = useStableCallback((authorId: string) => {
    if (!authorId) return;
    setCommentsVisible(false);
    router.push({ pathname: '/user/[id]', params: { id: authorId, source: 'community' } } as any);
  });

  const handleOpenAuthorProfile = useStableCallback((post: CommunityPostCard) => openProfile(post?.author?.id));

  const closeComments = React.useCallback(() => setCommentsVisible(false), []);

  const handleShare = useStableCallback(async (post: CommunityPostCard) => {
    if (pendingSharesRef.current.has(post.id)) return;
    pendingSharesRef.current.add(post.id);
    try {
      const deepLink = `${COMMUNITY_POST_DEEPLINK_PREFIX}/${post.id}`;
      const webLink = `${COMMUNITY_POST_WEB_LINK_PREFIX}/${post.id}`;
      const postPreview = clipShareText(post.content, 220);
      const startedAt = Date.now();

      const result = await Share.share({
        message: `${post.author.name}: ${postPreview}\n\nOpen in the CD4 app:\n${deepLink}\n\n${webLink}`,
      });

      if (result.action === Share.dismissedAction) return;

      // Android share sheet often reports "shared" immediately on dismiss.
      // We treat extremely short sessions (< 700ms) as likely dismissals.
      if (Platform.OS === 'android' && Date.now() - startedAt < 700) return;

      trackShareMutation.mutate({ postId: post.id, platform: 'native' });
    } catch (error: any) {
      showActionError(error);
    } finally {
      pendingSharesRef.current.delete(post.id);
    }
  });

  const handleManualRefresh = React.useCallback(async () => {
    if (isPullRefreshing) return;
    setIsPullRefreshing(true);
    try {
      await refetchFeed();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [isPullRefreshing, refetchFeed]);

  // Opening the tab reloads only when the posts are old, so going back and forth stays instant.
  const isFeedStale = feedQuery.isStale;
  const syncCommunityOnFocus = React.useCallback(async () => {
    if (isFeedStale) await refetchFeed({ cancelRefetch: false });
  }, [isFeedStale, refetchFeed]);
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
        return;
      }
      trackAdEventMutation.mutate({ adId: ad.id, eventType: 'click', source: 'community_feed' });
      await Linking.openURL(ad.ctaUrl);
    } catch {
      showActionError(null);
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
      Toast.show({ type: 'success', text1: t('community.deleted') });
    } catch (error: any) {
      showActionError(error);
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
      Toast.show({ type: 'success', text1: t('community.updated') });
    } catch (error: any) {
      showActionError(error);
    }
  };

  const openPostActions = useStableCallback((post: CommunityPostCard) => {
    const target = posts.find((item) => item.id === post.id);
    if (!target) return;
    setPostActionsTarget(target);
    setPostActionsVisible(true);
  });

  const postActionItems: PostActionItem[] = React.useMemo(() => {
    if (!postActionsTarget) return [];

    const target = postActionsTarget;
    const isOwnPost = target.authorId === user?.id;
    const muteKeyword = deriveMuteKeywordFromPost(target.content);
    const asCard = toPostCard(target);
    const items: PostActionItem[] = [
      {
        key: 'share',
        label: t('community.share'),
        icon: Share2,
        onPress: () => {
          closePostActionsModal();
          void handleShare(asCard);
        },
      },
      {
        key: 'hide',
        label: t('community.hidePost'),
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
        label: t('community.editPost'),
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
        label: t('community.deletePost'),
        icon: Trash2,
        danger: true,
        onPress: () => {
          closePostActionsModal();
          // Alert does nothing in a browser, and this also keeps the wording in one place.
          void confirmAction({
            title: t('community.deleteTitle'),
            message: t('community.deleteMessage'),
            confirmText: t('community.delete'),
            cancelText: t('community.cancel'),
            destructive: true,
          }).then((ok) => {
            if (ok) void handleDeletePost(target.id);
          });
        },
      });
    }

    items.push({
      key: 'report',
      label: t('community.reportPost'),
      icon: Flag,
      danger: true,
      onPress: () => {
        closePostActionsModal();
        reportPostMutation.mutate(
          { postId: target.id, reason: 'abuse', details: 'Reported from community feed.' },
          {
            onSuccess: () => Toast.show({ type: 'success', text1: t('community.reported') }),
            onError: showActionError,
          }
        );
      },
    });

    if (target.authorId && target.authorId !== user?.id) {
      const authorName = target.author.fullName;
      items.push({
        key: 'block-user',
        label: t('community.blockUser', { name: authorName }),
        icon: UserX,
        onPress: () => {
          closePostActionsModal();
          void confirmAction({
            title: t('community.blockTitle', { name: authorName }),
            message: t('community.blockMessage'),
            confirmText: t('community.blockUser', { name: authorName }),
            cancelText: t('community.cancel'),
            destructive: true,
          }).then((ok) => {
            if (!ok) return;
            blockUserMutation.mutate(
              { blockedUserId: target.authorId },
              {
                onSuccess: () => Toast.show({ type: 'success', text1: t('community.blocked') }),
                onError: showActionError,
              }
            );
          });
        },
      });
    }

    if (muteKeyword) {
      items.push({
        key: 'mute-keyword',
        label: t('community.muteWord', { word: muteKeyword }),
        icon: VolumeX,
        onPress: () => {
          closePostActionsModal();
          muteKeywordMutation.mutate(
            { keyword: muteKeyword },
            {
              onSuccess: () => Toast.show({ type: 'success', text1: t('community.muted', { word: muteKeyword }) }),
              onError: showActionError,
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
          <View style={[styles.adIconWrap, { backgroundColor: theme.primarySoft }]}>
            <Megaphone size={16} color={theme.primary} />
          </View>
          <Text style={[styles.adMeta, { color: theme.textSecondary }]}>{t('community.sponsored')}</Text>
        </View>
        <Text style={[styles.adTitle, { color: theme.text }]}>{ad.title}</Text>
        {!!ad.body && <Text style={[styles.adBody, { color: theme.textSecondary }]}>{ad.body}</Text>}
        {ad.imageUrl ? <Image source={{ uri: ad.imageUrl }} style={styles.adImage} /> : null}
        {ad.ctaLabel && ad.ctaUrl ? (
          <TouchableOpacity
            style={[styles.adCtaButton, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}
            onPress={() => handleAdOpen(ad)}
          >
            <Text style={[styles.adCtaText, { color: theme.primary }]}>{ad.ctaLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const headerComponent = React.useMemo(
    () => (
      <View>
        <View style={styles.headerContainer}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>{t('community.title')}</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>{t('community.subtitle')}</Text>
        </View>

        <CommunityComposer userId={user?.id || null} userName={viewerName} userAvatar={user?.profilePicture} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.filterListContent}
        >
          {FEED_FILTERS.map((item) => {
            const selected = activeFilter === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: selected ? theme.buttonPrimary : theme.cardBackground,
                    borderColor: selected ? theme.buttonPrimary : theme.borderColor,
                  },
                ]}
                onPress={() => setActiveFilter(item.value)}
              >
                <Text style={[styles.filterText, { color: selected ? '#FFFFFF' : theme.textSecondary }]}>{t(item.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    ),
    [activeFilter, t, theme, user?.id, user?.profilePicture, viewerName]
  );

  const renderFeedItem = React.useCallback(
    ({ item }: { item: FeedItem }) => {
      if (item.type === 'ad') {
        return renderAdCard(item.ad);
      }
      const canFollow = item.post.author.role === 'doctor' && item.post.authorId !== user?.id;
      return (
        <PostCard
          theme={theme}
          post={toPostCard(item.post)}
          onLongPress={openPostActions}
          onPressMenu={openPostActions}
          onPressLike={handleLike}
          onPressLikeCount={handleOpenLikes}
          onPressComment={handleOpenComments}
          onPressShare={handleShare}
          onPressAuthor={handleOpenAuthorProfile}
          onPressFollow={canFollow ? handleFollow : undefined}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, user?.id]
  );

  return (
    <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={showFeedSkeleton ? [] : feedItems}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={headerComponent}
        renderItem={renderFeedItem}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={
          showFeedSkeleton || feedQuery.isLoading ? (
            <CommunityTabSkeleton theme={theme} />
          ) : feedQuery.isError ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('community.loadFailed')}</Text>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{t('community.loadFailedHint')}</Text>
              <TouchableOpacity style={[styles.retryButton, { backgroundColor: theme.buttonPrimary }]} onPress={() => refetchFeed()} accessibilityRole="button">
                <Text style={styles.retryText}>{t('community.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {activeFilter === 'all' ? t('community.emptyTitle') : t('community.emptyFilter')}
              </Text>
              {activeFilter === 'all' ? (
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{t('community.emptyHint')}</Text>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          showFeedSkeleton ? undefined : feedQuery.isFetchingNextPage ? (
            <View style={styles.listFooterLoader}>
              <ActivityIndicator color={theme.primary} />
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
              <Text style={[styles.actionSheetCancelText, { color: theme.textSecondary }]}>{t('community.cancel')}</Text>
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
              <Text style={[styles.modalTitle, { color: theme.text }]}>{t('community.editPost')}</Text>
              <TouchableOpacity onPress={() => setEditPostVisible(false)}>
                <X size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={[styles.editBody, { paddingBottom: modalBottomInset }]}>
              <TextInput
                value={editPostText}
                onChangeText={setEditPostText}
                placeholder={t('community.editPlaceholder')}
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
                  } catch (error: any) {
                    showActionError(error);
                  }
                }}
              >
                <Camera size={16} color={theme.primary} />
                <Text style={[styles.actionButtonText, { color: theme.textSecondary }]}>
                  {t('community.changeMedia')}
                </Text>
              </TouchableOpacity>

              <View style={styles.editActionsRow}>
                <TouchableOpacity
                  style={[styles.editCancelBtn, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                  onPress={() => setEditPostVisible(false)}
                >
                  <Text style={[styles.editCancelText, { color: theme.textSecondary }]}>{t('community.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editSaveBtn, { backgroundColor: theme.primary, opacity: editPostMutation.isPending ? 0.7 : 1 }]}
                  disabled={editPostMutation.isPending}
                  onPress={handleSaveEditedPost}
                >
                  {editPostMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.editSaveText}>{t('community.save')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CommentsSheet
        postId={commentsPostId}
        visible={commentsVisible}
        viewerId={user?.id || null}
        viewerName={viewerName}
        viewerAvatar={user?.profilePicture}
        onClose={closeComments}
        onOpenAuthor={openProfile}
      />
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
  actionButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionButtonText: { fontSize: 12, marginLeft: 6, fontWeight: '600' },
  filterListContent: { paddingBottom: 14, gap: 8 },
  filterChip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
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
  retryButton: { marginTop: 14, height: 42, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
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
    ...StyleSheet.absoluteFill,
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
  commentsLoadingWrap: { paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
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
  const { t } = useAppLanguage();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalWrap} onPress={onClose}>
        <Pressable style={[styles.modalCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={[styles.modalHeader, { borderBottomColor: theme.borderColor }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('community.likes')}</Text>
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
                  <View style={styles.likerAvatar}>
                    <CommunityAvatar name={item.fullName} uri={item.profilePicture} size={40} />
                  </View>
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
                    {t('community.noLikes')}
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
