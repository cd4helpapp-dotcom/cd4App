import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { Doctor } from '../src/types';
import { useAuthContext } from '../context/AuthContext';
import { normalizeStorageObjectPath, resolveStorageSignedUrlsByPath } from '../src/utils/storageSignedUrl';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';

export const DOCTOR_QUERY_KEYS = {
    all: ['doctors'] as const,
    profile: ['doctor', 'profile'] as const,
};
const PROFILE_MEDIA_BUCKET = SUPABASE_PROFILE_MEDIA_BUCKET;
const PROFILE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

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

const extractNumericValue = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().replace(/,/g, '');
    const match = normalized.match(/-?\d+(\.\d+)?/);
    if (!match) {
        return undefined;
    }

    const numeric = Number(match[0]);
    return Number.isFinite(numeric) ? numeric : undefined;
};

const normalizeDoctorRating = (value: unknown): number => {
    const numeric = extractNumericValue(value);
    if (numeric === undefined || numeric < 0 || numeric > 5) {
        return 0;
    }

    return Math.round(numeric * 10) / 10;
};

const formatFeeNumber = (value: number): string => {
    if (Math.abs(value % 1) < 0.000001) {
        return String(Math.trunc(value));
    }

    return value.toFixed(2).replace(/\.?0+$/, '');
};

