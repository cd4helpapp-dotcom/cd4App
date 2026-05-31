import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from '../src/lib/supabase';
import { normalizeStorageObjectPath, resolveStorageSignedUrlsByPath } from '../src/utils/storageSignedUrl';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';

export type CommunityCategory = 'general' | 'success_stories' | 'challenges' | 'mentor_tips';

export type CommunityPost = {
  id: string;
  authorId: string;
  content: string;
  imageUrl: string | null;
  category: CommunityCategory;
  status: 'published' | 'pending_review' | 'hidden' | 'rejected';
  moderationReason: string | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  isPinned: boolean;
  createdAt: string;
  likedByMe: boolean;
  author: {
    id: string;
    fullName: string;
    profilePicture: string | null;
    role: 'doctor' | 'patient' | 'admin' | 'unknown';
    isVerified: boolean;
  };
  media?: { url: string; type: 'image' | 'video'; thumbnail?: string }[];
};

export type CommunityComment = {
  id: string;
  postId: string;
  authorId: string;
  parentId?: string | null;
  content: string;
  createdAt: string;
  author: {
    id: string;
    fullName: string;
    profilePicture: string | null;
    role: 'doctor' | 'patient' | 'admin' | 'unknown';
    isVerified: boolean;
  };
};

export type CommunityAd = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  frequencyInterval: number;
  startsAt: string | null;
  endsAt: string | null;
};

export type CommunityMediaAssetInput = Pick<ImagePickerAsset, 'uri' | 'fileName' | 'mimeType' | 'fileSize'>;

const COMMUNITY_QUERY_KEYS_ROOT = ['community'] as const;

export const COMMUNITY_QUERY_KEYS = {
  feed: (userId: string | null) => [...COMMUNITY_QUERY_KEYS_ROOT, 'feed', userId || 'anon'] as const,
  comments: (postId: string | null) => [...COMMUNITY_QUERY_KEYS_ROOT, 'comments', postId || 'none'] as const,
  likes: (postId: string | null) => [...COMMUNITY_QUERY_KEYS_ROOT, 'post-likes', postId || 'none'] as const,
  post: (postId: string | null, userId: string | null) => [...COMMUNITY_QUERY_KEYS_ROOT, 'post', postId || 'none', userId || 'anon'] as const,
};

const FEED_PAGE_SIZE = 15;
const COMMUNITY_MEDIA_BUCKET = 'community-posts';
const COMMUNITY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const COMMUNITY_COMMENTS_REALTIME_DEBOUNCE_MS = 180;
const COMMUNITY_MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 30;
const COMMUNITY_MEDIA_SIGNED_URL_RENEW_BUFFER_MS = 60 * 1000;
const PROFILE_IMAGE_BUCKET = SUPABASE_PROFILE_MEDIA_BUCKET;
const PROFILE_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
const communitySignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const clipText = (value: string, maxLength: number): string => {
  const text = (value || '').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitizeFileName = (value: string): string =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const resolveCommunityMediaPath = (rawValue: unknown): { path: string | null; directUrl?: string } => {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return { path: null };
  if (value.startsWith('file://') || value.startsWith('content://')) {
    return { path: null, directUrl: value };
  }
  if (!/^https?:\/\//i.test(value)) {
    return { path: value };
  }

  try {
    const parsed = new URL(value);
    const markers = [
      `/storage/v1/object/public/${COMMUNITY_MEDIA_BUCKET}/`,
      `/storage/v1/object/sign/${COMMUNITY_MEDIA_BUCKET}/`,
      `/storage/v1/object/authenticated/${COMMUNITY_MEDIA_BUCKET}/`,
    ];
    for (const marker of markers) {
      const index = parsed.pathname.indexOf(marker);
      if (index >= 0) {
        const encodedPath = parsed.pathname.slice(index + marker.length);
        if (!encodedPath) break;
        return { path: decodeURIComponent(encodedPath) };
      }
    }
  } catch {
    return { path: null, directUrl: value };
  }

  return { path: null, directUrl: value };
};

const getCommunityMediaAccessUrl = async (rawValue: unknown): Promise<string | null> => {
  const resolved = resolveCommunityMediaPath(rawValue);
  if (!resolved.path) return resolved.directUrl || null;

  const now = Date.now();
  const cached = communitySignedUrlCache.get(resolved.path);
  if (cached && cached.expiresAt - COMMUNITY_MEDIA_SIGNED_URL_RENEW_BUFFER_MS > now) {
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .createSignedUrl(resolved.path, COMMUNITY_MEDIA_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return null;
  }

  const expiresAt = now + COMMUNITY_MEDIA_SIGNED_URL_TTL_SECONDS * 1000;
  communitySignedUrlCache.set(resolved.path, { url: data.signedUrl, expiresAt });
  return data.signedUrl;
};

const toReadableCommunityCreateError = (error: any): string => {
  const message = typeof error?.message === 'string' ? error.message.trim() : String(error || '').trim();
  if (!message) return 'Could not publish post right now.';
  const normalized = message.toLowerCase();
  if (normalized.includes('network request failed') || normalized.includes('network error')) {
    return 'Network issue while uploading image. Please retry.';
  }
  if (normalized.includes('bucket') && normalized.includes('not found')) {
    return 'Community media bucket is missing. Please run latest migration.';
  }
  if (normalized.includes('temporarily busy') || normalized.includes('scanner is busy')) {
    return 'Image scanner is temporarily busy. Please retry in a minute.';
  }
  return message;
};

const extractEdgeFunctionErrorMessage = async (error: any): Promise<string> => {
  const fallback =
    typeof error?.message === 'string' && error.message.trim().length > 0
      ? error.message.trim()
      : 'Community image moderation failed.';

  const response = (error as any)?.context as Response | undefined;
  if (!response) return fallback;

  try {
    const payload = await response.clone().json();
    if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
  } catch {
    try {
      const text = await response.clone().text();
      if (text?.trim()) return text.trim();
    } catch {
      // no-op
    }
  }
  return fallback;
};

const uploadToCommunityMediaBucket = async (args: {
  userId: string;
  asset: CommunityMediaAssetInput;
}): Promise<{ filePath: string; mimeType: string }> => {
  const { userId, asset } = args;
  const fileUri = asset?.uri || '';
  if (!fileUri) {
    throw new Error('Selected image is invalid.');
  }

  const mimeType = (asset?.mimeType || 'image/jpeg').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw new Error('Only image files are allowed for posts.');
  }

  const extensionFromMime = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
  const safeName = sanitizeFileName(asset?.fileName || `community_${Date.now()}.${extensionFromMime}`);
  const filePath = `${userId}/${Date.now()}_${safeName}`;

  if (Number(asset?.fileSize || 0) > COMMUNITY_IMAGE_MAX_BYTES) {
    throw new Error('Image is too large. Please keep it under 8 MB.');
  }

  const errors: string[] = [];

  try {
    const fileResponse = await fetch(fileUri);
    const fileBlob = await fileResponse.blob();
    if (Number((fileBlob as any)?.size || 0) > COMMUNITY_IMAGE_MAX_BYTES) {
      throw new Error('Image is too large. Please keep it under 8 MB.');
    }
    const { error } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(filePath, fileBlob, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '3600',
    });
    if (error) throw error;
    return { filePath, mimeType };
  } catch (error: any) {
    errors.push(`blob:${error?.message || 'failed'}`);
  }

  await sleep(120);

  try {
    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      name: safeName,
      type: mimeType,
    } as any);
    const { error } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(filePath, formData as any, {
      upsert: false,
    });
    if (error) throw error;
    return { filePath, mimeType };
  } catch (error: any) {
    errors.push(`form:${error?.message || 'failed'}`);
  }

  await sleep(120);

  try {
    const fileResponse = await fetch(fileUri);
    const fileArrayBuffer = await fileResponse.arrayBuffer();
    const fileBytes = new Uint8Array(fileArrayBuffer);
    if (Number(fileBytes.byteLength || 0) > COMMUNITY_IMAGE_MAX_BYTES) {
      throw new Error('Image is too large. Please keep it under 8 MB.');
    }
    const { error } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(filePath, fileBytes, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '3600',
    });
    if (error) throw error;
    return { filePath, mimeType };
  } catch (error: any) {
    errors.push(`bytes:${error?.message || 'failed'}`);
    throw new Error(errors.join(' | '));
  }
};

