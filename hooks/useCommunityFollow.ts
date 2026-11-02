import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { patchAuthorFollowInCache } from './useCommunity';

type FollowStats = {
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowing: boolean;
};

export const useCommunityFollowStats = (viewerId?: string | null, profileId?: string | null) =>
  useQuery<FollowStats>({
    queryKey: ['community-follow-stats', viewerId || 'anon', profileId || 'none'],
    enabled: Boolean(profileId),
    queryFn: async () => {
      if (!profileId) {
        return { followersCount: 0, followingCount: 0, postsCount: 0, isFollowing: false };
      }

      const [followersRes, followingRes, postsRes, relationRes] = await Promise.all([
        supabase
          .from('community_follows')
          .select('*', { count: 'exact', head: true })
          .eq('following_id', profileId),
        supabase
          .from('community_follows')
          .select('*', { count: 'exact', head: true })
          .eq('follower_id', profileId),
        supabase
          .from('community_posts')
          .select('*', { count: 'exact', head: true })
          .eq('author_id', profileId)
          .is('deleted_at', null)
          .eq('status', 'published'),
        viewerId
          ? supabase
              .from('community_follows')
              .select('follower_id')
              .eq('follower_id', viewerId)
              .eq('following_id', profileId)
              .limit(1)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (followersRes.error) throw followersRes.error;
      if (followingRes.error) throw followingRes.error;
      if (postsRes.error) throw postsRes.error;
      if (relationRes?.error) throw relationRes.error;

      return {
        followersCount: Number(followersRes.count || 0),
        followingCount: Number(followingRes.count || 0),
        postsCount: Number(postsRes.count || 0),
        isFollowing: Array.isArray(relationRes?.data) && relationRes.data.length > 0,
      };
    },
  });

const statsKey = (viewerId?: string | null, profileId?: string | null) => ['community-follow-stats', viewerId || 'anon', profileId || 'none'];

// A second tap while a follow is still being saved is ignored, per person.
const followsInFlight = new Set<string>();

export const useToggleCommunityFollow = (viewerId?: string | null) => {
  const queryClient = useQueryClient();

  const apply = (authorId: string, following: boolean) => {
    patchAuthorFollowInCache(queryClient, authorId, following);
    queryClient.setQueryData<FollowStats>(statsKey(viewerId, authorId), (stats) =>
      stats && stats.isFollowing !== following
        ? { ...stats, isFollowing: following, followersCount: Math.max(0, stats.followersCount + (following ? 1 : -1)) }
        : stats
    );
  };

  const mutation = useMutation({
    mutationFn: async ({ authorId, follow }: { authorId: string; follow: boolean }) => {
      if (!viewerId || viewerId === authorId) return;

      if (follow) {
        const { error } = await supabase.from('community_follows').insert({
          follower_id: viewerId,
          following_id: authorId,
        });
        // Already following from another device: that is the state the person asked for.
        if (error && (error as any).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('community_follows')
          .delete()
          .eq('follower_id', viewerId)
          .eq('following_id', authorId);
        if (error) throw error;
      }
    },
    onMutate: ({ authorId, follow }) => apply(authorId, follow),
    onError: (_error, { authorId, follow }) => apply(authorId, !follow),
    onSettled: (_data, _error, { authorId }) => {
      followsInFlight.delete(`${viewerId}:${authorId}`);
      queryClient.invalidateQueries({ queryKey: statsKey(viewerId, authorId) });
    },
  });

  return (authorId: string, follow: boolean): Promise<void> => {
    const key = `${viewerId}:${authorId}`;
    if (followsInFlight.has(key)) return Promise.resolve();
    followsInFlight.add(key);
    return mutation.mutateAsync({ authorId, follow });
  };
};
