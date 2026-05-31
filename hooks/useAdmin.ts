import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { Doctor } from '../src/types';
import { useAuthContext } from '../context/AuthContext';
import type { ImagePickerAsset } from 'expo-image-picker';

export const ADMIN_QUERY_KEYS = {
    stats: ['admin', 'stats'] as const,
    analytics: ['admin', 'analytics'] as const,
    doctors: (page: number, limit: number) => ['admin', 'doctors', page, limit] as const,
    communityAds: ['admin', 'community-ads'] as const,
    communityAdsAnalytics: ['admin', 'community-ads-analytics'] as const,
    revenue: ['admin', 'revenue'] as const,
} as const;

type AdminRevenueSnapshot = {
    appointmentGross: number;
    doctorPayout: number;
    platformCommission: number;
    subscriptionRevenue: number;
    totalRevenue: number;
    doctorRevenue: Array<{ doctorId: string; gross: number; payout: number; commission: number }>;
};

const parseOptionalNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
};

const parseStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
};

const pickValue = (...values: any[]) => {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) return trimmed;
            continue;
        }
        return value;
    }
    return '';
};

const mapDoctorRowToDoctor = (d: any): Doctor => {
    const profile = d?.profiles || {};
    const rawFullName = String(pickValue(d?.name, d?.full_name, d?.fullName) || '').trim();
    const fallbackFirst = rawFullName ? rawFullName.split(' ')[0] : '';
    const fallbackLast = rawFullName
        ? rawFullName.split(' ').slice(1).join(' ').trim()
        : '';

    const firstName =
        String(
            profile?.first_name ??
            d?.first_name ??
            d?.firstName ??
            fallbackFirst
        ).trim() || 'Doctor';

    const lastName = String(
        profile?.last_name ??
        d?.last_name ??
        d?.lastName ??
        fallbackLast
    ).trim();

    const email = String(pickValue(profile?.email, d?.email) || '').trim();
    const phoneNumber = String(pickValue(profile?.phone_number, d?.phone_number, d?.phoneNumber, d?.phone) || '').trim();
    const rawGender = String(pickValue(profile?.gender, d?.gender, d?.sex, 'Other')).trim().toLowerCase();
    const gender: 'Male' | 'Female' | 'Other' =
        rawGender === 'male' ? 'Male' : rawGender === 'female' ? 'Female' : 'Other';

    return {
        id: String(d?.id ?? d?._id ?? ''),
        firstName,
        lastName,
        email,
        phoneNumber,
        city: String(pickValue(d?.city, d?.location_city) || ''),
        specialization: String(pickValue(d?.specialization, d?.speciality, d?.department) || ''),
        experience: String(pickValue(d?.experience, d?.total_experience, d?.yearsOfExperience) || ''),
        fee: String(pickValue(d?.fee, d?.consultation_fee, d?.consultationFee) || ''),
        bio: String(pickValue(d?.bio, d?.about, d?.description) || ''),
        image: String(pickValue(d?.image, d?.profile_picture, profile?.profile_picture) || ''),
        rating: typeof d.rating === 'number' ? d.rating : 0,
        isVerified: d.is_verified || false,
        gender,
        registrationNumber: String(pickValue(d?.registration_number, d?.registrationNumber) || ''),
        kycVerify: d.kyc_verify || false,
        documents: Array.isArray(d.documents) ? d.documents : [],
        degree: String(pickValue(d?.degree, d?.qualification) || ''),
        university: String(pickValue(d?.university, d?.college, d?.institution) || ''),
        yearOfCompletion: parseOptionalNumber(pickValue(d?.year_of_completion, d?.yearOfCompletion)),
        registrationCouncil: String(pickValue(d?.registration_council, d?.registrationCouncil) || ''),
        currentHospitalClinic: String(pickValue(d?.current_hospital_clinic, d?.currentHospitalClinic, d?.hospital) || ''),
        previousWorkDetails: String(pickValue(d?.previous_work_details, d?.previousWorkDetails) || ''),
        areasOfExpertise: parseStringArray(pickValue(d?.areas_of_expertise, d?.areasOfExpertise)),
        languagesSpoken: parseStringArray(pickValue(d?.languages_spoken, d?.languagesSpoken)),
        treatmentApproach: String(pickValue(d?.treatment_approach, d?.treatmentApproach) || ''),
        profileCompletionDone: Boolean(d.profile_completion_done),
        profileCompletionDoneAt: d.profile_completion_done_at || undefined,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
    };
};

