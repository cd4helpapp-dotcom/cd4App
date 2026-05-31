import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';

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

export const useToggleCommunityFollow = (viewerId?: string | null, profileId?: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (nextFollow: boolean) => {
      if (!viewerId || !profileId) return;
      if (viewerId === profileId) return;

      if (nextFollow) {
        const { error } = await supabase.from('community_follows').insert({
          follower_id: viewerId,
          following_id: profileId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('community_follows')
          .delete()
          .eq('follower_id', viewerId)
          .eq('following_id', profileId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['community-follow-stats', viewerId || 'anon', profileId || 'none'],
      });
    },
  });
};

