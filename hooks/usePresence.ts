import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';

const HEARTBEAT_MS = 45_000;
const STATUS_REFRESH_MS = 30_000;
// Two missed heartbeats, so one slow request does not flip someone to offline.
const ONLINE_WINDOW_MS = 100_000;

let isUpdatingLastSeen = false;

const updateLastSeen = async () => {
    if (isUpdatingLastSeen) return;
    isUpdatingLastSeen = true;
    try {
        const { error } = await supabase.rpc('update_last_seen');
        if (error && __DEV__) console.warn('Error updating last seen:', error);
    } finally {
        isUpdatingLastSeen = false;
    }
};

// Mounted once for the whole app, so "last seen" means the last time someone used CD4, not the last time they had a chat open.
export const useLastSeenHeartbeat = () => {
    const { user } = useAuthContext();

    useEffect(() => {
        if (!user?.id) return;

        void updateLastSeen();
        const heartbeat = setInterval(() => {
            if (AppState.currentState === 'active') void updateLastSeen();
        }, HEARTBEAT_MS);
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active' || state === 'background') void updateLastSeen();
        });

        return () => {
            clearInterval(heartbeat);
            subscription.remove();
        };
    }, [user?.id]);
};

export const useOnlineStatus = (userId?: string | null) => {
    const [now, setNow] = useState(() => Date.now());

    const { data: lastSeenAt } = useQuery({
        queryKey: ['last-seen', userId],
        enabled: Boolean(userId),
        refetchInterval: STATUS_REFRESH_MS,
        queryFn: async (): Promise<string | null> => {
            const { data, error } = await supabase.from('profiles').select('last_seen_at').eq('id', userId as string).maybeSingle();
            if (error) throw error;
            return data?.last_seen_at || null;
        },
    });

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), STATUS_REFRESH_MS);
        return () => clearInterval(timer);
    }, []);

    const seenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : NaN;
    return {
        lastSeenAt: lastSeenAt || null,
        isOnline: Number.isFinite(seenMs) && now - seenMs < ONLINE_WINDOW_MS,
    };
};
