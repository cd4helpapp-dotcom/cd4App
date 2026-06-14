import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';

export const HOSPITAL_QUERY_KEYS = {
    profile: ['hospital', 'profile'] as const,
    doctors: ['hospital', 'doctors'] as const,
    patients: ['hospital', 'patients'] as const,
    voiceIntakes: ['hospital', 'voice-intakes'] as const,
    stats: ['hospital', 'stats'] as const,
} as const;

export type HospitalProfile = {
    id: string;
    status: string;
    registeredName: string;
    displayName?: string;
    facilityType: string;
    website?: string;
    registrationNumber: string;
    registeringAuthority: string;
    registrationExpiry?: string;
    city: string;
    state: string;
    pinCode: string;
    fullAddress: string;
    googleMapsLink?: string;
    authorizedPersonName: string;
    designation: string;
    officialEmail: string;
    mobileNumber: string;
    whatsappNumber?: string;
    appAccountStatus: string;
    specialities: string[];
    facilities: string[];
    opdTimings: string;
    createdAt: string;
};

export type HospitalProfileUpdateInput = {
    displayName?: string;
    website?: string;
    fullAddress: string;
    city: string;
    state: string;
    pinCode: string;
    googleMapsLink?: string;
    authorizedPersonName: string;
    designation: string;
    mobileNumber: string;
    whatsappNumber?: string;
    officialEmail: string;
    specialities: string[];
    facilities: string[];
    opdTimings: string;
};

export type HospitalDoctor = {
    id: string;
    doctorId: string;
    status: string;
    department?: string;
    name: string;
    email: string;
    phoneNumber: string;
    specialization: string;
    city: string;
    registrationNumber: string;
    createdAt: string;
};

export type HospitalPatient = {
    id: string;
    patientId: string;
    doctorId?: string;
    status: string;
    notes?: string;
    patientName: string;
    patientEmail: string;
    patientPhone: string;
    doctorName?: string;
    createdAt: string;
};

export type HospitalVoiceIntake = {
    id: string;
    title: string;
    status: string;
    language: string;
    aiSummary?: string;
    transcript?: string;
    pdfUrl?: string;
    source?: string;
    model?: string;
    patientId?: string;
    doctorId?: string;
    createdAt: string;
};

const joinName = (first?: unknown, last?: unknown, fallback = 'Not available') => {
    const full = `${typeof first === 'string' ? first : ''} ${typeof last === 'string' ? last : ''}`.trim();
    return full || fallback;
};

const getProfile = (value: any) => {
    if (Array.isArray(value)) return value[0] || {};
    return value || {};
};

const mapHospitalProfile = (row: any): HospitalProfile => ({
    id: row.id,
    status: row.status || 'new',
    registeredName: row.registered_name || 'Hospital',
    displayName: row.display_name || undefined,
    facilityType: row.facility_type || '',
    website: row.website || undefined,
    registrationNumber: row.registration_number || '',
    registeringAuthority: row.registering_authority || '',
    registrationExpiry: row.registration_expiry || undefined,
    city: row.city || '',
    state: row.state || '',
    pinCode: row.pin_code || '',
    fullAddress: row.full_address || '',
    googleMapsLink: row.google_maps_link || undefined,
    authorizedPersonName: row.authorized_person_name || '',
    designation: row.designation || '',
    officialEmail: row.official_email || '',
    mobileNumber: row.mobile_number || '',
    whatsappNumber: row.whatsapp_number || undefined,
    appAccountStatus: row.app_account_status || 'created_pending_review',
    specialities: Array.isArray(row.specialities) ? row.specialities : [],
    facilities: Array.isArray(row.facilities) ? row.facilities : [],
    opdTimings: row.opd_timings || '',
    createdAt: row.created_at,
});

const mapHospitalDoctor = (row: any): HospitalDoctor => {
    const doctor = row.doctor || {};
    const profile = getProfile(doctor.profiles);

    return {
        id: row.id,
        doctorId: row.doctor_id,
        status: row.status || 'active',
        department: row.department || undefined,
        name: joinName(profile.first_name, profile.last_name, 'Doctor'),
        email: profile.email || '',
        phoneNumber: profile.phone_number || '',
        specialization: doctor.specialization || '',
        city: doctor.city || '',
        registrationNumber: doctor.registration_number || '',
        createdAt: row.created_at,
    };
};