type CommunityImageModerationResult = {
  allow: boolean;
  reason: string;
  labels: string[];
  confidence: number | null;
  provider: string | null;
  model: string | null;
};

const moderateCommunityImage = async (args: {
  accessToken: string;
  filePath: string;
  mimeType: string;
}): Promise<CommunityImageModerationResult> => {
  const functionsClient = supabase.functions;
  functionsClient.setAuth(args.accessToken);

  const { data, error } = await functionsClient.invoke('moderate-community-image', {
    body: {
      bucket: COMMUNITY_MEDIA_BUCKET,
      filePath: args.filePath,
      mimeType: args.mimeType,
    },
  });

  if (error) {
    throw new Error(await extractEdgeFunctionErrorMessage(error));
  }

  if (!data?.success) {
    throw new Error(
      typeof data?.message === 'string' && data.message.trim() ? data.message.trim() : 'Image moderation failed.'
    );
  }

  const moderation = data?.data || {};
  const labels = Array.isArray(moderation?.labels)
    ? moderation.labels
        .map((value: any) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    allow: Boolean(moderation?.allow),
    reason: typeof moderation?.reason === 'string' ? moderation.reason.trim() : '',
    labels,
    confidence: Number.isFinite(Number(moderation?.confidence)) ? Number(moderation?.confidence) : null,
    provider: typeof moderation?.provider === 'string' ? moderation.provider : null,
    model: typeof moderation?.model === 'string' ? moderation.model : null,
  };
};

const safeDeleteCommunityImage = async (filePath: string | null) => {
  if (!filePath) return;
  try {
    await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).remove([filePath]);
  } catch {
    // no-op
  }
};

export const validateCommunityDraft = (content: string): { valid: boolean; message?: string } => {
  const normalized = normalizeText(content || '');
  if (!normalized || normalized.length < 8) {
    return { valid: false, message: 'Please write at least 8 characters.' };
  }
  if (normalized.length > 1800) {
    return { valid: false, message: 'Post is too long. Keep it under 1800 characters.' };
  }
  return { valid: true };
};

export const validateCommunityComment = (content: string): { valid: boolean; message?: string } => {
  const normalized = normalizeText(content || '');
  if (!normalized || normalized.length < 2) {
    return { valid: false, message: 'Comment is too short.' };
  }
  if (normalized.length > 500) {
    return { valid: false, message: 'Comment is too long. Keep it under 500 characters.' };
  }
  return { valid: true };
};

const resolveRoleSlug = (rolesValue: any): 'doctor' | 'patient' | 'admin' | 'unknown' => {
  const maybeSlug =
    typeof rolesValue === 'string'
      ? rolesValue
      : Array.isArray(rolesValue) && rolesValue.length > 0
      ? rolesValue[0]?.slug
      : rolesValue?.slug;
  const normalized = typeof maybeSlug === 'string' ? maybeSlug.trim().toLowerCase() : '';
  if (normalized === 'doctor' || normalized === 'patient' || normalized === 'admin') {
    return normalized;
  }
  return 'unknown';
};

const formatFullName = (firstName: string | null | undefined, lastName: string | null | undefined): string => {
  const fullName = `${firstName || ''} ${lastName || ''}`.trim();
  return fullName || 'Community Member';
};

