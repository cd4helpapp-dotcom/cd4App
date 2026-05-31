import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { Slot, Appointment, User } from '../src/types';
import { useAuthContext } from '../context/AuthContext';
import { sanitizeNamePart } from '../src/utils/nameSanitizer';

export const APPOINTMENT_QUERY_KEYS = {
    myAppointments: (userId: string) => ['appointments', 'my', userId] as const,
    availableSlots: (doctorId: string) => ['slots', 'available', doctorId] as const,
    doctorSlots: (doctorId: string) => ['slots', 'doctor', doctorId] as const,
    doctorAppointments: (doctorId: string) => ['appointments', 'doctor', doctorId] as const,
};

const BOOKING_COOLDOWN_DAYS = 30;
const BOOKING_COOLDOWN_WINDOW_MS = BOOKING_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const BOOKING_COOLDOWN_STATUSES: Appointment['status'][] = ['pending', 'confirmed', 'completed'];
const APPOINTMENT_NOTIFICATION_HISTORY_LIMIT = 20;
const APPOINTMENT_NOTIFICATION_HISTORY_CHAR_LIMIT = 320;
const CLINICAL_TRANSCRIPT_SIGNAL_PATTERN =
    /\b(symptom|symptoms|when did|how long|since|kab se|severity|pain scale|1-10|fever|cough|cold|rash|itch|allergy|breath|breathing|pain|ache|vomit|nausea|diarrhea|constipation|period|pregnan|pcos|bp|blood pressure|sugar|diabet|thyroid|medicine|medication|tablet|dawai|dava|doctor|consult)\b/i;

type AppointmentNotificationHistoryItem = {
    role: 'user' | 'assistant';
    content: string;
};

const isUuid = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');