const mapHospitalPatient = (row: any): HospitalPatient => {
    const patient = row.patient || {};
    const doctor = row.doctor || {};
    const doctorProfile = getProfile(doctor.profiles);

    return {
        id: row.id,
        patientId: row.patient_id,
        doctorId: row.doctor_id || undefined,
        status: row.status || 'active',
        notes: row.notes || undefined,
        patientName: joinName(patient.first_name, patient.last_name, 'Patient'),
        patientEmail: patient.email || '',
        patientPhone: patient.phone_number || '',
        doctorName: row.doctor_id ? joinName(doctorProfile.first_name, doctorProfile.last_name, 'Doctor') : undefined,
        createdAt: row.created_at,
    };
};

const mapVoiceIntake = (row: any): HospitalVoiceIntake => ({
    id: row.id,
    title: row.title || 'Hospital voice intake',
    status: row.status || 'draft',
    language: row.language || 'Hindi / English',
    aiSummary: row.ai_summary || undefined,
    transcript: row.transcript || undefined,
    pdfUrl: row.metadata?.pdf_path || row.metadata?.pdfUrl || undefined,
    source: row.metadata?.source || undefined,
    model: row.metadata?.model || undefined,
    patientId: row.patient_id || undefined,
    doctorId: row.doctor_id || undefined,
    createdAt: row.created_at,
});

export const useHospitalProfile = () => {
    const { user } = useAuthContext();

    return useQuery({
        queryKey: HOSPITAL_QUERY_KEYS.profile,
        enabled: Boolean(user?.id),
        queryFn: async () => {
            const { data, error } = await supabase
                .from('hospital_onboarding_requests')
                .select('*')
                .eq('hospital_admin_user_id', user!.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            return data ? mapHospitalProfile(data) : null;
        },
    });
};

export const useUpdateHospitalProfile = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: HospitalProfileUpdateInput) => {
            const { data, error } = await supabase.rpc('hospital_update_profile', {
                p_display_name: input.displayName?.trim() || null,
                p_website: input.website?.trim() || null,
                p_full_address: input.fullAddress.trim(),
                p_city: input.city.trim(),
                p_state: input.state.trim(),
                p_pin_code: input.pinCode.trim(),
                p_google_maps_link: input.googleMapsLink?.trim() || null,
                p_authorized_person_name: input.authorizedPersonName.trim(),
                p_designation: input.designation.trim(),
                p_mobile_number: input.mobileNumber.trim(),
                p_whatsapp_number: input.whatsappNumber?.trim() || null,
                p_official_email: input.officialEmail.trim().toLowerCase(),
                p_specialities: input.specialities,
                p_facilities: input.facilities,
                p_opd_timings: input.opdTimings.trim(),
            });

            if (error) throw error;
            return data as string;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: HOSPITAL_QUERY_KEYS.profile });
        },
    });
};

export const useHospitalDoctors = () => {
    const { user } = useAuthContext();

    return useQuery({
        queryKey: HOSPITAL_QUERY_KEYS.doctors,
        enabled: Boolean(user?.id),
        queryFn: async () => {
            const { data, error } = await supabase
                .from('hospital_doctors')
                .select(`
                    id, doctor_id, status, department, created_at,
                    doctor:doctors (
                        id, city, specialization, registration_number,
                        profiles (first_name, last_name, email, phone_number)
                    )
                `)
                .eq('hospital_admin_user_id', user!.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data || []).map(mapHospitalDoctor);
        },
    });
};

export const useHospitalPatients = () => {
    const { user } = useAuthContext();

    return useQuery({
        queryKey: HOSPITAL_QUERY_KEYS.patients,
        enabled: Boolean(user?.id),
        queryFn: async () => {
            const { data, error } = await supabase
                .from('hospital_patients')
                .select(`
                    id, patient_id, doctor_id, status, notes, created_at,
                    patient:profiles!hospital_patients_patient_id_fkey (
                        id, first_name, last_name, email, phone_number
                    ),
                    doctor:doctors!hospital_patients_doctor_id_fkey (
                        id, specialization,
                        profiles (first_name, last_name, email)
                    )
                `)
                .eq('hospital_admin_user_id', user!.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data || []).map(mapHospitalPatient);
        },
    });
};