export const useAdminStats = () => {
    return useQuery({
        queryKey: ADMIN_QUERY_KEYS.stats,
        queryFn: async () => {
            const [usersRes, doctorsRes, verifiedRes, pendingRes, appointmentsRes] = await Promise.all([
                supabase.from('profiles').select('id', { count: 'exact', head: true }),
                supabase.from('doctors').select('id', { count: 'exact', head: true }),
                supabase.from('doctors').select('id', { count: 'exact', head: true }).eq('is_verified', true),
                supabase.from('doctors').select('id', { count: 'exact', head: true }).eq('is_verified', false),
                supabase.from('appointments').select('id', { count: 'exact', head: true })
            ]);

            return {
                totalUsers: usersRes.count || 0,
                totalDoctors: doctorsRes.count || 0,
                verifiedDoctors: verifiedRes.count || 0,
                pendingDoctors: pendingRes.count || 0,
                totalAppointments: appointmentsRes.count || 0,
                activeUsers: usersRes.count || 0,
            };
        },
    });
};

export const useAdminAnalytics = () => {
    return useQuery({
        queryKey: ADMIN_QUERY_KEYS.analytics,
        queryFn: async () => ({
            revenue: null,
            userGrowth: null,
        }),
    });
};

export const useAdminRevenue = () => {
    return useQuery({
        queryKey: ADMIN_QUERY_KEYS.revenue,
        queryFn: async (): Promise<AdminRevenueSnapshot> => {
            const [{ data: appointmentPayments, error: appointmentError }, { data: subscriptionPayments, error: subError }] = await Promise.all([
                supabase
                    .from('appointment_payments')
                    .select('doctor_id, gross_amount, doctor_share, platform_commission, status')
                    .eq('status', 'paid')
                    .limit(20000),
                supabase
                    .from('subscription_payments')
                    .select('amount, status')
                    .eq('status', 'paid')
                    .limit(20000),
            ]);

            if (appointmentError) throw appointmentError;
            if (subError) throw subError;

            let appointmentGross = 0;
            let doctorPayout = 0;
            let platformCommission = 0;
            const doctorMap = new Map<string, { gross: number; payout: number; commission: number }>();

            (appointmentPayments || []).forEach((row: any) => {
                const doctorId = String(row?.doctor_id || '');
                const gross = Number(row?.gross_amount || 0);
                const payout = Number(row?.doctor_share || 0);
                const commission = Number(row?.platform_commission || 0);
                appointmentGross += gross;
                doctorPayout += payout;
                platformCommission += commission;
                if (!doctorId) return;
                const current = doctorMap.get(doctorId) || { gross: 0, payout: 0, commission: 0 };
                current.gross += gross;
                current.payout += payout;
                current.commission += commission;
                doctorMap.set(doctorId, current);
            });

            const subscriptionRevenue = (subscriptionPayments || []).reduce((sum: number, row: any) => sum + Number(row?.amount || 0), 0);
            return {
                appointmentGross,
                doctorPayout,
                platformCommission,
                subscriptionRevenue,
                totalRevenue: platformCommission + subscriptionRevenue,
                doctorRevenue: Array.from(doctorMap.entries()).map(([doctorId, values]) => ({
                    doctorId,
                    gross: values.gross,
                    payout: values.payout,
                    commission: values.commission,
                })),
            };
        },
        staleTime: 20 * 1000,
    });
};

export type AdminTrendRange = '7d' | '30d' | '12m';

const formatTrendLabel = (date: Date, range: AdminTrendRange): string => {
    if (range === '12m') {
        return date.toLocaleDateString([], { month: 'short' });
    }
    if (range === '30d') {
        return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
    }
    return date.toLocaleDateString([], { weekday: 'short' });
};

const buildReadableLabels = (rawLabels: string[], range: AdminTrendRange): string[] => {
    if (!rawLabels.length) return rawLabels;
    if (range === '12m') return rawLabels;

    const step = range === '30d' ? 5 : 2;
    return rawLabels.map((label, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === rawLabels.length - 1;
        const isStep = idx % step === 0;
        return isFirst || isLast || isStep ? label : '';
    });
};