const loadAuthorMap = async (authorIds: string[]) => {
  if (authorIds.length === 0) return new Map<string, CommunityPost['author']>();

  const distinctAuthorIds = Array.from(new Set(authorIds.filter(Boolean)));
  const { data, error } = await supabase.rpc('community_get_public_profiles', {
    p_user_ids: distinctAuthorIds,
  });

  if (error) {
    throw error;
  }

  const profilePathToSignedUrl = await resolveStorageSignedUrlsByPath({
    bucket: PROFILE_IMAGE_BUCKET,
    values: (data || []).map((row: any) => row?.profile_picture || ''),
    ttlSeconds: PROFILE_IMAGE_SIGNED_URL_TTL_SECONDS,
  });

  const map = new Map<string, CommunityPost['author']>();
  (data || []).forEach((row: any) => {
    const id = typeof row?.id === 'string' ? row.id : '';
    if (!id) return;
    const rawProfilePicture = row?.profile_picture || null;
    const profilePath = normalizeStorageObjectPath(PROFILE_IMAGE_BUCKET, rawProfilePicture);
    map.set(id, {
      id,
      fullName: formatFullName(row?.first_name, row?.last_name),
      profilePicture: profilePath ? profilePathToSignedUrl.get(profilePath) || rawProfilePicture : rawProfilePicture,
      role: resolveRoleSlug(row?.role_slug),
      isVerified: Boolean(row?.is_verified),
    });
  });

  return map;
};

const mapCommunityPostRowToModel = async (args: {
  row: any;
  authorMap: Map<string, CommunityPost['author']>;
  likedSet: Set<string>;
}): Promise<CommunityPost> => {
  const { row, authorMap, likedSet } = args;
  const authorId = typeof row?.author_id === 'string' ? row.author_id : '';
  const fallbackAuthor: CommunityPost['author'] = {
    id: authorId,
    fullName: 'Community Member',
    profilePicture: null,
    role: 'unknown',
    isVerified: false,
  };

  return {
    id: String(row.id),
    authorId,
    content: typeof row?.body === 'string' ? row.body : '',
    imageUrl: await getCommunityMediaAccessUrl(row?.image_url),
    category:
      row?.category === 'success_stories' || row?.category === 'challenges' || row?.category === 'mentor_tips'
        ? row.category
        : 'general',
    status:
      row?.status === 'pending_review' || row?.status === 'hidden' || row?.status === 'rejected'
        ? row.status
        : 'published',
    moderationReason: typeof row?.moderation_reason === 'string' ? row.moderation_reason : null,
    likeCount: Number(row?.like_count || 0),
    commentCount: Number(row?.comment_count || 0),
    shareCount: Number(row?.share_count || 0),
    isPinned: Boolean(row?.is_pinned),
    createdAt: typeof row?.created_at === 'string' ? row.created_at : new Date().toISOString(),
    likedByMe: likedSet.has(String(row.id)),
    author: authorMap.get(authorId) || fallbackAuthor,
  };
};

type CommunityFeedCursor = {
  createdAt: string;
  id: string;
} | null;

type CommunityFeedPage = {
  posts: CommunityPost[];
  ads: CommunityAd[];
  nextCursor: CommunityFeedCursor;
};

const loadCommunityUserPreferences = async (userId: string): Promise<{
  blockedUserIds: Set<string>;
  mutedKeywords: string[];
}> => {
  const [{ data: blockRows, error: blockError }, { data: muteRows, error: muteError }] = await Promise.all([
    supabase.from('community_user_blocks').select('blocked_user_id').eq('blocker_id', userId),
    supabase.from('community_muted_keywords').select('keyword').eq('user_id', userId),
  ]);

  const blockTableMissing =
    String((blockError as any)?.code || '').trim() === '42P01' ||
    String((blockError as any)?.message || '').toLowerCase().includes('does not exist');
  const muteTableMissing =
    String((muteError as any)?.code || '').trim() === '42P01' ||
    String((muteError as any)?.message || '').toLowerCase().includes('does not exist');

  if (blockError && !blockTableMissing) throw blockError;
  if (muteError && !muteTableMissing) throw muteError;

  const blockedUserIds = new Set<string>(
    ((blockTableMissing ? [] : blockRows) || [])
      .map((row: any) => (typeof row?.blocked_user_id === 'string' ? row.blocked_user_id : ''))
      .filter(Boolean)
  );
  const mutedKeywords = ((muteTableMissing ? [] : muteRows) || [])
    .map((row: any) => (typeof row?.keyword === 'string' ? row.keyword.trim().toLowerCase() : ''))
    .filter((keyword: string) => keyword.length >= 2)
    .slice(0, 40);

  return { blockedUserIds, mutedKeywords };
};

