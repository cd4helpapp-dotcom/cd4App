import { Linking, Platform } from 'react-native';
import { SUPPORT_WHATSAPP_NUMBER } from '../../constants/Config';

export const CD4_OFFICIAL_WHATSAPP = SUPPORT_WHATSAPP_NUMBER || '917050417766';

/**
 * Returns formatted phone number string for UI display (e.g. +91 7050417766).
 */
export const getFormattedSupportPhone = (phone: string = CD4_OFFICIAL_WHATSAPP): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return `+${digits}`;
};

/**
 * Opens WhatsApp chat with a specific phone number and pre-filled message.
 * Uses official WhatsApp universal link (wa.me) which is 100% safe and compliant.
 */
export const openWhatsApp = async (phone: string, text: string = '') => {
  const cleanPhone = phone.replace(/\D/g, '');
  const encodedText = encodeURIComponent(text);
  const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodedText}` : `https://wa.me/?text=${encodedText}`;

  try {
    const supported = await Linking.canOpenURL(url);
    if (supported || Platform.OS === 'web') {
      await Linking.openURL(url);
      return true;
    } else {
      // Fallback for native whatsapp scheme
      const nativeScheme = cleanPhone
        ? `whatsapp://send?phone=${cleanPhone}&text=${encodedText}`
        : `whatsapp://send?text=${encodedText}`;
      await Linking.openURL(nativeScheme);
      return true;
    }
  } catch (_error) {
    // Web or browser fallback
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }
};

/**
 * 1-Click to open official CD4 WhatsApp Support desk ()
 */
export const openWhatsAppSupport = (contextMessage?: string) => {
  const defaultText = contextMessage
    ? `Hello CD4 Health Support,\n\n${contextMessage}`
    : 'Hello CD4 Health Support, I need assistance regarding my consultation / account.';
  return openWhatsApp(CD4_OFFICIAL_WHATSAPP, defaultText);
};

/**
 * Formats and opens an appointment slip in WhatsApp.
 * If targetPhone is provided (e.g. user's own phone), sends directly to their WhatsApp chat.
 * If targetPhone is omitted, opens WhatsApp contact/chat selector so user can share with self/family.
 */
export const shareAppointmentOnWhatsApp = (details: {
  doctorName?: string;
  date?: string;
  time?: string;
  amount?: string;
  appointmentId?: string;
  paymentId?: string;
  targetPhone?: string;
}) => {
  const text =
    `*CD4 HEALTH — APPOINTMENT CONFIRMED* 🩺\n\n` +
    `👨‍⚕️ *Doctor:* ${details.doctorName || 'Consulting Specialist'}\n` +
    `📅 *Date:* ${details.date || 'Scheduled Date'}\n` +
    `⏰ *Time:* ${details.time || 'Scheduled Time'}\n` +
    `💳 *Amount Paid:* ₹${details.amount || '500'}\n` +
    `🔖 *Booking ID:* ${details.appointmentId || 'N/A'}\n\n` +
    `Join consultation or view details in the CD4 App:\n` +
    `https://cd4.co.in`;

  const target = (details.targetPhone || '').replace(/\D/g, '');
  return openWhatsApp(target, text);
};

/**
 * Formats and opens a prescription slip in WhatsApp.
 */
export const sharePrescriptionOnWhatsApp = (details: {
  doctorName?: string;
  patientName?: string;
  date?: string;
  prescriptionUrl?: string;
  targetPhone?: string;
}) => {
  const text =
    `*CD4 HEALTH — MEDICAL PRESCRIPTION* 📄\n\n` +
    `👤 *Patient:* ${details.patientName || 'Patient'}\n` +
    `👨‍⚕️ *Doctor:* ${details.doctorName || 'Doctor'}\n` +
    `📅 *Date:* ${details.date || new Date().toLocaleDateString('en-IN')}\n\n` +
    `View/Download official digital prescription:\n` +
    `${details.prescriptionUrl || 'https://cd4.co.in'}`;

  const target = (details.targetPhone || '').replace(/\D/g, '');
  return openWhatsApp(target, text);
};