const getTrendBuckets = (
    range: AdminTrendRange,
    selectedMonth?: string,
): Array<{ key: string; label: string; date: Date }> => {
    const now = new Date();
    if (range === '12m') {
        return Array.from({ length: 12 }, (_, idx) => {
            const date = new Date(now.getFullYear(), now.getMonth() - (11 - idx), 1);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            return { key, label: formatTrendLabel(date, range), date };
        });
    }

    if (range === '30d') {
        let year = now.getFullYear();
        let monthIndex = now.getMonth();
        if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) {
            year = Number(selectedMonth.slice(0, 4));
            monthIndex = Number(selectedMonth.slice(5, 7)) - 1;
        }
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        return Array.from({ length: daysInMonth }, (_, idx) => {
            const date = new Date(year, monthIndex, idx + 1);
            date.setHours(0, 0, 0, 0);
            const key = date.toISOString().slice(0, 10);
            return { key, label: formatTrendLabel(date, range), date };
        });
    }

    const days = 7;
    return Array.from({ length: days }, (_, idx) => {
        const date = new Date(now);
        date.setHours(0, 0, 0, 0);
        date.setDate(now.getDate() - (days - 1 - idx));
        const key = date.toISOString().slice(0, 10);
        return { key, label: formatTrendLabel(date, range), date };
    });
};

const getCreatedAtKey = (value: unknown, range: AdminTrendRange): string | null => {
    if (!value || typeof value !== 'string') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    if (range === '12m') {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    return date.toISOString().slice(0, 10);
};

export const useAdminRegistrationTrends = (range: AdminTrendRange, selectedMonth?: string) => {
    return useQuery({
        queryKey: ['admin', 'registration-trends', range, selectedMonth || ''],
        queryFn: async () => {
            const buckets = getTrendBuckets(range, selectedMonth);
            const rawLabels = buckets.map((bucket) => bucket.label);
            const labels = buildReadableLabels(rawLabels, range);
            const keySet = new Set(buckets.map((bucket) => bucket.key));

            const since = buckets[0]?.date ? new Date(buckets[0].date).toISOString() : undefined;

            const [profilesRes, doctorsRes] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('created_at')
                    .gte('created_at', since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
                supabase
                    .from('doctors')
                    .select('created_at')
                    .gte('created_at', since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
            ]);

            if (profilesRes.error) throw profilesRes.error;
            if (doctorsRes.error) throw doctorsRes.error;

            const usersCountMap = new Map<string, number>();
            const doctorsCountMap = new Map<string, number>();
            buckets.forEach((bucket) => {
                usersCountMap.set(bucket.key, 0);
                doctorsCountMap.set(bucket.key, 0);
            });

            (profilesRes.data || []).forEach((row: any) => {
                const key = getCreatedAtKey(row?.created_at, range);
                if (!key || !keySet.has(key)) return;
                usersCountMap.set(key, Number(usersCountMap.get(key) || 0) + 1);
            });

            (doctorsRes.data || []).forEach((row: any) => {
                const key = getCreatedAtKey(row?.created_at, range);
                if (!key || !keySet.has(key)) return;
                doctorsCountMap.set(key, Number(doctorsCountMap.get(key) || 0) + 1);
            });

            const usersData = buckets.map((bucket) => Number(usersCountMap.get(bucket.key) || 0));
            const doctorsData = buckets.map((bucket) => Number(doctorsCountMap.get(bucket.key) || 0));

            return {
                labels,
                usersData,
                doctorsData,
                usersChart: { labels, datasets: [{ data: usersData }] },
                doctorsChart: { labels, datasets: [{ data: doctorsData }] },
            };
        },
        staleTime: 20 * 1000,
    });
};

export const useDoctors = (page: number, limit: number = 10) => {
    return useQuery({
        queryKey: ADMIN_QUERY_KEYS.doctors(page, limit),
        queryFn: async () => {
            const start = (page - 1) * limit;
            const end = start + limit - 1;

            const { data, count, error } = await supabase
                .from('doctors')
                .select('*, profiles(*)', { count: 'exact' })
                .range(start, end)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const doctors: Doctor[] = (data || []).map((d: any) => mapDoctorRowToDoctor(d));

            return {
                doctors,
                totalPages: Math.ceil((count || 0) / limit),
                currentPage: page,
                totalDoctors: count || 0
            };
        },
        placeholderData: (previousData: any) => previousData,
    });
};

export const useAdminDoctorById = (doctorId?: string) => {
    return useQuery({
        queryKey: ['admin', 'doctor-by-id', doctorId || ''],
        enabled: Boolean(doctorId),
        queryFn: async () => {
            const id = String(doctorId || '').trim();
            if (!id) throw new Error('Missing doctor id');

            const { data, error } = await supabase
                .from('doctors')
                .select('*, profiles(*)')
                .eq('id', id)
                .maybeSingle();

            if (error) throw error;
            if (!data) throw new Error('Doctor not found');
            return mapDoctorRowToDoctor(data);
        },
    });
};

export const useAdminDoctorSearch = (query: string) => {
    const normalizedQuery = (query || '').trim().toLowerCase();
    return useQuery({
        queryKey: ['admin', 'doctor-search', normalizedQuery],
        enabled: normalizedQuery.length >= 3,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('doctors')
                .select('*, profiles(*)')
                .order('created_at', { ascending: false })
                .limit(500);

            if (error) throw error;

            const doctors: Doctor[] = (data || []).map((d: any) => mapDoctorRowToDoctor(d));
            return doctors.filter((doc) => {
                const haystack = [
                    `${doc.firstName || ''} ${doc.lastName || ''}`.trim(),
                    doc.email || '',
                    doc.specialization || '',
                    doc.city || '',
                    doc.phoneNumber || '',
                    doc.registrationNumber || '',
                ]
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(normalizedQuery);
            });
        },
        staleTime: 20 * 1000,
    });
};