const fetchActiveCommunityAds = async (): Promise<CommunityAd[]> => {
  const { data: adRows, error: adError } = await supabase
    .from('community_ads')
    .select('id, title, body, image_url, cta_label, cta_url, frequency_interval, starts_at, ends_at, active')
    .eq('active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(12);

  if (adError) {
    throw adError;
  }

  const now = Date.now();
  const validRows = (adRows || []).filter((row: any) => {
      const startsAt = row?.starts_at ? new Date(row.starts_at).getTime() : null;
      const endsAt = row?.ends_at ? new Date(row.ends_at).getTime() : null;
      const validStart = startsAt === null || Number.isNaN(startsAt) || startsAt <= now;
      const validEnd = endsAt === null || Number.isNaN(endsAt) || endsAt >= now;
      return validStart && validEnd;
    });

  return Promise.all(
    validRows.map(async (row: any) => ({
      id: String(row.id),
      title: typeof row?.title === 'string' ? row.title : 'Sponsored',
      body: typeof row?.body === 'string' ? row.body : '',
      imageUrl: await getCommunityMediaAccessUrl(row?.image_url),
      ctaLabel: typeof row?.cta_label === 'string' ? row.cta_label : null,
      ctaUrl: typeof row?.cta_url === 'string' ? row.cta_url : null,
      frequencyInterval: Math.max(2, Number(row?.frequency_interval || 4)),
      startsAt: typeof row?.starts_at === 'string' ? row.starts_at : null,
      endsAt: typeof row?.ends_at === 'string' ? row.ends_at : null,
    }))
  );
};

const fetchCommunityFeedPage = async (userId: string, cursor: CommunityFeedCursor): Promise<CommunityFeedPage> => {
  const isFirstPage = !cursor;
  const { blockedUserIds, mutedKeywords } = await loadCommunityUserPreferences(userId);

  let regularQuery = supabase
    .from('community_posts')
    .select(
      'id, author_id, body, image_url, category, status, moderation_reason, like_count, comment_count, share_count, is_pinned, created_at'
    )
    .is('deleted_at', null)
    .eq('status', 'published')
    .eq('is_pinned', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(FEED_PAGE_SIZE);

  if (cursor?.createdAt) {
    regularQuery = regularQuery.lt('created_at', cursor.createdAt);
  }

  const [regularResult, pinnedResult] = await Promise.all([
    regularQuery,
    isFirstPage
      ? supabase
          .from('community_posts')
          .select(
            'id, author_id, body, image_url, category, status, moderation_reason, like_count, comment_count, share_count, is_pinned, created_at'
          )
          .is('deleted_at', null)
          .eq('status', 'published')
          .eq('is_pinned', true)
          .order('created_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (regularResult.error) throw regularResult.error;
  if ((pinnedResult as any)?.error) throw (pinnedResult as any).error;

  const pinnedRows = Array.isArray((pinnedResult as any)?.data) ? (pinnedResult as any).data : [];
  const regularRows = Array.isArray(regularResult.data) ? regularResult.data : [];
  const nextCursor =
    regularRows.length < FEED_PAGE_SIZE
      ? null
      : {
          createdAt: String(regularRows[regularRows.length - 1]?.created_at || ''),
          id: String(regularRows[regularRows.length - 1]?.id || ''),
        };

  const combinedRows = [...pinnedRows, ...regularRows].filter((row: any) => {
    const authorId = typeof row?.author_id === 'string' ? row.author_id : '';
    if (authorId && blockedUserIds.has(authorId)) return false;
    const body = typeof row?.body === 'string' ? row.body.toLowerCase() : '';
    if (!body || mutedKeywords.length === 0) return true;
    return !mutedKeywords.some((keyword) => body.includes(keyword));
  });

  const authorIds = Array.from(
    new Set(combinedRows.map((row: any) => (typeof row?.author_id === 'string' ? row.author_id : '')).filter(Boolean))
  );

  const authorMap = await loadAuthorMap(authorIds);

  const postIds = combinedRows
    .map((row: any) => row.id)
    .filter((id: unknown): id is string => typeof id === 'string');
  const likedSet = new Set<string>();
  if (postIds.length > 0) {
    const { data: likeRows, error: likeError } = await supabase
      .from('community_post_likes')
      .select('post_id')
      .eq('user_id', userId)
      .in('post_id', postIds);

    if (likeError) {
      throw likeError;
    }

    (likeRows || []).forEach((row: any) => {
      if (typeof row?.post_id === 'string') likedSet.add(row.post_id);
    });
  }

  const posts: CommunityPost[] = await Promise.all(
    combinedRows.map((row: any) =>
      mapCommunityPostRowToModel({
        row,
        authorMap,
        likedSet,
      })
    )
  );

  const ads = isFirstPage ? await fetchActiveCommunityAds() : [];
  return { posts, ads, nextCursor };
};

const fetchPostComments = async (postId: string): Promise<CommunityComment[]> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const activeUserId = session?.user?.id || null;
  const preferences = activeUserId ? await loadCommunityUserPreferences(activeUserId) : null;

  const { data: commentRows, error: commentError } = await supabase
    .from('community_post_comments')
    .select('id, post_id, author_id, parent_id, content, created_at')
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  if (commentError) {
    throw commentError;
  }

  const rows = (Array.isArray(commentRows) ? commentRows : []).filter((row: any) => {
    if (!preferences) return true;
    const authorId = typeof row?.author_id === 'string' ? row.author_id : '';
    if (authorId && preferences.blockedUserIds.has(authorId)) return false;
    const body = typeof row?.content === 'string' ? row.content.toLowerCase() : '';
    if (!body || preferences.mutedKeywords.length === 0) return true;
    return !preferences.mutedKeywords.some((keyword) => body.includes(keyword));
  });
  const authorIds = Array.from(
    new Set(rows.map((row: any) => (typeof row?.author_id === 'string' ? row.author_id : '')).filter(Boolean))
  );

  const authorMap = await loadAuthorMap(authorIds);

  const flatComments = rows.map((row: any) => {
    const authorId = typeof row?.author_id === 'string' ? row.author_id : '';
    return {
      id: String(row.id),
      postId: String(row.post_id),
      authorId,
      parentId: typeof row?.parent_id === 'string' ? row.parent_id : null,
      content: typeof row?.content === 'string' ? row.content : '',
      createdAt: typeof row?.created_at === 'string' ? row.created_at : new Date().toISOString(),
      author:
        authorMap.get(authorId) || {
          id: authorId,
          fullName: 'Community Member',
          profilePicture: null,
          role: 'unknown',
          isVerified: false,
        },
    };
  });

  return treeSortComments(flatComments);
};

const treeSortComments = (comments: CommunityComment[]): CommunityComment[] => {
  if (comments.length === 0) return [];

  // Group by parentId
  const childrenMap = new Map<string | null, CommunityComment[]>();
  comments.forEach((c) => {
    const pid = c.parentId || null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(c);
  });

  // Sort each group by date
  childrenMap.forEach((list) => {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });

  const result: CommunityComment[] = [];

  const traverse = (parentId: string | null) => {
    const children = childrenMap.get(parentId) || [];
    for (const child of children) {
      result.push(child);
      traverse(child.id);
    }
  };

  traverse(null);
  return result;
};

type CommunityFeedCacheSnapshot = Array<[readonly unknown[], any]>;

const captureFeedCacheSnapshots = (
  queryClient: ReturnType<typeof useQueryClient>
): CommunityFeedCacheSnapshot =>
  queryClient
    .getQueriesData<any>({
      queryKey: ['community', 'feed'],
    })
    .map(([queryKey, cache]) => [queryKey, cache]);

const restoreFeedCacheSnapshots = (
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: CommunityFeedCacheSnapshot | undefined
) => {
  if (!snapshots?.length) return;
  snapshots.forEach(([queryKey, cache]) => {
    queryClient.setQueryData(queryKey, cache);
  });
};

export const patchFeedPostsInCache = (
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string,
  updater: (post: CommunityPost) => CommunityPost
) => {
  const feedQueries = queryClient.getQueriesData<any>({
    queryKey: ['community', 'feed'],
  });

  feedQueries.forEach(([queryKey, cache]) => {
    if (!cache?.pages || !Array.isArray(cache.pages)) return;
    let changed = false;
    const nextPages = cache.pages.map((page: any) => {
      if (!Array.isArray(page?.posts)) return page;
      const nextPosts = page.posts.map((post: CommunityPost) => {
        if (post.id !== postId) return post;
        changed = true;
        return updater(post);
      });
      return { ...page, posts: nextPosts };
    });

    if (changed) {
      queryClient.setQueryData(queryKey, { ...cache, pages: nextPages });
    }
  });
};

const removePostFromFeedCache = (queryClient: ReturnType<typeof useQueryClient>, postId: string) => {
  const feedQueries = queryClient.getQueriesData<any>({
    queryKey: ['community', 'feed'],
  });

  feedQueries.forEach(([queryKey, cache]) => {
    if (!cache?.pages || !Array.isArray(cache.pages)) return;
    let changed = false;
    const nextPages = cache.pages.map((page: any) => {
      if (!Array.isArray(page?.posts)) return page;
      const originalLength = page.posts.length;
      const nextPosts = page.posts.filter((post: CommunityPost) => post.id !== postId);
      if (nextPosts.length !== originalLength) changed = true;
      return { ...page, posts: nextPosts };
    });
    if (changed) {
      queryClient.setQueryData(queryKey, { ...cache, pages: nextPages });
    }
  });
};

const bumpFeedCommentCountCache = (queryClient: ReturnType<typeof useQueryClient>, postId: string, delta: number) => {
  patchFeedPostsInCache(queryClient, postId, (post) => ({
    ...post,
    commentCount: Math.max(0, Number(post.commentCount || 0) + delta),
  }));
};

const fetchCommunityPostById = async (postId: string, userId: string | null): Promise<CommunityPost> => {
  const { data: row, error } = await supabase
    .from('community_posts')
    .select(
      'id, author_id, body, image_url, category, status, moderation_reason, like_count, comment_count, share_count, is_pinned, created_at'
    )
    .eq('id', postId)
    .is('deleted_at', null)
    .single();

  if (error) {
    throw error;
  }

  if (!row || row.status !== 'published') {
    throw new Error('Post is not available.');
  }

  const authorId = typeof row?.author_id === 'string' ? row.author_id : '';
  const authorMap = await loadAuthorMap(authorId ? [authorId] : []);
  const likedSet = new Set<string>();

  if (userId) {
    const { data: likeRow, error: likeError } = await supabase
      .from('community_post_likes')
      .select('post_id')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    if (likeError) {
      throw likeError;
    }
    if (likeRow?.post_id) likedSet.add(String(likeRow.post_id));
  }

  return mapCommunityPostRowToModel({
    row,
    authorMap,
    likedSet,
  });
};

export const useCommunityFeed = (userId: string | null) =>
  useInfiniteQuery({
    queryKey: COMMUNITY_QUERY_KEYS.feed(userId),
    queryFn: ({ pageParam }) => fetchCommunityFeedPage(userId as string, (pageParam as CommunityFeedCursor) || null),
    initialPageParam: null as CommunityFeedCursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
  });

export const useCommunityPost = (postId: string | null, userId: string | null) =>
  useQuery({
    queryKey: COMMUNITY_QUERY_KEYS.post(postId, userId),
    queryFn: () => fetchCommunityPostById(postId as string, userId),
    enabled: Boolean(postId),
    staleTime: 30 * 1000,
  });

export const useCommunityComments = (postId: string | null, enabled: boolean = true) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!postId || !enabled) return;
    let hydrateAuthorTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingAuthorIds = new Set<string>();

    const scheduleAuthorHydration = () => {
      if (hydrateAuthorTimer) return;
      hydrateAuthorTimer = setTimeout(async () => {
        const authorIds = Array.from(pendingAuthorIds).filter(Boolean);
        pendingAuthorIds = new Set<string>();
        hydrateAuthorTimer = null;
        if (authorIds.length === 0) return;

        try {
          const authorMap = await loadAuthorMap(authorIds);
          queryClient.setQueryData<CommunityComment[]>(COMMUNITY_QUERY_KEYS.comments(postId), (previous) => {
            if (!Array.isArray(previous) || previous.length === 0) return previous || [];
            return previous.map((comment) => {
              const hydrated = authorMap.get(comment.authorId);
              return hydrated ? { ...comment, author: hydrated } : comment;
            });
          });
        } catch {
          // no-op
        }
      }, COMMUNITY_COMMENTS_REALTIME_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`community-comments:${postId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'community_post_comments',
          filter: `post_id=eq.${postId}`,
        },
        (payload: any) => {
          const eventType = String(payload?.eventType || '').toUpperCase();
          const nextRow = payload?.new || {};
          const oldRow = payload?.old || {};
          const nextId = typeof nextRow?.id === 'string' ? nextRow.id : null;
          const oldId = typeof oldRow?.id === 'string' ? oldRow.id : null;

          if (eventType === 'INSERT' && nextId) {
            const authorId = typeof nextRow?.author_id === 'string' ? nextRow.author_id : '';
            const newComment: CommunityComment = {
              id: nextId,
              postId: typeof nextRow?.post_id === 'string' ? nextRow.post_id : postId,
              authorId,
              parentId: typeof nextRow?.parent_id === 'string' ? nextRow.parent_id : null,
              content: typeof nextRow?.content === 'string' ? nextRow.content : '',
              createdAt: typeof nextRow?.created_at === 'string' ? nextRow.created_at : new Date().toISOString(),
              author: {
                id: authorId,
                fullName: 'Community Member',
                profilePicture: null,
                role: 'unknown',
                isVerified: false,
              },
            };

            queryClient.setQueryData<CommunityComment[]>(COMMUNITY_QUERY_KEYS.comments(postId), (previous) => {
              const list = Array.isArray(previous) ? previous : [];
              if (list.some((item) => item.id === newComment.id)) return list;
              return treeSortComments([...list, newComment]);
            });
            bumpFeedCommentCountCache(queryClient, postId, 1);
            if (authorId) {
              pendingAuthorIds.add(authorId);
              scheduleAuthorHydration();
            }
            return;
          }

          if (eventType === 'DELETE' && oldId) {
            let removed = false;
            queryClient.setQueryData<CommunityComment[]>(COMMUNITY_QUERY_KEYS.comments(postId), (previous) => {
              const list = Array.isArray(previous) ? previous : [];
              if (!list.some((item) => item.id === oldId)) return list;
              removed = true;
              return list.filter((item) => item.id !== oldId);
            });
            if (removed) {
              bumpFeedCommentCountCache(queryClient, postId, -1);
            }
            return;
          }

          if (eventType === 'UPDATE' && nextId) {
            const updatedContent = typeof nextRow?.content === 'string' ? nextRow.content : null;
            if (updatedContent === null) return;
            queryClient.setQueryData<CommunityComment[]>(COMMUNITY_QUERY_KEYS.comments(postId), (previous) => {
              const list = Array.isArray(previous) ? previous : [];
              if (!list.some((item) => item.id === nextId)) return list;
              return treeSortComments(
                list.map((item) =>
                  item.id === nextId
                    ? {
                        ...item,
                        content: updatedContent,
                        createdAt:
                          typeof nextRow?.created_at === 'string' ? nextRow.created_at : item.createdAt,
                      }
                    : item
                )
              );
            });
          }
        }
      )
      .subscribe();

    return () => {
      if (hydrateAuthorTimer) {
        clearTimeout(hydrateAuthorTimer);
        hydrateAuthorTimer = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [postId, enabled, queryClient]);

  return useQuery({
    queryKey: COMMUNITY_QUERY_KEYS.comments(postId),
    queryFn: () => fetchPostComments(postId as string),
    enabled: Boolean(postId) && enabled,
    staleTime: 15 * 1000,
  });
};

export const useToggleCommunityLike = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { postId: string; currentlyLiked: boolean }) => {
      if (!userId) {
        throw new Error('Please login to like posts.');
      }
      if (!payload.postId) {
        throw new Error('Invalid post id.');
      }

      if (payload.currentlyLiked) {
        const { error } = await supabase
          .from('community_post_likes')
          .delete()
          .eq('post_id', payload.postId)
          .eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('community_post_likes').insert({
          post_id: payload.postId,
          user_id: userId,
        });
        if (error) throw error;
      }

      return true;
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['community', 'feed'] });
      const snapshots = captureFeedCacheSnapshots(queryClient);
      const nextLiked = !payload.currentlyLiked;
      const delta = payload.currentlyLiked ? -1 : 1;
      patchFeedPostsInCache(queryClient, payload.postId, (post) => ({
        ...post,
        likedByMe: nextLiked,
        likeCount: Math.max(0, Number(post.likeCount || 0) + delta),
      }));
      return { snapshots };
    },
    onError: (_error, _payload, context) => {
      restoreFeedCacheSnapshots(queryClient, context?.snapshots);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: COMMUNITY_QUERY_KEYS.feed(userId),
        refetchType: 'none',
      });
    },
  });
};

export const useCommunityPostLikes = (postId: string | null) => {
  return useQuery({
    queryKey: COMMUNITY_QUERY_KEYS.likes(postId),
    queryFn: async () => {
      if (!postId) return [];
      const { data, error } = await supabase.rpc('community_get_post_likers', {
        p_post_id: postId,
      });

      if (error) throw error;
      const profilePathToSignedUrl = await resolveStorageSignedUrlsByPath({
        bucket: PROFILE_IMAGE_BUCKET,
        values: (data || []).map((row: any) => row?.profile_picture || ''),
        ttlSeconds: PROFILE_IMAGE_SIGNED_URL_TTL_SECONDS,
      });
      return (data || []).map((row: any) => {
        const id = typeof row?.id === 'string' ? row.id : '';
        const fullName = formatFullName(row?.first_name, row?.last_name);
        const rawProfilePicture = row?.profile_picture || null;
        const profilePath = normalizeStorageObjectPath(PROFILE_IMAGE_BUCKET, rawProfilePicture);
        return {
          id: id || fullName,
          fullName,
          profilePicture: profilePath ? profilePathToSignedUrl.get(profilePath) || rawProfilePicture : rawProfilePicture,
          role: resolveRoleSlug(row?.role_slug),
          isVerified: Boolean(row?.is_verified),
        };
      });
    },
    enabled: !!postId,
  });
};

export const useAddCommunityComment = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { postId: string; content: string; parentId?: string | null }) => {
      if (!userId) {
        throw new Error('Please login to comment.');
      }
      const validation = validateCommunityComment(payload.content);
      if (!validation.valid) {
        throw new Error(validation.message || 'Comment validation failed.');
      }

      const { error } = await supabase.from('community_post_comments').insert({
        post_id: payload.postId,
        author_id: userId,
        parent_id: payload.parentId || null,
        content: payload.content.trim(),
      });
      if (error) throw error;

      return true;
    },
    onSuccess: async (_, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: COMMUNITY_QUERY_KEYS.feed(userId) }),
        queryClient.invalidateQueries({ queryKey: COMMUNITY_QUERY_KEYS.comments(vars.postId) }),
      ]);
    },
  });
};

export const useReportCommunityPost = (userId: string | null) => {
  return useMutation({
    mutationFn: async (payload: { postId: string; reason?: string; details?: string }) => {
      if (!userId) throw new Error('Please login to report posts.');
      if (!payload?.postId) throw new Error('Invalid post id.');

      const { error } = await supabase.from('community_post_reports').upsert(
        {
          post_id: payload.postId,
          reporter_id: userId,
          reason: (payload.reason || 'other').slice(0, 50),
          details: (payload.details || '').trim().slice(0, 600) || null,
        },
        { onConflict: 'post_id,reporter_id' }
      );
      if (error) throw error;
      return true;
    },
  });
};

export const useBlockCommunityUser = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { blockedUserId: string }) => {
      if (!userId) throw new Error('Please login to block users.');
      const blockedUserId = (payload?.blockedUserId || '').trim();
      if (!blockedUserId || blockedUserId === userId) {
        throw new Error('Invalid user to block.');
      }
      const { error } = await supabase.from('community_user_blocks').insert({
        blocker_id: userId,
        blocked_user_id: blockedUserId,
      });
      if (error) throw error;
      return true;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['community'] });
    },
  });
};

export const useMuteCommunityKeyword = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { keyword: string }) => {
      if (!userId) throw new Error('Please login to mute words.');
      const keyword = normalizeText(payload?.keyword || '').replace(/[^a-z0-9\s-]/gi, '').slice(0, 40);
      if (!keyword || keyword.length < 2) {
        throw new Error('Keyword is too short.');
      }
      const { error } = await supabase.from('community_muted_keywords').upsert(
        {
          user_id: userId,
          keyword,
        },
        { onConflict: 'user_id,keyword' }
      );
      if (error) throw error;
      return { keyword };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['community'] });
    },
  });
};

export const useTrackCommunityAdEvent = (userId: string | null) => {
  return useMutation({
    mutationFn: async (payload: { adId: string; eventType: 'impression' | 'click'; source?: string }) => {
      if (!userId) return false;
      const adId = (payload?.adId || '').trim();
      if (!adId) return false;

      const { error } = await supabase.from('community_ad_events').insert({
        ad_id: adId,
        user_id: userId,
        event_type: payload.eventType,
        source: payload.source || 'community_feed',
      });
      if (error) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('does not exist') || String((error as any)?.code || '') === '42P01') {
          return false;
        }
        if (message.includes('duplicate') || message.includes('unique')) {
          return false;
        }
        throw error;
      }
      return true;
    },
    retry: 0,
  });
};

export const useTrackCommunityShare = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { postId: string; platform?: string }) => {
      if (!userId) {
        throw new Error('Please login to share posts.');
      }

      const { error } = await supabase.from('community_post_shares').insert({
        post_id: payload.postId,
        user_id: userId,
        platform: payload.platform || 'native',
      });
      if (error) throw error;
      return true;
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: COMMUNITY_QUERY_KEYS_ROOT });
      const snapshots = captureFeedCacheSnapshots(queryClient);
      
      patchFeedPostsInCache(queryClient, payload.postId, (post) => ({
        ...post,
        shareCount: Math.max(0, Number(post.shareCount || 0) + 1),
      }));
      
      return { snapshots };
    },
    onError: (_error, _payload, context) => {
      restoreFeedCacheSnapshots(queryClient, context?.snapshots);
    },
    onSettled: async (_result, _error, payload) => {
      // Small delay helps ensure DB trigger has finished processing
      await sleep(400); 
      await queryClient.invalidateQueries({
        queryKey: COMMUNITY_QUERY_KEYS.feed(userId),
        refetchType: 'none',
      });
    },
  });
};

export const useEditCommunityPost = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { 
      postId: string; 
      content: string;
      assets?: CommunityMediaAssetInput[] 
    }) => {
      if (!userId) throw new Error('Please login to edit posts.');
      const postId = (payload?.postId || '').trim();
      if (!postId) throw new Error('Invalid post id.');

      const validation = validateCommunityDraft(payload.content);
      if (!validation.valid) {
        throw new Error(validation.message || 'Post validation failed.');
      }

      // Fetch existing post to handle media cleanup later if needed
      const { data: existingPost, error: fetchError } = await supabase
        .from('community_posts')
        .select('media, image_url')
        .eq('id', postId)
        .single();
      
      if (fetchError) throw fetchError;

      const mediaItems: { url: string; type: 'image' | 'video'; thumbnail?: string }[] = [];
      const uploadedPaths: string[] = [];
      const isUpdatingMedia = payload.assets && payload.assets.length > 0;

      try {
        if (isUpdatingMedia && payload.assets) {
          for (const asset of payload.assets) {
            const isVideo = (asset.mimeType || '').startsWith('video/');
            const fileExt = asset.uri.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
            const path = `${userId}/${fileName}`;

            const formData = new FormData();
            formData.append('file', {
              uri: asset.uri,
              name: fileName,
              type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
            } as any);

            const { error: uploadError } = await supabase.storage
              .from('community-posts')
              .upload(path, formData);

            if (uploadError) throw uploadError;
            uploadedPaths.push(path);

            mediaItems.push({
              url: path,
              type: isVideo ? 'video' : 'image',
            });
          }
        }

        const nextContent = payload.content.trim();
        const updateData: any = { body: nextContent };
        
        if (isUpdatingMedia) {
          updateData.media = mediaItems;
          updateData.image_url = mediaItems.length > 0 ? mediaItems[0].url : null;
          // When media changes, we should ideally re-trigger moderation status, 
          // but for now we follow the same status or reset to pending if needed.
          // Let's assume content update keeps status as is unless we add scan here too.
        }

        const { error: updateError } = await supabase
          .from('community_posts')
          .update(updateData)
          .eq('id', postId)
          .eq('author_id', userId)
          .is('deleted_at', null);

        if (updateError) throw updateError;

        // Cleanup old media if successful replacement
        if (isUpdatingMedia && existingPost?.media) {
          const oldMedia = Array.isArray(existingPost.media) ? existingPost.media : [];
          for (const item of oldMedia) {
            const oldPath = resolveCommunityMediaPath(item.url).path;
            if (oldPath && oldPath.startsWith(`${userId}/`)) {
              await safeDeleteCommunityImage(oldPath);
            }
          }
        }

        return { postId, content: nextContent, media: isUpdatingMedia ? mediaItems : undefined };
      } catch (error: any) {
        // Cleanup new uploads on failure
        for (const path of uploadedPaths) {
          await safeDeleteCommunityImage(path);
        }
        throw new Error(toReadableCommunityCreateError(error));
      }
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['community', 'feed'] });
      const snapshots = captureFeedCacheSnapshots(queryClient);
      patchFeedPostsInCache(queryClient, payload.postId, (post) => ({
        ...post,
        content: payload.content.trim(),
      }));
      return { snapshots };
    },
    onError: (_error, _payload, context) => {
      restoreFeedCacheSnapshots(queryClient, context?.snapshots);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: COMMUNITY_QUERY_KEYS.feed(userId),
        refetchType: 'none',
      });
    },
  });
};

export const useCreateCommunityPost = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { 
      content: string; 
      category: CommunityCategory; 
      assets?: CommunityMediaAssetInput[] 
    }) => {
      if (!userId) {
        throw new Error('Please login to share your updates.');
      }
      if (!payload.content.trim() && (!payload.assets || payload.assets.length === 0)) {
        throw new Error('Post content or media is required.');
      }

      const mediaItems: { url: string; type: 'image' | 'video'; thumbnail?: string }[] = [];
      const uploadedPaths: string[] = [];

      try {
        if (payload.assets && payload.assets.length > 0) {
          for (const asset of payload.assets) {
            const isVideo = (asset.mimeType || '').startsWith('video/');
            const fileExt = asset.uri.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
            const path = `${userId}/${fileName}`;

            const formData = new FormData();
            formData.append('file', {
              uri: asset.uri,
              name: fileName,
              type: asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
            } as any);

            const { error: uploadError } = await supabase.storage
              .from('community-posts')
              .upload(path, formData);

            if (uploadError) throw uploadError;
            uploadedPaths.push(path);

            mediaItems.push({
              url: path,
              type: isVideo ? 'video' : 'image',
            });
          }
        }

        let targetStatus: CommunityPost['status'] = 'published';
        let moderationReason: string | null = null;
        let moderationMeta: any = {};

        // Scan first image for safety if available
        const firstImage = mediaItems.find(m => m.type === 'image');
        if (firstImage) {
          try {
            const scanResult = await scanCommunityImage(firstImage.url);
            if (!scanResult.safe) {
              targetStatus = 'pending_review';
              moderationReason = scanResult.reason || 'Safety scan flagged content';
              moderationMeta = scanResult.meta || {};
            }
          } catch (e) {
            console.warn('Scan failed, defaulting to pending_review', e);
            targetStatus = 'pending_review';
            moderationReason = 'Automatic safety scan failed';
          }
        }

        const { error } = await supabase.from('community_posts').insert({
          author_id: userId,
          body: payload.content,
          image_url: mediaItems.length > 0 ? mediaItems[0].url : null,
          media: mediaItems,
          category: payload.category,
          status: targetStatus,
          moderation_reason: moderationReason,
          moderation_meta: moderationMeta,
        });

        if (error) throw error;
        return { status: targetStatus };
      } catch (error: any) {
        // Cleanup on failure
        for (const path of uploadedPaths) {
          await safeDeleteCommunityImage(path);
        }
        throw new Error(toReadableCommunityCreateError(error));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: COMMUNITY_QUERY_KEYS.feed(userId) });
    },
  });
};

export const useDeleteCommunityPost = (userId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { postId: string }) => {
      if (!userId) throw new Error('Please login to delete posts.');
      const postId = (payload?.postId || '').trim();
      if (!postId) throw new Error('Invalid post id.');

      const { data: postRow, error: postError } = await supabase
        .from('community_posts')
        .select('id, author_id, image_url, deleted_at')
        .eq('id', postId)
        .single();
      if (postError) throw postError;

      if (!postRow || postRow.author_id !== userId) {
        throw new Error('You can only delete your own posts.');
      }

      if (postRow.deleted_at) {
        return { postId };
      }

      const { data: deletedRow, error: deleteError } = await supabase
        .from('community_posts')
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq('id', postId)
        .eq('author_id', userId)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (deleteError) throw deleteError;
      if (!deletedRow?.id) {
        throw new Error('Could not delete this post right now.');
      }

      const imagePath = resolveCommunityMediaPath(postRow.image_url).path;
      if (imagePath && imagePath.startsWith(`${userId}/`)) {
        await safeDeleteCommunityImage(imagePath);
      }

      return { postId };
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['community', 'feed'] });
      const snapshots = captureFeedCacheSnapshots(queryClient);
      removePostFromFeedCache(queryClient, payload.postId);
      return { snapshots };
    },
    onError: (_error, _payload, context) => {
      restoreFeedCacheSnapshots(queryClient, context?.snapshots);
    },
    onSuccess: async (_result, payload) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: COMMUNITY_QUERY_KEYS.feed(userId),
          refetchType: 'none',
        }),
        queryClient.invalidateQueries({
          queryKey: COMMUNITY_QUERY_KEYS.comments(payload.postId),
          refetchType: 'none',
        }),
      ]);
    },
  });
};

const scanCommunityImage = async (filePath: string): Promise<{ safe: boolean; reason?: string; meta?: any }> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) return { safe: true }; 

    const moderation = await moderateCommunityImage({
      accessToken,
      filePath,
      mimeType: 'image/jpeg',
    });

    return {
      safe: moderation.allow,
      reason: moderation.reason,
      meta: {
        labels: moderation.labels,
        confidence: moderation.confidence,
        provider: moderation.provider,
      },
    };
  } catch (error) {
    console.warn('Moderation helper failed:', error);
    return { safe: true }; 
  }
};
