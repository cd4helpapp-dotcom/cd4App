import { Appointment } from '../types';

export type ChatRoomLite = {
    id: string;
    patient_id?: string | null;
    doctor_id?: string | null;
    last_message_at?: string | null;
    unread_count_doctor?: number | null;
    other_party?: {
        id?: string;
        firstName?: string;
        lastName?: string;
    };
};

export type DoctorPatientInsight = {
    patientId: string;
    firstName: string;
    lastName: string;
    fullName: string;
    age?: number;
    totalAppointments: number;
    completedAppointments: number;
    upcomingAppointments: number;
    cancelledAppointments: number;
    nextAppointmentAt: string | null;
    lastAppointmentAt: string | null;
    lastChatAt: string | null;
    latestAiSummary: string | null;
    latestAiPdfUrl: string | null;
    unreadChatCount: number;
    roomId: string | null;
};

export type DoctorDashboardMetrics = {
    totalAppointments: number;
    upcomingAppointments: number;
    completedAppointments: number;
    cancelledAppointments: number;
    totalPatients: number;
    aiSummaryCount: number;
    aiPdfCount: number;
    estimatedRevenue: number;
    realizedRevenue: number;
};

export type DoctorInsightsResult = {
    metrics: DoctorDashboardMetrics;
    patients: DoctorPatientInsight[];
    upcomingList: Appointment[];
};

const toValidDate = (value?: string | null): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const appointmentDate = (appointment: Appointment): Date | null => {
    return toValidDate(appointment.slot?.date || appointment.createdAt || null);
};

const startOfToday = (): Date => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const parseCurrencyAmount = (value: string | number | null | undefined): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return 0;
    const normalized = value.replace(/,/g, '');
    const match = normalized.match(/(\d+(\.\d+)?)/);
    if (!match) return 0;
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? amount : 0;
};

const maxDateString = (left: string | null, right: string | null): string | null => {
    if (!left) return right;
    if (!right) return left;
    const leftDate = toValidDate(left);
    const rightDate = toValidDate(right);
    if (!leftDate) return right;
    if (!rightDate) return left;
    return rightDate.getTime() > leftDate.getTime() ? right : left;
};

const minFutureDateString = (left: string | null, right: string | null): string | null => {
    if (!left) return right;
    if (!right) return left;
    const leftDate = toValidDate(left);
    const rightDate = toValidDate(right);
    if (!leftDate) return right;
    if (!rightDate) return left;
    return rightDate.getTime() < leftDate.getTime() ? right : left;
};