export const useVerifyDoctor = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ doctorId, isVerified }: { doctorId: string; isVerified: boolean }) => {
            const { error } = await supabase
                .from('doctors')
                .update({
                    is_verified: isVerified,
                    kyc_verify: isVerified,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', doctorId);

            if (error) throw error;
            return { success: true };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'doctors'] });
            queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.stats });
            queryClient.invalidateQueries({ queryKey: ['doctors'] });
        },
        onError: (error: any) => {
            console.error('Verify Doctor error:', error);
        },
    });
};

const COMMUNITY_MEDIA_BUCKET = 'community-posts';
const AD_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 30;

type AdminCommunityAd = {
    id: string;
    title: string;
    body: string;
    imageUrl: string | null;
    imagePath: string | null;
    ctaLabel: string | null;
    ctaUrl: string | null;
    frequencyInterval: number;
    active: boolean;
    startsAt: string | null;
    endsAt: string | null;
    createdAt: string;
};

type AdminCommunityAdsAnalytics = {
    totalAds: number;
    activeAds: number;
    impressions30d: number;
    clicks30d: number;
    ctr30d: number;
    impressionsTrend: { labels: string[]; datasets: Array<{ data: number[] }> };
    clicksTrend: { labels: string[]; datasets: Array<{ data: number[] }> };
    topAds: Array<{ adId: string; title: string; impressions: number; clicks: number; ctr: number }>;
};

const sanitizeFileName = (value: string): string =>
    value
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