const clipText = (value: string, maxLength: number): string => {
    const text = (value || '').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const isClinicalTranscriptLine = (item: AppointmentNotificationHistoryItem): boolean => {
    const text = (item.content || '').trim();
    if (!text) return false;

    if (CLINICAL_TRANSCRIPT_SIGNAL_PATTERN.test(text)) {
        return true;
    }

    if (item.role === 'assistant' && /\?/.test(text)) {
        return true;
    }

    if (item.role === 'user' && text.split(/\s+/).length >= 6) {
        return true;
    }

    return false;
};

const fetchConversationHistoryForNotification = async (args: {
    userId: string;
    conversationId?: string;
}): Promise<AppointmentNotificationHistoryItem[]> => {
    const conversationId = typeof args.conversationId === 'string' ? args.conversationId.trim() : '';
    if (!conversationId || !isUuid(conversationId) || !args.userId) {
        return [];
    }

    const { data, error } = await supabase
        .from('ai_chat_messages')
        .select('sender, text')
        .eq('conversation_id', conversationId)
        .eq('user_id', args.userId)
        .order('created_at', { ascending: true })
        .limit(60);

    if (error || !Array.isArray(data)) {
        return [];
    }

    const normalized = data
        .map((item: any): AppointmentNotificationHistoryItem => {
            const role: AppointmentNotificationHistoryItem['role'] = item?.sender === 'ai' ? 'assistant' : 'user';
            return {
                role,
                content: clipText(typeof item?.text === 'string' ? item.text : '', APPOINTMENT_NOTIFICATION_HISTORY_CHAR_LIMIT),
            };
        })
        .filter((item) => item.content.length > 0);

    const clinicallyRelevant = normalized.filter(isClinicalTranscriptLine);
    const finalHistory =
        clinicallyRelevant.length >= 6
            ? clinicallyRelevant
            : normalized;

    return finalHistory.slice(-APPOINTMENT_NOTIFICATION_HISTORY_LIMIT);
};

const buildDefaultDoctorRegistrationNumber = (userId: string) => `AUTO-${userId.replace(/-/g, '')}`;

const getDefaultDoctorCity = (address: unknown): string => {
    if (typeof address !== 'string') {
        return 'City Not Set';
    }

    const firstSegment = address.split(',')[0]?.trim();
    return firstSegment || 'City Not Set';
};

const ensureDoctorProfileForSlots = async (userId: string) => {
    const { data: doctorRow, error: doctorRowError } = await supabase
        .from('doctors')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (!doctorRowError && doctorRow?.id) {
        return;
    }

    const { error: ensureDoctorError } = await supabase
        .rpc('ensure_doctor_row', { p_user_id: userId });

    if (!ensureDoctorError) {
        return;
    }

    const { data: profileRow, error: profileError } = await supabase
        .from('profiles')
        .select('id, address')
        .eq('id', userId)
        .maybeSingle();

    if (profileError || !profileRow?.id) {
        throw new Error('Account profile is still initializing. Please retry in a few seconds.');
    }

    const { error: fallbackUpsertError } = await supabase
        .from('doctors')
        .upsert({
            id: userId,
            city: getDefaultDoctorCity(profileRow.address),
            specialization: 'General Medicine',
            experience: '0 Years',
            fee: 'INR 0',
            bio: '',
            registration_number: buildDefaultDoctorRegistrationNumber(userId),
            kyc_verify: false,
            documents: [],
            rating: 0,
        }, { onConflict: 'id' });

    if (fallbackUpsertError) {
        throw new Error('Doctor profile setup is incomplete. Please update clinic details once and retry.');
    }
};

const normalizeUserRole = (slug: unknown): User['role'] => {
    if (typeof slug !== 'string') {
        return 'Patient';
    }

    switch (slug.trim().toLowerCase()) {
        case 'doctor':
            return 'Doctor';
        case 'admin':
            return 'Admin';
        case 'marketing':
            return 'Marketing';
        default:
            return 'Patient';
    }
};


const getLocalISODate = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// --- Patient Hooks ---

export const useMyAppointments = () => {
    const { session } = useAuthContext();
    return useQuery({
        queryKey: APPOINTMENT_QUERY_KEYS.myAppointments(session?.user?.id || ''),
        queryFn: async () => {
            if (!session?.user?.id) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('appointments')
                .select('*, doctor:doctors(*, profiles(*)), slot:slots!slot_id(*)')
                .eq('patient_id', session.user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return data.map((apt: any) => ({
                id: apt.id,
                _id: apt.id,
                patient: apt.patient_id, // Simplified for now
                doctor: apt.doctor_id,
                slot: {
                    id: apt.slot?.id,
                    _id: apt.slot?.id,
                    doctor: apt.doctor_id,
                    date: apt.slot?.date,
                    startTime: apt.slot?.start_time,
                    endTime: apt.slot?.end_time,
                    isBooked: apt.slot?.is_booked,
                },
                status: apt.status,
                notes: apt.notes,
                meetLink: apt.meet_link,
                createdAt: apt.created_at,
            })) as unknown as Appointment[];
        },
        enabled: !!session?.user?.id,
    });
};

export const useAvailableSlots = (doctorId: string) => {
    return useQuery({
        queryKey: APPOINTMENT_QUERY_KEYS.availableSlots(doctorId),
        queryFn: async () => {
            if (!doctorId) return [];

            const { data, error } = await supabase
                .from('slots')
                .select('*')
                .eq('doctor_id', doctorId)
                .eq('is_booked', false)
                .gte('date', getLocalISODate())
                .order('date', { ascending: true })
                .order('start_time', { ascending: true });

            if (error) {
                const errorMessage = (error.message || '').toLowerCase();
                if (error.code === '42501' || errorMessage.includes('policy') || errorMessage.includes('permission')) {
                    throw new Error('Slot visibility is blocked by RLS policy. Apply the latest slots-select migration.');
                }
                throw error;
            }

            return data.map((s: any) => ({
                id: s.id,
                _id: s.id,
                doctor: s.doctor_id,
                date: s.date,
                startTime: s.start_time,
                endTime: s.end_time,
                isBooked: s.is_booked,
            })) as Slot[];
        },
        enabled: !!doctorId,
    });
};

export const useBookAppointment = () => {
    const queryClient = useQueryClient();
    const { session } = useAuthContext();

    return useMutation({
        mutationFn: async ({
            doctorId,
            slotId,
            orderId,
            paymentId,
            signature,
            aiReportId,
            concern,
            conversationId,
        }: {
            doctorId: string;
            slotId: string;
            orderId: string;
            paymentId: string;
            signature: string;
            aiReportId?: string;
            concern?: string;
            conversationId?: string;
        }) => {
            if (!session?.user?.id) throw new Error('Not authenticated');

            const cooldownStartIso = new Date(Date.now() - BOOKING_COOLDOWN_WINDOW_MS).toISOString();
            const { data: recentAppointment, error: recentAppointmentError } = await supabase
                .from('appointments')
                .select('id, created_at')
                .eq('patient_id', session.user.id)
                .eq('doctor_id', doctorId)
                .in('status', BOOKING_COOLDOWN_STATUSES)
                .gte('created_at', cooldownStartIso)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (recentAppointmentError) throw recentAppointmentError;

            if (recentAppointment?.created_at) {
                const nextBookingMs = new Date(recentAppointment.created_at).getTime() + BOOKING_COOLDOWN_WINDOW_MS;
                const nextBookingLabel = Number.isFinite(nextBookingMs)
                    ? new Date(nextBookingMs).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                    })
                    : `after ${BOOKING_COOLDOWN_DAYS} days`;

                throw new Error(
                    `You can book the same doctor only once in ${BOOKING_COOLDOWN_DAYS} days. Next booking available on ${nextBookingLabel}.`
                );
            }

            const { data: verifyData, error: verifyError } = await supabase.functions.invoke('manage-appointment-payment', {
                body: {
                    action: 'verify_and_book',
                    orderId,
                    paymentId,
                    signature,
                    doctorId,
                    slotId,
                    aiReportId,
                    conversationId,
                },
            });

            if (verifyError || verifyData?.success === false) {
                throw new Error(verifyData?.message || verifyError?.message || 'Payment verification failed.');
            }

            const appointment = { id: verifyData?.appointmentId };

            // 3. Notify doctor about new appointment (non-blocking).
            void (async () => {
                const compactHistory = await fetchConversationHistoryForNotification({
                    userId: session.user.id,
                    conversationId,
                });

                const notificationBody: Record<string, unknown> = {
                    appointmentId: appointment.id,
                    concern: concern || undefined,
                    conversationId: conversationId || undefined,
                };

                if (compactHistory.length > 0) {
                    notificationBody.history = compactHistory;
                }

                const { data, error } = await supabase.functions.invoke('send-appointment-notification', {
                    body: notificationBody,
                });

                if (error || data?.success === false) {
                    const message =
                        (typeof data?.reason === 'string' && data.reason) ||
                        (typeof data?.error === 'string' && data.error) ||
                        error?.message ||
                        'appointment_notification_failed';
                    console.warn('Appointment doctor notification skipped:', message);
                }
            })();

            return appointment;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: APPOINTMENT_QUERY_KEYS.myAppointments(session?.user?.id || '') });
            queryClient.invalidateQueries({ queryKey: APPOINTMENT_QUERY_KEYS.availableSlots(variables.doctorId) });
            queryClient.invalidateQueries({ queryKey: APPOINTMENT_QUERY_KEYS.doctorAppointments(variables.doctorId) });
        },
    });
};