export const buildDoctorInsights = (args: {
    appointments?: Appointment[];
    chatRooms?: ChatRoomLite[];
    consultationFee?: string | number | null;
}): DoctorInsightsResult => {
    const appointments = args.appointments || [];
    const chatRooms = args.chatRooms || [];
    const feeAmount = parseCurrencyAmount(args.consultationFee);
    const today = startOfToday();

    let completedAppointments = 0;
    let cancelledAppointments = 0;
    let aiSummaryCount = 0;
    let aiPdfCount = 0;
    const upcomingList: Appointment[] = [];

    const patientMap = new Map<string, DoctorPatientInsight>();

    for (const appointment of appointments) {
        const status = (appointment.status || '').toLowerCase();
        const patientId = appointment.patient?._id;
        const aptDate = appointmentDate(appointment);
        const aptDateIso = aptDate ? aptDate.toISOString() : null;

        if (status === 'completed') completedAppointments += 1;
        if (status === 'cancelled') cancelledAppointments += 1;
        if (appointment.aiReport?.summary) aiSummaryCount += 1;
        if (appointment.aiReport?.pdf_url) aiPdfCount += 1;

        const isUpcomingStatus = status === 'pending' || status === 'confirmed';
        if (isUpcomingStatus && aptDate && aptDate.getTime() >= today.getTime()) {
            upcomingList.push(appointment);
        }

        if (!patientId) continue;
        const firstName = appointment.patient?.firstName || 'Patient';
        const lastName = appointment.patient?.lastName || '';
        const base = patientMap.get(patientId) || {
            patientId,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`.trim(),
            age: appointment.patient?.age,
            totalAppointments: 0,
            completedAppointments: 0,
            upcomingAppointments: 0,
            cancelledAppointments: 0,
            nextAppointmentAt: null,
            lastAppointmentAt: null,
            lastChatAt: null,
            latestAiSummary: null,
            latestAiPdfUrl: null,
            unreadChatCount: 0,
            roomId: null,
        };

        base.totalAppointments += 1;
        if (status === 'completed') base.completedAppointments += 1;
        if (status === 'cancelled') base.cancelledAppointments += 1;
        if (isUpcomingStatus && aptDate && aptDate.getTime() >= today.getTime()) {
            base.upcomingAppointments += 1;
            base.nextAppointmentAt = minFutureDateString(base.nextAppointmentAt, aptDateIso);
        }
        base.lastAppointmentAt = maxDateString(base.lastAppointmentAt, aptDateIso);

        // Keep the latest AI summary/PDF for patient.
        if (appointment.aiReport?.summary && (!base.latestAiSummary || aptDateIso === base.lastAppointmentAt)) {
            base.latestAiSummary = appointment.aiReport.summary;
        }
        if (appointment.aiReport?.pdf_url && (!base.latestAiPdfUrl || aptDateIso === base.lastAppointmentAt)) {
            base.latestAiPdfUrl = appointment.aiReport.pdf_url;
        }

        patientMap.set(patientId, base);
    }

    for (const room of chatRooms) {
        const patientId = (room.patient_id || room.other_party?.id || '').trim();
        if (!patientId) continue;

        const firstName = room.other_party?.firstName || 'Patient';
        const lastName = room.other_party?.lastName || '';
        const base = patientMap.get(patientId) || {
            patientId,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`.trim(),
            totalAppointments: 0,
            completedAppointments: 0,
            upcomingAppointments: 0,
            cancelledAppointments: 0,
            nextAppointmentAt: null,
            lastAppointmentAt: null,
            lastChatAt: null,
            latestAiSummary: null,
            latestAiPdfUrl: null,
            unreadChatCount: 0,
            roomId: null,
        };

        base.roomId = room.id || base.roomId;
        base.lastChatAt = maxDateString(base.lastChatAt, room.last_message_at || null);
        base.unreadChatCount = Math.max(base.unreadChatCount, Number(room.unread_count_doctor || 0));

        patientMap.set(patientId, base);
    }

    upcomingList.sort((left, right) => {
        const leftDate = appointmentDate(left);
        const rightDate = appointmentDate(right);
        if (!leftDate && !rightDate) return 0;
        if (!leftDate) return 1;
        if (!rightDate) return -1;
        return leftDate.getTime() - rightDate.getTime();
    });

    const patients = Array.from(patientMap.values()).sort((left, right) => {
        const leftAnchor = left.lastAppointmentAt || left.lastChatAt || '';
        const rightAnchor = right.lastAppointmentAt || right.lastChatAt || '';
        const leftDate = toValidDate(leftAnchor);
        const rightDate = toValidDate(rightAnchor);
        if (!leftDate && !rightDate) return left.fullName.localeCompare(right.fullName);
        if (!leftDate) return 1;
        if (!rightDate) return -1;
        return rightDate.getTime() - leftDate.getTime();
    });

    return {
        metrics: {
            totalAppointments: appointments.length,
            upcomingAppointments: upcomingList.length,
            completedAppointments,
            cancelledAppointments,
            totalPatients: patients.length,
            aiSummaryCount,
            aiPdfCount,
            estimatedRevenue: feeAmount * upcomingList.length,
            realizedRevenue: feeAmount * completedAppointments,
        },
        patients,
        upcomingList,
    };
};
