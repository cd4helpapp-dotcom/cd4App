export interface ApiResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: string;
    errors?: Array<{
        field: string;
        message: string;
    }>;
}

export interface User {
    id: string;
    _id?: string;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    age?: number;
    gender?: 'Male' | 'Female' | 'Other';
    address?: string;
    weight?: number;
    bloodPressure?: string;
    pulse?: number;
    profileSetupCompleted?: boolean;
    settings?: {
        notifications: { push: boolean; email: boolean; sms: boolean; marketing: boolean; };
        privacy: { profileVisibility: 'public' | 'private' | 'doctors_only'; };
        language: string;
        appearance?: { mode: 'system' | 'light' | 'dark'; };
        chats?: { readReceipts?: boolean; mediaAutoDownload?: boolean; };
    };
    role: 'Patient' | 'Doctor' | 'Admin' | 'Marketing' | 'Hospital';
    isVerified: boolean;
    subscription?: {
        id: string;
        planCode: string;
        billingCycle: 'monthly' | 'yearly';
        status: 'pending' | 'active' | 'trialing' | 'grace' | 'cancelled' | 'expired';
        expiresAt?: string | null;
        nextBillingAt?: string | null;
        paymentId?: string | null;
        amountPaid?: number | null;
        currency?: string | null;
    };
    profilePicture?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Doctor {
    id: string;
    _id?: string;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    city: string;
    specialization: string;
    experience: string;
    fee: string;
    bio?: string;
    image?: string;
    rating: number;
    isVerified: boolean;
    gender: 'Male' | 'Female' | 'Other';
    registrationNumber: string;
    kycVerify: boolean;
    documents: string[];
    degree?: string;
    university?: string;
    yearOfCompletion?: number;
    registrationCouncil?: string;
    currentHospitalClinic?: string;
    previousWorkDetails?: string;
    areasOfExpertise?: string[];
    languagesSpoken?: string[];
    treatmentApproach?: string;
    profileCompletionDone?: boolean;
    profileCompletionDoneAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Slot {
    id: string;
    _id?: string;
    doctor: string;
    date: string;
    startTime: string;
    endTime: string;
    isBooked: boolean;
    appointment?: string;
}

export interface Appointment {
    id: string;
    _id?: string;
    patient: User;
    doctor: string;
    slot: Slot;
    status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
    notes?: string;
    meetLink?: string;
    aiReport?: {
        id: string;
        summary?: string;
        concern?: string;
        chatHistory?: AiChatHistoryMessage[];
        pdf_url?: string;
    };
    createdAt: string;
}

export interface SignupData {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    password?: string;
}

export interface LoginData {
    identifier: string; // email or phone
}

export interface FirebasePhoneLoginData {
    idToken: string;
}

export interface VerifyOTPData {
    identifier: string;
    otp: string;
}

export interface ResendOTPData {
    identifier: string; // phone number or email
}

export interface UpdateProfileData {
    firstName?: string;
    lastName?: string;
    email?: string;
    phoneNumber?: string;
    age?: number;
    gender?: 'Male' | 'Female' | 'Other';
    address?: string;
    weight?: number;
    bloodPressure?: string;
    pulse?: number;
    profileSetupCompleted?: boolean;
}

export interface UpdateSettingsData {
    notifications?: { push?: boolean; email?: boolean; sms?: boolean; marketing?: boolean; };
    privacy?: { profileVisibility?: 'public' | 'private' | 'doctors_only'; };
    language?: string;
    appearance?: { mode?: 'system' | 'light' | 'dark'; };
    chats?: { readReceipts?: boolean; mediaAutoDownload?: boolean; };
}

export interface AiChatHistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface AiChatRequest {
    message: string;
    concern?: string;
    history?: AiChatHistoryMessage[];
}

export interface AiChatResponse {
    reply: string;
    source: 'gemini' | 'openai' | 'fallback';
    disclaimer: string;
    consultRecommended?: boolean;
    needsHumanReview?: boolean;
    reviewReason?: 'none' | 'emergency_signal' | 'moderation_flagged' | 'safety_check_unavailable';
}

export type NotificationType =
    | 'chat_message'
    | 'payment'
    | 'community_like'
    | 'community_comment'
    | 'appointment_update'
    | 'health_reminder'
    | 'medical_report_alert'
    | 'system';

export interface AppNotification {
    id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
    is_read: boolean;
    created_at: string;
}