export const useHospitalVoiceIntakes = () => {
    const { user } = useAuthContext();

    return useQuery({
        queryKey: HOSPITAL_QUERY_KEYS.voiceIntakes,
        enabled: Boolean(user?.id),
        queryFn: async () => {
            const { data, error } = await supabase
                .from('hospital_voice_intake_sessions')
                .select('id, title, status, language, ai_summary, transcript, metadata, patient_id, doctor_id, created_at')
                .eq('hospital_admin_user_id', user!.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data || []).map(mapVoiceIntake);
        },
    });
};

export const useHospitalVoiceIntake = (intakeId?: string) => {
    const { user } = useAuthContext();

    return useQuery({
        queryKey: [...HOSPITAL_QUERY_KEYS.voiceIntakes, intakeId],
        enabled: Boolean(user?.id && intakeId),
        queryFn: async () => {
            const { data, error } = await supabase
                .from('hospital_voice_intake_sessions')
                .select('id, title, status, language, ai_summary, transcript, metadata, patient_id, doctor_id, created_at')
                .eq('hospital_admin_user_id', user!.id)
                .eq('id', intakeId!)
                .maybeSingle();

            if (error) throw error;
            return data ? mapVoiceIntake(data) : null;
        },
    });
};

export const useHospitalStats = () => {
    const { user } = useAuthContext();

    return useQuery({
        queryKey: HOSPITAL_QUERY_KEYS.stats,
        enabled: Boolean(user?.id),
        queryFn: async () => {
            const [doctors, patients, voiceIntakes] = await Promise.all([
                supabase
                    .from('hospital_doctors')
                    .select('id', { count: 'exact', head: true })
                    .eq('hospital_admin_user_id', user!.id)
                    .eq('status', 'active'),
                supabase
                    .from('hospital_patients')
                    .select('id', { count: 'exact', head: true })
                    .eq('hospital_admin_user_id', user!.id)
                    .eq('status', 'active'),
                supabase
                    .from('hospital_voice_intake_sessions')
                    .select('id', { count: 'exact', head: true })
                    .eq('hospital_admin_user_id', user!.id),
            ]);

            if (doctors.error) throw doctors.error;
            if (patients.error) throw patients.error;
            if (voiceIntakes.error) throw voiceIntakes.error;

            return {
                doctors: doctors.count || 0,
                patients: patients.count || 0,
                voiceIntakes: voiceIntakes.count || 0,
            };
        },
    });
};

export const useLinkHospitalDoctor = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: { identifier: string; department?: string }) => {
            const { data, error } = await supabase.rpc('hospital_link_doctor', {
                p_identifier: input.identifier.trim(),
                p_department: input.department?.trim() || null,
            });

            if (error) throw error;
            return data as string;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: HOSPITAL_QUERY_KEYS.doctors });
            queryClient.invalidateQueries({ queryKey: HOSPITAL_QUERY_KEYS.stats });
        },
    });
};

export const useLinkHospitalPatient = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: { email: string; doctorId?: string; notes?: string }) => {
            const { data, error } = await supabase.rpc('hospital_link_patient', {
                p_email: input.email.trim().toLowerCase(),
                p_doctor_id: input.doctorId || null,
                p_notes: input.notes?.trim() || null,
            });

            if (error) throw error;
            return data as string;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: HOSPITAL_QUERY_KEYS.patients });
            queryClient.invalidateQueries({ queryKey: HOSPITAL_QUERY_KEYS.stats });
        },
    });
};

export const useCreateHospitalVoiceIntake = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: {
            title: string;
            patientId?: string;
            doctorId?: string;
            transcript?: string;
            language?: string;
        }) => {
            const { data, error } = await supabase.functions.invoke('hospital-voice-intake', {
                body: {
                    title: input.title.trim() || 'Hospital voice intake',
                    patientId: input.patientId || null,
                    doctorId: input.doctorId || null,
                    transcript: input.transcript?.trim() || '',
                    language: input.language || 'Hindi / English',
                },
            });

            if (error) throw error;
            if (!data?.success) {
                throw new Error(data?.message || 'Could not create hospital voice intake.');
            }

            return {
                id: data.id as string,
                summary: data.summary as string | undefined,
                pdfUrl: data.pdfUrl as string | undefined,
                source: data.source as string | undefined,
            };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: HOSPITAL_QUERY_KEYS.voiceIntakes });
            queryClient.invalidateQueries({ queryKey: HOSPITAL_QUERY_KEYS.stats });
        },
    });
};