const resolveCommunityMediaPath = (rawValue?: string | null): { path: string | null; directUrl?: string } => {
    const value = (rawValue || '').trim();
    if (!value) return { path: null };
    if (!/^https?:\/\//i.test(value)) return { path: value };

    try {
        const parsed = new URL(value);
        const markers = [
            `/storage/v1/object/public/${COMMUNITY_MEDIA_BUCKET}/`,
            `/storage/v1/object/sign/${COMMUNITY_MEDIA_BUCKET}/`,
            `/storage/v1/object/authenticated/${COMMUNITY_MEDIA_BUCKET}/`,
        ];
        for (const marker of markers) {
            const idx = parsed.pathname.indexOf(marker);
            if (idx >= 0) {
                const encodedPath = parsed.pathname.slice(idx + marker.length);
                if (!encodedPath) break;
                return { path: decodeURIComponent(encodedPath) };
            }
        }
    } catch {
        return { path: null, directUrl: value };
    }

    return { path: null, directUrl: value };
};

const toSignedCommunityMediaUrl = async (rawValue?: string | null): Promise<string | null> => {
    const resolved = resolveCommunityMediaPath(rawValue);
    if (!resolved.path) return resolved.directUrl || null;
    const { data, error } = await supabase.storage
        .from(COMMUNITY_MEDIA_BUCKET)
        .createSignedUrl(resolved.path, AD_IMAGE_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
};

const uploadCommunityAdImage = async (args: {
    userId: string;
    asset: Pick<ImagePickerAsset, 'uri' | 'fileName' | 'mimeType' | 'fileSize'>;
}): Promise<string> => {
    const uri = args.asset?.uri || '';
    if (!uri) throw new Error('Invalid ad image.');

    const mimeType = (args.asset?.mimeType || 'image/jpeg').toLowerCase();
    if (!mimeType.startsWith('image/')) throw new Error('Ad image must be an image file.');

    const extensionFromMime = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
    const safeName = sanitizeFileName(args.asset.fileName || `ad_${Date.now()}.${extensionFromMime}`);
    const filePath = `${args.userId}/ads/${Date.now()}_${safeName}`;

    const response = await fetch(uri);
    const blob = await response.blob();
    const { error } = await supabase.storage.from(COMMUNITY_MEDIA_BUCKET).upload(filePath, blob, {
        contentType: mimeType,
        upsert: false,
        cacheControl: '3600',
    });
    if (error) throw error;
    return filePath;
};

const formatDayLabel = (date: Date) =>
    date.toLocaleDateString([], { weekday: 'short' });

export const useAdminCommunityAds = () => {
    return useQuery({
        queryKey: ADMIN_QUERY_KEYS.communityAds,
        queryFn: async (): Promise<AdminCommunityAd[]> => {
            const { data, error } = await supabase
                .from('community_ads')
                .select('id, title, body, image_url, cta_label, cta_url, frequency_interval, active, starts_at, ends_at, created_at')
                .is('deleted_at', null)
                .order('created_at', { ascending: false })
                .limit(200);

            if (error) throw error;
            const rows = Array.isArray(data) ? data : [];
            return Promise.all(
                rows.map(async (row: any) => ({
                    id: String(row.id),
                    title: typeof row?.title === 'string' ? row.title : '',
                    body: typeof row?.body === 'string' ? row.body : '',
                    imageUrl: await toSignedCommunityMediaUrl(typeof row?.image_url === 'string' ? row.image_url : null),
                    imagePath: typeof row?.image_url === 'string' ? row.image_url : null,
                    ctaLabel: typeof row?.cta_label === 'string' ? row.cta_label : null,
                    ctaUrl: typeof row?.cta_url === 'string' ? row.cta_url : null,
                    frequencyInterval: Math.max(2, Number(row?.frequency_interval || 4)),
                    active: Boolean(row?.active),
                    startsAt: typeof row?.starts_at === 'string' ? row.starts_at : null,
                    endsAt: typeof row?.ends_at === 'string' ? row.ends_at : null,
                    createdAt: typeof row?.created_at === 'string' ? row.created_at : new Date().toISOString(),
                }))
            );
        },
        staleTime: 20 * 1000,
    });
};

export const useCreateCommunityAd = () => {
    const queryClient = useQueryClient();
    const { user } = useAuthContext();

    return useMutation({
        mutationFn: async (payload: {
            title: string;
            body?: string;
            ctaLabel?: string;
            ctaUrl?: string;
            frequencyInterval?: number;
            active?: boolean;
            startsAt?: string | null;
            endsAt?: string | null;
            imagePath?: string | null;
            imageAsset?: Pick<ImagePickerAsset, 'uri' | 'fileName' | 'mimeType' | 'fileSize'> | null;
        }) => {
            if (!user?.id) throw new Error('Please login again as admin.');
            const title = String(payload?.title || '').trim();
            if (!title) throw new Error('Ad title is required.');

            let imagePath = typeof payload?.imagePath === 'string' ? payload.imagePath.trim() : '';
            if (payload?.imageAsset?.uri) {
                imagePath = await uploadCommunityAdImage({
                    userId: user.id,
                    asset: payload.imageAsset,
                });
            }

            const { error } = await supabase.from('community_ads').insert({
                title,
                body: (payload?.body || '').trim() || null,
                image_url: imagePath || null,
                cta_label: (payload?.ctaLabel || '').trim() || null,
                cta_url: (payload?.ctaUrl || '').trim() || null,
                frequency_interval: Math.max(2, Math.min(20, Number(payload?.frequencyInterval || 4))),
                active: Boolean(payload?.active),
                starts_at: payload?.startsAt || null,
                ends_at: payload?.endsAt || null,
                placement: 'community_feed',
                created_by: user.id,
            });
            if (error) throw error;
            return true;
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.communityAds }),
                queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.communityAdsAnalytics }),
                queryClient.invalidateQueries({ queryKey: ['community', 'feed'] }),
            ]);
        },
    });
};

export const useToggleCommunityAdActive = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: { adId: string; active: boolean }) => {
            const { error } = await supabase
                .from('community_ads')
                .update({ active: Boolean(payload.active), updated_at: new Date().toISOString() })
                .eq('id', payload.adId);
            if (error) throw error;
            return true;
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.communityAds }),
                queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEYS.communityAdsAnalytics }),
                queryClient.invalidateQueries({ queryKey: ['community', 'feed'] }),
            ]);
        },
    });
};

