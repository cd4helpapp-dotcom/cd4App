import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';

import Colors from '../../../constants/Colors';
import PostCard, { CommunityPostCard } from '../../../ui/PostCard';
import { useAuthContext } from '../../../context/AuthContext';
import {
  useCommunityComments,
  useCommunityPost,
  useToggleCommunityLike,
  useTrackCommunityShare,
} from '../../../hooks/useCommunity';

const COMMUNITY_POST_DEEPLINK_PREFIX = 'cd4://community/post';
const COMMUNITY_POST_WEB_LINK_PREFIX = 'https://cd4.app/community/post';

const mapPostToCardModel = (post: any): CommunityPostCard => ({
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
  author: {
    id: post.author.id,
    name: post.author.fullName,
    avatar: post.author.profilePicture,
    role: post.author.role,
    isVerified: post.author.isVerified,
  },
});

export default function CommunityPostDeepLinkScreen() {
  const { postId } = useLocalSearchParams<{ postId?: string | string[] }>();
  const normalizedPostId = Array.isArray(postId) ? postId[0] : postId;
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { user } = useAuthContext();

  const postQuery = useCommunityPost(normalizedPostId || null, user?._id || null);
  const commentsQuery = useCommunityComments(normalizedPostId || null, Boolean(normalizedPostId));
  const likeMutation = useToggleCommunityLike(user?._id || null);
  const shareMutation = useTrackCommunityShare(user?._id || null);

  const post = postQuery.data || null;
  const comments = commentsQuery.data || [];

  const handleLike = async () => {
    if (!post) return;
    try {
      await likeMutation.mutateAsync({
        postId: post.id,
        currentlyLiked: post.likedByMe,
      });
    } catch {
      // no-op: keep deep-link screen lightweight
    }
  };

  const handleShare = async () => {
    if (!post) return;
    try {
      const deepLink = `${COMMUNITY_POST_DEEPLINK_PREFIX}/${post.id}`;
      const webLink = `${COMMUNITY_POST_WEB_LINK_PREFIX}/${post.id}`;
      const message = `${post.author.fullName}: ${post.content}\n\nOpen this post in CD4:\n${deepLink}\n${webLink}`;
      const result = await Share.share({ message });
      if (result.action === Share.sharedAction && user?._id) {
        await shareMutation.mutateAsync({ postId: post.id, platform: 'native' });
      }
    } catch {
      // no-op
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderColor }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={20} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Shared Post</Text>
      </View>

      {!normalizedPostId ? (
        <View style={styles.centeredState}>
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>Invalid post link.</Text>
        </View>
      ) : postQuery.isLoading ? (
        <View style={styles.centeredState}>
          <ActivityIndicator color={theme.success} />
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>Loading post...</Text>
        </View>
      ) : postQuery.error || !post ? (
        <View style={styles.centeredState}>
          <Text style={[styles.stateText, { color: theme.textSecondary }]}>This post is not available.</Text>
        </View>
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View>
              <PostCard
                theme={theme}
                post={mapPostToCardModel(post)}
                onPressLike={handleLike}
                onPressComment={() => {}}
                onPressShare={handleShare}
                commentDisabled
              />
              <Text style={[styles.commentHeading, { color: theme.text }]}>Comments</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.commentRow, { borderBottomColor: theme.borderColor }]}>
              <Text style={[styles.commentAuthor, { color: theme.text }]}>{item.author.fullName}</Text>
              <Text style={[styles.commentBody, { color: theme.textSecondary }]}>{item.content}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyCommentWrap}>
              <Text style={[styles.stateText, { color: theme.textSecondary }]}>No comments yet.</Text>
            </View>
          }
          contentContainerStyle={styles.contentContainer}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 52,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginLeft: 8,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  stateText: {
    fontSize: 14,
    textAlign: 'center',
  },
  contentContainer: {
    padding: 14,
    paddingBottom: 32,
  },
  commentHeading: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  commentRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 3,
  },
  commentBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyCommentWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
});
