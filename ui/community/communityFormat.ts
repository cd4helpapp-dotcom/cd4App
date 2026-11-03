import type { CommunityCategory, CommunityPost } from '../../hooks/useCommunity';
import type { CommunityPostCard } from '../PostCard';

type Translate = (key: any, params?: Record<string, string | number>) => string;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const formatCommunityTime = (iso: string, t: Translate, locale?: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('community.justNow');
  const diffMs = Math.max(0, Date.now() - date.getTime());
  if (diffMs < MINUTE_MS) return t('community.justNow');
  if (diffMs < HOUR_MS) return t('community.minutesAgo', { count: Math.floor(diffMs / MINUTE_MS) });
  if (diffMs < DAY_MS) return t('community.hoursAgo', { count: Math.floor(diffMs / HOUR_MS) });
  if (diffMs < 7 * DAY_MS) return t('community.daysAgo', { count: Math.floor(diffMs / DAY_MS) });
  const resolvedLocale = locale === 'hi' ? 'hi-IN' : locale ? (locale.includes('-') ? locale : `${locale}-IN`) : undefined;
  return date.toLocaleDateString(resolvedLocale, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const communityCategoryLabel = (category: CommunityCategory, t: Translate): string => {
  if (category === 'success_stories') return t('community.catStory');
  if (category === 'challenges') return t('community.catChallenge');
  if (category === 'mentor_tips') return t('community.catTip');
  return t('community.catGeneral');
};

// The same post object gives the same card object, so a card only re-renders when its own post changes.
const cardCache = new WeakMap<CommunityPost, CommunityPostCard>();

export const toPostCard = (post: CommunityPost): CommunityPostCard => {
  const cached = cardCache.get(post);
  if (cached) return cached;
  const card: CommunityPostCard = {
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
    followedByMe: post.followedByMe,
    media: post.media,
    author: {
      id: post.author.id,
      name: post.author.fullName,
      avatar: post.author.profilePicture,
      role: post.author.role,
      isVerified: post.author.isVerified,
    },
  };
  cardCache.set(post, card);
  return card;
};