const normalizeDoctorFee = (value: unknown): string => {
    if (value === null || value === undefined || value === '') {
        return '';
    }

    const numeric = extractNumericValue(value);
    if (numeric !== undefined) {
        return `₹${formatFeeNumber(numeric)}`;
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    return '';
};

const mapDoctorRow = (row: any): Doctor => ({
    id: row.id,
    _id: row.id,
    firstName: row.profiles?.first_name || row.first_name || '',
    lastName: row.profiles?.last_name || row.last_name || '',
    email: row.profiles?.email || '',
    phoneNumber: row.profiles?.phone_number || '',
    city: row.city || '',
    specialization: row.specialization || '',
    experience: row.experience || '',
    fee: normalizeDoctorFee(row.fee ?? ((extractNumericValue(row.rating) ?? 0) > 5 ? row.rating : '')),
    bio: row.bio || '',
    image: row.image || row.profiles?.profile_picture || row.profile_picture || '',
    rating: normalizeDoctorRating(row.rating),
    isVerified: Boolean(row.is_verified),
    gender: row.profiles?.gender || row.gender || 'Other',
    registrationNumber: row.registration_number || '',
    kycVerify: row.kyc_verify || false,
    documents: Array.isArray(row.documents) ? row.documents : [],
    degree: row.degree || '',
    university: row.university || '',
    yearOfCompletion: parseOptionalNumber(row.year_of_completion),
    registrationCouncil: row.registration_council || '',
    currentHospitalClinic: row.current_hospital_clinic || '',
    previousWorkDetails: row.previous_work_details || '',
    areasOfExpertise: parseStringArray(row.areas_of_expertise),
    languagesSpoken: parseStringArray(row.languages_spoken),
    treatmentApproach: row.treatment_approach || '',
    profileCompletionDone: Boolean(row.profile_completion_done),
    profileCompletionDoneAt: row.profile_completion_done_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const hydrateDoctorProfilePictures = async (rows: any[]): Promise<any[]> => {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const pathToSignedUrl = await resolveStorageSignedUrlsByPath({
        bucket: PROFILE_MEDIA_BUCKET,
        values: rows.map((row) => row?.profiles?.profile_picture || row?.profile_picture || ''),
        ttlSeconds: PROFILE_SIGNED_URL_TTL_SECONDS,
    });

    return rows.map((row) => {
        const rawProfilePicture = row?.profiles?.profile_picture || row?.profile_picture || '';
        const profilePath = normalizeStorageObjectPath(PROFILE_MEDIA_BUCKET, rawProfilePicture);
        const signedProfilePicture = profilePath ? pathToSignedUrl.get(profilePath) || rawProfilePicture : rawProfilePicture;

        if (row?.profiles && typeof row.profiles === 'object') {
            return {
                ...row,
                profiles: {
                    ...row.profiles,
                    profile_picture: signedProfilePicture,
                },
            };
        }

        return {
            ...row,
            profile_picture: signedProfilePicture,
        };
    });
};

export const useDoctors = (_page?: number) => {
    const { session, user } = useAuthContext();

    return useQuery({
        queryKey: [...DOCTOR_QUERY_KEYS.all, (user?.role || 'Guest').toLowerCase()],
        queryFn: async () => {
            const role = (user?.role || '').toLowerCase();
            const isAdmin = role === 'admin';
            const query = isAdmin
                ? supabase
                    .from('doctors')
                    .select('*, profiles(*)')
                    .order('created_at', { ascending: false })
                : supabase
                    .from('doctors_public')
                    .select('id, city, specialization, experience, fee, bio, rating, is_verified, created_at, updated_at, first_name, last_name, profile_picture, gender')
                    .order('created_at', { ascending: false });

            const { data, error } = await query;
            if (error) throw error;

            const hydratedRows = await hydrateDoctorProfilePictures(data ?? []);
            const doctors: Doctor[] = hydratedRows.map(mapDoctorRow);
            return doctors;
        },
        enabled: !!session?.user?.id,
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        placeholderData: (previousData) => previousData ?? [],
    });
};

export const useDoctorProfile = () => {
    const { session } = useAuthContext();

    return useQuery({
        queryKey: DOCTOR_QUERY_KEYS.profile,
        queryFn: async () => {
            if (!session?.user?.id) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('doctors')
                .select('*, profiles(*)')
                .eq('id', session.user.id)
                .single();

            if (error) throw error;

            const [hydratedRow] = await hydrateDoctorProfilePictures([data]);
            const doctor: Doctor = mapDoctorRow(hydratedRow);

            return { success: true, data: doctor };
        },
        enabled: !!session?.user?.id,
    });
};

export const useUpdateDoctorProfile = () => {
    const queryClient = useQueryClient();
    const { session } = useAuthContext();

    return useMutation({
        mutationFn: async (data: Partial<Doctor>) => {
            if (!session?.user?.id) throw new Error('Not authenticated');

            const updates: any = {};
            if (data.city !== undefined) updates.city = data.city;
            if (data.specialization !== undefined) updates.specialization = data.specialization;
            if (data.experience !== undefined) updates.experience = data.experience;
            if (data.fee !== undefined) updates.fee = data.fee;
            if (data.bio !== undefined) updates.bio = data.bio;
            if (data.registrationNumber !== undefined) updates.registration_number = data.registrationNumber;
            if (data.degree !== undefined) updates.degree = data.degree;
            if (data.university !== undefined) updates.university = data.university;
            if (data.yearOfCompletion !== undefined) updates.year_of_completion = data.yearOfCompletion;
            if (data.registrationCouncil !== undefined) updates.registration_council = data.registrationCouncil;
            if (data.currentHospitalClinic !== undefined) updates.current_hospital_clinic = data.currentHospitalClinic;
            if (data.previousWorkDetails !== undefined) updates.previous_work_details = data.previousWorkDetails;
            if (data.areasOfExpertise !== undefined) updates.areas_of_expertise = data.areasOfExpertise;
            if (data.languagesSpoken !== undefined) updates.languages_spoken = data.languagesSpoken;
            if (data.treatmentApproach !== undefined) updates.treatment_approach = data.treatmentApproach;
            if (data.profileCompletionDone !== undefined) updates.profile_completion_done = data.profileCompletionDone;
            if (data.profileCompletionDoneAt !== undefined) updates.profile_completion_done_at = data.profileCompletionDoneAt;

            if (Object.keys(updates).length === 0) {
                throw new Error('No doctor profile fields provided for update.');
            }

            const runUpdate = async () => {
                return await supabase
                    .from('doctors')
                    .update(updates)
                    .eq('id', session.user.id)
                    .select('*, profiles(*)')
                    .maybeSingle();
            };

            let { data: updatedDoctor, error } = await runUpdate();
            if (error) throw error;

            if (!updatedDoctor) {
                const { error: ensureDoctorError } = await supabase.rpc('ensure_doctor_row', {
                    p_user_id: session.user.id,
                });
                if (ensureDoctorError) throw ensureDoctorError;

                const retry = await runUpdate();
                updatedDoctor = retry.data;
                error = retry.error;
                if (error) throw error;
            }

            if (!updatedDoctor) {
                throw new Error('Unable to update doctor profile. Please retry.');
            }

            const [hydratedRow] = await hydrateDoctorProfilePictures([updatedDoctor]);
            return { success: true, data: mapDoctorRow(hydratedRow) };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: DOCTOR_QUERY_KEYS.profile });
            queryClient.invalidateQueries({ queryKey: DOCTOR_QUERY_KEYS.all });
        },
    });
};