// --- Doctor Hooks ---

export const useDoctorSlots = () => {
    const { session } = useAuthContext();
    return useQuery({
        queryKey: APPOINTMENT_QUERY_KEYS.doctorSlots(session?.user?.id || ''),
        queryFn: async () => {
            if (!session?.user?.id) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('slots')
                .select('*')
                .eq('doctor_id', session.user.id)
                .order('date', { ascending: false })
                .order('start_time', { ascending: false });

            if (error) throw error;

            return data.map((s: any) => ({
                id: s.id,
                _id: s.id,
                doctor: s.doctor_id,
                date: s.date,
                startTime: s.start_time,
                endTime: s.end_time,
                isBooked: s.is_booked,
                appointment: s.appointment_id,
            })) as Slot[];
        },
        enabled: !!session?.user?.id,
    });
};

export const useAddSlot = () => {
    const queryClient = useQueryClient();
    const { session } = useAuthContext();

    return useMutation({
        mutationFn: async (data: { date: string; startTime: string; endTime: string }) => {
            if (!session?.user?.id) throw new Error('Not authenticated');

            await ensureDoctorProfileForSlots(session.user.id);

            const createSlot = () => supabase
                .from('slots')
                .insert({
                    doctor_id: session.user.id,
                    date: data.date,
                    start_time: data.startTime,
                    end_time: data.endTime,
                    is_booked: false,
                })
                .select()
                .single();

            let { data: newSlot, error } = await createSlot();

            if (error && (error.message || '').toLowerCase().includes('slots_doctor_id_fkey')) {
                await ensureDoctorProfileForSlots(session.user.id);
                const retryResult = await createSlot();
                newSlot = retryResult.data;
                error = retryResult.error;
            }

            if (error) throw error;
            return newSlot;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: APPOINTMENT_QUERY_KEYS.doctorSlots(session?.user?.id || '') });
        },
    });
};