export const useAdminCommunityAdsAnalytics = () => {
    return useQuery({
        queryKey: ADMIN_QUERY_KEYS.communityAdsAnalytics,
        queryFn: async (): Promise<AdminCommunityAdsAnalytics> => {
            const now = new Date();
            const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const days7 = Array.from({ length: 7 }, (_, idx) => {
                const date = new Date(now.getTime() - (6 - idx) * 24 * 60 * 60 * 1000);
                return {
                    key: date.toISOString().slice(0, 10),
                    label: formatDayLabel(date),
                };
            });

            const [{ data: adsRows, error: adsError }, { data: eventRows, error: eventsError }] = await Promise.all([
                supabase
                    .from('community_ads')
                    .select('id, title, active, starts_at, ends_at, deleted_at')
                    .is('deleted_at', null),
                supabase
                    .from('community_ad_events')
                    .select('ad_id, event_type, created_at')
                    .gte('created_at', since30)
                    .order('created_at', { ascending: false })
                    .limit(10000),
            ]);

            if (adsError) throw adsError;
            if (eventsError) throw eventsError;

            const ads = Array.isArray(adsRows) ? adsRows : [];
            const events = Array.isArray(eventRows) ? eventRows : [];
            const nowMs = Date.now();
            const activeAds = ads.filter((row: any) => {
                const startsAt = row?.starts_at ? new Date(row.starts_at).getTime() : null;
                const endsAt = row?.ends_at ? new Date(row.ends_at).getTime() : null;
                const validStart = startsAt === null || Number.isNaN(startsAt) || startsAt <= nowMs;
                const validEnd = endsAt === null || Number.isNaN(endsAt) || endsAt >= nowMs;
                return Boolean(row?.active) && validStart && validEnd;
            });

            let impressions = 0;
            let clicks = 0;
            const adMap = new Map<string, { title: string; impressions: number; clicks: number }>();
            ads.forEach((row: any) => {
                adMap.set(String(row.id), {
                    title: typeof row?.title === 'string' ? row.title : 'Sponsored',
                    impressions: 0,
                    clicks: 0,
                });
            });

            const dailyImpressions = new Map<string, number>();
            const dailyClicks = new Map<string, number>();
            days7.forEach((entry) => {
                dailyImpressions.set(entry.key, 0);
                dailyClicks.set(entry.key, 0);
            });

            events.forEach((event: any) => {
                const eventType = String(event?.event_type || '');
                const adId = String(event?.ad_id || '');
                const dayKey = String(event?.created_at || '').slice(0, 10);
                if (eventType === 'impression') {
                    impressions += 1;
                    if (dailyImpressions.has(dayKey)) {
                        dailyImpressions.set(dayKey, Number(dailyImpressions.get(dayKey) || 0) + 1);
                    }
                    const entry = adMap.get(adId);
                    if (entry) entry.impressions += 1;
                } else if (eventType === 'click') {
                    clicks += 1;
                    if (dailyClicks.has(dayKey)) {
                        dailyClicks.set(dayKey, Number(dailyClicks.get(dayKey) || 0) + 1);
                    }
                    const entry = adMap.get(adId);
                    if (entry) entry.clicks += 1;
                }
            });

            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const topAds = Array.from(adMap.entries())
                .map(([adId, entry]) => ({
                    adId,
                    title: entry.title,
                    impressions: entry.impressions,
                    clicks: entry.clicks,
                    ctr: entry.impressions > 0 ? (entry.clicks / entry.impressions) * 100 : 0,
                }))
                .sort((a, b) => b.impressions - a.impressions)
                .slice(0, 6);

            return {
                totalAds: ads.length,
                activeAds: activeAds.length,
                impressions30d: impressions,
                clicks30d: clicks,
                ctr30d: Number(ctr.toFixed(2)),
                impressionsTrend: {
                    labels: days7.map((item) => item.label),
                    datasets: [{ data: days7.map((item) => Number(dailyImpressions.get(item.key) || 0)) }],
                },
                clicksTrend: {
                    labels: days7.map((item) => item.label),
                    datasets: [{ data: days7.map((item) => Number(dailyClicks.get(item.key) || 0)) }],
                },
                topAds,
            };
        },
        staleTime: 20 * 1000,
    });
};
