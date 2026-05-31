import { useEffect, useState, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';

export interface PresenceState {
    [key: string]: Array<{
        user_id: string;
        online_at: string;
    }>;
}

export const usePresence = () => {
    const { user } = useAuthContext();
    const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
    const channelRef = useRef<any>(null);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    const updateLastSeen = async () => {
        if (!user) return;
        const { error } = await supabase.rpc('update_last_seen');
        if (error) console.error('Error updating last seen:', error);
    };

    useEffect(() => {
        if (!user) return;

        // 1. Initial last seen update
        updateLastSeen();

        // 2. Setup Presence Channel
        const channel = supabase.channel('online-users', {
            config: {
                presence: {
                    key: user.id,
                },
            },
        });

        channel
            .on('presence', { event: 'sync' }, () => {
                const newState = channel.presenceState();
                const onlineIds = new Set<string>();
                Object.keys(newState).forEach((key) => {
                    onlineIds.add(key);
                });
                setOnlineUsers(onlineIds);
            })
            .on('presence', { event: 'join' }, ({ key }: { key: string }) => {
                setOnlineUsers((prev) => new Set([...prev, key]));
            })
            .on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
                setOnlineUsers((prev) => {
                    const next = new Set(prev);
                    next.delete(key);
                    return next;
                });
            })
            .subscribe(async (status: string) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_id: user.id,
                        online_at: new Date().toISOString(),
                    });
                }
            });

        channelRef.current = channel;

        // 3. Track AppState changes for Last Seen
        const handleAppStateChange = (nextAppState: AppStateStatus) => {
            appStateRef.current = nextAppState;
            if (nextAppState === 'active') {
                updateLastSeen();
                if (channelRef.current) {
                    channelRef.current.track({
                        user_id: user.id,
                        online_at: new Date().toISOString(),
                    });
                }
            } else if (nextAppState === 'background') {
                updateLastSeen();
            }
        };

        const subscription = AppState.addEventListener('change', handleAppStateChange);
        const heartbeatInterval = setInterval(() => {
            if (appStateRef.current !== 'active') return;
            updateLastSeen();
            if (channelRef.current) {
                channelRef.current.track({
                    user_id: user.id,
                    online_at: new Date().toISOString(),
                });
            }
        }, 45_000);

        // 4. Cleanup
        return () => {
            subscription.remove();
            clearInterval(heartbeatInterval);
            if (channelRef.current) {
                channelRef.current.unsubscribe();
            }
        };
    }, [user?.id]);

    const isUserOnline = (userId: string) => onlineUsers.has(userId);

    return { onlineUsers, isUserOnline, updateLastSeen };
};