export const useDoctorAppointments = () => {
    const { session } = useAuthContext();
    return useQuery({
        queryKey: APPOINTMENT_QUERY_KEYS.doctorAppointments(session?.user?.id || ''),
        queryFn: async (): Promise<Appointment[]> => {
            if (!session?.user?.id) throw new Error('Not authenticated');

            const { data, error } = await supabase
                .from('appointments')
                .select('*, patient:profiles!patient_id(*, roles(slug)), slot:slots!slot_id(*), ai_report:ai_triage_reports(*)')
                .eq('doctor_id', session.user.id)
                .order('created_at', { ascending: false });

            if (error) {
                const errorMessage = (error.message || '').toLowerCase();
                if (error.code === '42501' || errorMessage.includes('policy') || errorMessage.includes('permission')) {
                    throw new Error('Appointments are blocked by RLS policy. Apply latest RLS migrations and retry.');
                }
                throw error;
            }

            return data.map((apt: any): Appointment => ({
                id: apt.id,
                _id: apt.id,
                patient: {
                    id: apt.patient?.id,
                    _id: apt.patient?.id,
                    firstName: sanitizeNamePart(apt.patient?.first_name) || 'Patient',
                    lastName: sanitizeNamePart(apt.patient?.last_name),
                    email: apt.patient?.email,
                    phoneNumber: apt.patient?.phone_number,
                    role: normalizeUserRole(apt.patient?.roles?.slug),
                    isVerified: apt.patient?.is_verified || false,
                    createdAt: apt.patient?.created_at,
                    updatedAt: apt.patient?.updated_at,
                },
                doctor: apt.doctor_id,
                slot: {
                    id: apt.slot?.id,
                    _id: apt.slot?.id,
                    doctor: apt.doctor_id,
                    date: apt.slot?.date,
                    startTime: apt.slot?.start_time,
                    endTime: apt.slot?.end_time,
                    isBooked: apt.slot?.is_booked,
                },
                status: apt.status,
                notes: apt.notes,
                meetLink: apt.meet_link,
                aiReport: apt.ai_report ? {
                    id: apt.ai_report.id,
                    summary: apt.ai_report.summary,
                    concern: apt.ai_report.concern,
                    chatHistory: apt.ai_report.chat_history,
                    pdf_url: apt.ai_report.pdf_url,
                } : undefined,
                createdAt: apt.created_at,
            }));
        },
        enabled: !!session?.user?.id,
        staleTime: 5000,
        refetchInterval: 15000,
        refetchIntervalInBackground: false,
    });
};

