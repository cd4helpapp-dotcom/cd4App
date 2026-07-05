import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';
import React, { useEffect } from 'react';
import { AppNotification } from '../src/types';

const getNotificationDedupeKey = (notification: AppNotification): string => {
    const appointmentId =
        typeof notification.data?.appointmentId === 'string'
            ? notification.data.appointmentId
            : typeof notification.data?.appointment_id === 'string'
                ? notification.data.appointment_id
                : '';

    if (notification.type === 'appointment_update' && appointmentId) {
        return `appointment:${notification.user_id}:${appointmentId}:${notification.title}`;
    }

    return `id:${notification.id}`;
};

const dedupeNotifications = (notifications: AppNotification[]): AppNotification[] => {
    const seen = new Set<string>();
    return notifications.filter((notification) => {
        const key = getNotificationDedupeKey(notification);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const useNotificationsSystem = () => {
    const { user, isAuthenticated } = useAuthContext();
    const queryClient = useQueryClient();
    const userId = user?.id;
    const [enabled, setEnabled] = React.useState(false);

    React.useEffect(() => {
        if (!userId || !isAuthenticated) {
            setEnabled(false);
            return;
        }

        const timer = setTimeout(() => setEnabled(true), 1200);
        return () => clearTimeout(timer);
    }, [userId, isAuthenticated]);

    const queryKey = ['notifications', userId];
    const unreadCountQueryKey = ['notifications-unread-count', userId];

    const { data: notifications = [], isLoading, refetch } = useQuery<AppNotification[]>({
        queryKey,
        queryFn: async () => {
            if (!userId) return [];
            const { data, error } = await supabase
                .from('in_app_notifications')
                .select('*')
                .eq('user_id', userId)
                .eq('is_read', false)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;
            return dedupeNotifications(data as AppNotification[]);
        },
        enabled: !!userId && isAuthenticated && enabled,
        staleTime: 1000 * 60, // 1 minute
    });

    const { data: unreadCount = 0 } = useQuery<number>({
        queryKey: unreadCountQueryKey,
        queryFn: async () => {
            if (!userId) return 0;
            const { data, error } = await supabase
                .from('in_app_notifications')
                .select('*')
                .eq('user_id', userId)
                .eq('is_read', false)
                .order('created_at', { ascending: false })
                .limit(200);

            if (error) throw error;
            return dedupeNotifications(data as AppNotification[]).length;
        },
        enabled: !!userId && isAuthenticated && enabled,
        staleTime: 1000 * 30, // 30 seconds
    });

    const markAsRead = useMutation({
        mutationFn: async (notificationId: string) => {
            if (!userId) return;
            const { error } = await supabase
                .from('in_app_notifications')
                .update({ is_read: true })
                .eq('id', notificationId)
                .eq('user_id', userId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
        },
    });

    const markAllAsRead = useMutation({
        mutationFn: async () => {
            if (!userId) return;
            const { error } = await supabase
                .from('in_app_notifications')
                .update({ is_read: true })
                .eq('user_id', userId)
                .eq('is_read', false);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
        },
    });

    // Subscriptions for real-time notifications
    useEffect(() => {
        if (!userId || !isAuthenticated) return;

        const channel = supabase
            .channel(`notifications:user_id=eq.${userId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'in_app_notifications',
                    filter: `user_id=eq.${userId}`,
                },
                (payload) => {
                    const incomingNotification = payload.new as AppNotification;
                    const existingNotifications = queryClient.getQueryData<AppNotification[]>(queryKey) || [];
                    const isDuplicate = existingNotifications.some(
                        (notification) => getNotificationDedupeKey(notification) === getNotificationDedupeKey(incomingNotification)
                    );

                    // Update the local cache with the new notification
                    queryClient.setQueryData<AppNotification[]>(queryKey, (old) => {
                        if (!old) return [incomingNotification];
                        if (isDuplicate) return old;
                        return dedupeNotifications([incomingNotification, ...old]);
                    });
                    
                    // Increment the unread count
                    if (!isDuplicate && !incomingNotification.is_read) {
                        queryClient.setQueryData<number>(unreadCountQueryKey, (old) => {
                            return (old ?? 0) + 1;
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userId, isAuthenticated, queryClient]);

    return {
        notifications,
        unreadCount,
        isLoading,
        refetch,
        markAsRead: markAsRead.mutateAsync,
        markAllAsRead: markAllAsRead.mutateAsync,
        isMarkingRead: markAsRead.isPending,
        isMarkingAllRead: markAllAsRead.isPending,
    };
};
