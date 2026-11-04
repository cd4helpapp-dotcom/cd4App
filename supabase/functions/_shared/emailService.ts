// @ts-nocheck
/**
 * CD4 Health - Transactional Email Dispatcher via Resend API
 * Handles:
 * - Payment Successful / Receipt
 * - Payment Failed
 * - Refund Initiated / Completed
 * - Appointment Cancelled
 * - Appointment Rescheduled
 */

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const LOGO_URL = "https://cd4.co.in/images/cd4-logo.png";

const getResendApiKey = (): string => (Deno.env.get("RESEND_API_KEY") || "").trim();
const getEmailFrom = (): string => (Deno.env.get("EMAIL_FROM") || "CD4 Health <noreply@cd4.co.in>").trim();

const sanitizeText = (val: unknown): string => {
  if (val == null) return "";
  return String(val)
    .replace(/[^\x20-\x7E\n\r\t]/g, "")
    .trim();
};

const sendResendEmail = async (params: { to: string; subject: string; html: string }) => {
  const apiKey = getResendApiKey();
  const from = getEmailFrom();
  if (!apiKey || !params.to) {
    return { sent: false, reason: "missing_api_key_or_recipient" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.id) {
      return { sent: true, id: data.id };
    }
    return { sent: false, reason: data?.message || `http_${res.status}` };
  } catch (err: any) {
    return { sent: false, reason: err?.message || "email_exception" };
  }
};

/**
 * 1. PAYMENT SUCCESSFUL / RECEIPT EMAIL
 */
export const sendPaymentSuccessEmail = async (args: {
  toEmail: string;
  patientName: string;
  amount: number | string;
  paymentId: string;
  orderId?: string;
  doctorName?: string;
  slotDetails?: string;
}) => {
  const patient = sanitizeText(args.patientName) || "Valued Patient";
  const doctor = sanitizeText(args.doctorName) || "Consulting Specialist";
  const amountStr = typeof args.amount === "number" ? `₹${args.amount.toFixed(2)}` : `₹${args.amount}`;
  const paymentId = sanitizeText(args.paymentId);
  const orderId = sanitizeText(args.orderId);
  const slot = sanitizeText(args.slotDetails) || "Scheduled Consultation";

  const subject = `Payment Successful (${amountStr}) — Consultation with Dr. ${doctor} | CD4 Health`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E293B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background:#FFFFFF;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 4px 18px rgba(0,0,0,0.05);overflow:hidden;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg, #0C7A61 0%, #085241 100%);padding:32px 24px;text-align:center;">
              <div style="margin-bottom:12px;">
                <img src="${LOGO_URL}" alt="CD4 Health" width="130" style="display:inline-block;max-width:130px;height:auto;border-radius:10px;background:#ffffff;padding:8px 16px;box-shadow:0 3px 10px rgba(0,0,0,0.12);" />
              </div>
              <h1 style="margin:6px 0 0;color:#FFFFFF;font-size:22px;font-weight:700;">Payment Successful!</h1>
              <p style="margin:6px 0 0;color:#A7F3D0;font-size:14px;">Official Consultation Payment Receipt</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 16px;font-size:15px;color:#334155;">Dear <strong>${patient}</strong>,</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#475569;">
                Your payment has been successfully processed. Your medical consultation booking is fully confirmed.
              </p>

              <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
                <p style="margin:0;font-size:13px;color:#166534;font-weight:600;">AMOUNT PAID</p>
                <p style="margin:4px 0 0;font-size:32px;font-weight:800;color:#0C7A61;">${amountStr}</p>
                <span style="display:inline-block;margin-top:6px;padding:3px 10px;background:#DCFCE7;color:#15803D;border-radius:12px;font-size:11px;font-weight:700;">TRANSACTION COMPLETED</span>
              </div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Doctor:</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0F172A;text-align:right;">Dr. ${doctor}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Session Time:</td>
                        <td style="padding:6px 0;font-size:13px;font-weight:600;color:#0F172A;text-align:right;">${slot}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Payment ID:</td>
                        <td style="padding:6px 0;font-size:12px;font-family:monospace;color:#0C7A61;font-weight:600;text-align:right;">${paymentId}</td>
                      </tr>
                      ${orderId ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Order ID:</td>
                        <td style="padding:6px 0;font-size:12px;font-family:monospace;color:#64748B;text-align:right;">${orderId}</td>
                      </tr>` : ""}
                    </table>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;margin:28px 0 20px;">
                <a href="https://cd4.co.in/open-app?target=appointments" target="_blank" style="display:inline-block;background-color:#0C7A61;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;box-shadow:0 3px 10px rgba(12,122,97,0.3);">
                  Open in CD4 App
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94A3B8;">&copy; 2026 CD4 Health. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return sendResendEmail({ to: args.toEmail, subject, html });
};

/**
 * 2. PAYMENT FAILED EMAIL
 */
export const sendPaymentFailedEmail = async (args: {
  toEmail: string;
  patientName: string;
  amount: number | string;
  reason?: string;
  orderId?: string;
}) => {
  const patient = sanitizeText(args.patientName) || "Valued Patient";
  const amountStr = typeof args.amount === "number" ? `₹${args.amount.toFixed(2)}` : `₹${args.amount}`;
  const reason = sanitizeText(args.reason) || "Card/Bank declined or checkout timed out";
  const orderId = sanitizeText(args.orderId);

  const subject = `Payment Incomplete (${amountStr}) — CD4 Health`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E293B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background:#FFFFFF;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 4px 18px rgba(0,0,0,0.05);overflow:hidden;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg, #DC2626 0%, #991B1B 100%);padding:32px 24px;text-align:center;">
              <div style="margin-bottom:12px;">
                <img src="${LOGO_URL}" alt="CD4 Health" width="130" style="display:inline-block;max-width:130px;height:auto;border-radius:10px;background:#ffffff;padding:8px 16px;box-shadow:0 3px 10px rgba(0,0,0,0.12);" />
              </div>
              <h1 style="margin:6px 0 0;color:#FFFFFF;font-size:22px;font-weight:700;">Payment Incomplete</h1>
              <p style="margin:6px 0 0;color:#FECACA;font-size:14px;">We could not complete your consultation payment</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 16px;font-size:15px;color:#334155;">Dear <strong>${patient}</strong>,</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#475569;">
                Your attempt to pay <strong>${amountStr}</strong> for doctor consultation could not be finalized.
              </p>

              <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:12px;padding:16px;margin:20px 0;">
                <p style="margin:0 0 4px;font-size:12px;color:#991B1B;font-weight:700;text-transform:uppercase;">Reason Provided</p>
                <p style="margin:0;font-size:14px;color:#7F1D1D;">${reason}</p>
                ${orderId ? `<p style="margin:6px 0 0;font-size:11px;font-family:monospace;color:#B91C1C;">Reference: ${orderId}</p>` : ""}
              </div>

              <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#64748B;">
                  <strong>Note:</strong> If any money was deducted from your bank or card, it will be automatically reversed by your bank within 2–3 business days.
                </p>
              </div>

              <div style="text-align:center;margin:28px 0 20px;">
                <a href="https://cd4.co.in/open-app?target=appointments" target="_blank" style="display:inline-block;background-color:#0C7A61;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;box-shadow:0 3px 10px rgba(12,122,97,0.3);">
                  Retry in CD4 App
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94A3B8;">&copy; 2026 CD4 Health. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return sendResendEmail({ to: args.toEmail, subject, html });
};

/**
 * 3. REFUND PROCESSED / INITIATED EMAIL
 */
export const sendRefundEmail = async (args: {
  toEmail: string;
  patientName: string;
  amount: number | string;
  refundId?: string;
  paymentId?: string;
  reason?: string;
}) => {
  const patient = sanitizeText(args.patientName) || "Valued Patient";
  const amountStr = typeof args.amount === "number" ? `₹${args.amount.toFixed(2)}` : `₹${args.amount}`;
  const refundId = sanitizeText(args.refundId) || "RFND-AUTO-PROCESSED";
  const paymentId = sanitizeText(args.paymentId);
  const reason = sanitizeText(args.reason) || "Appointment cancelled or slot reallocated";

  const subject = `Refund Processed (${amountStr}) — CD4 Health`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E293B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background:#FFFFFF;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 4px 18px rgba(0,0,0,0.05);overflow:hidden;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg, #0284C7 0%, #0369A1 100%);padding:32px 24px;text-align:center;">
              <div style="margin-bottom:12px;">
                <img src="${LOGO_URL}" alt="CD4 Health" width="130" style="display:inline-block;max-width:130px;height:auto;border-radius:10px;background:#ffffff;padding:8px 16px;box-shadow:0 3px 10px rgba(0,0,0,0.12);" />
              </div>
              <h1 style="margin:6px 0 0;color:#FFFFFF;font-size:22px;font-weight:700;">Refund Initiated</h1>
              <p style="margin:6px 0 0;color:#BAE6FD;font-size:14px;">Your refund has been processed successfully</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 16px;font-size:15px;color:#334155;">Dear <strong>${patient}</strong>,</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#475569;">
                A refund has been initiated for your consultation payment. The full amount is on its way back to your original payment method (Bank/UPI/Card).
              </p>

              <div style="background:#F0F9FF;border:1px solid #7DD3FC;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
                <p style="margin:0;font-size:13px;color:#0369A1;font-weight:600;">REFUND AMOUNT</p>
                <p style="margin:4px 0 0;font-size:32px;font-weight:800;color:#0284C7;">${amountStr}</p>
                <span style="display:inline-block;margin-top:6px;padding:3px 10px;background:#E0F2FE;color:#0369A1;border-radius:12px;font-size:11px;font-weight:700;">PROCESSED &bull; 5–7 BUSINESS DAYS</span>
              </div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Refund ID:</td>
                        <td style="padding:6px 0;font-size:12px;font-family:monospace;color:#0284C7;font-weight:600;text-align:right;">${refundId}</td>
                      </tr>
                      ${paymentId ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Original Payment ID:</td>
                        <td style="padding:6px 0;font-size:12px;font-family:monospace;color:#64748B;text-align:right;">${paymentId}</td>
                      </tr>` : ""}
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Reason:</td>
                        <td style="padding:6px 0;font-size:13px;color:#334155;text-align:right;">${reason}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;margin:28px 0 20px;">
                <a href="https://cd4.co.in/open-app?target=appointments" target="_blank" style="display:inline-block;background-color:#0C7A61;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;box-shadow:0 3px 10px rgba(12,122,97,0.3);">
                  Check Status in CD4 App
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94A3B8;">&copy; 2026 CD4 Health. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return sendResendEmail({ to: args.toEmail, subject, html });
};

/**
 * 4. APPOINTMENT CANCELLED EMAIL
 */
export const sendAppointmentCancelledEmail = async (args: {
  toEmail: string;
  recipientName: string;
  doctorName: string;
  slotDate: string;
  slotTime: string;
  cancelledBy: "doctor" | "patient" | string;
  refundStatus?: string;
  appointmentId?: string;
}) => {
  const recipient = sanitizeText(args.recipientName) || "Valued User";
  const doctor = sanitizeText(args.doctorName) || "Doctor";
  const date = sanitizeText(args.slotDate) || "Scheduled Date";
  const time = sanitizeText(args.slotTime) || "Scheduled Time";
  const byWho = args.cancelledBy === "doctor" ? "Doctor" : "You (Patient)";
  const appointmentId = sanitizeText(args.appointmentId);
  const refundText = args.refundStatus || "If you paid for this consultation, a full refund has been initiated to your original payment method.";

  const subject = `Appointment Cancelled — Dr. ${doctor} | CD4 Health`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E293B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background:#FFFFFF;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 4px 18px rgba(0,0,0,0.05);overflow:hidden;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg, #475569 0%, #334155 100%);padding:32px 24px;text-align:center;">
              <div style="margin-bottom:12px;">
                <img src="${LOGO_URL}" alt="CD4 Health" width="130" style="display:inline-block;max-width:130px;height:auto;border-radius:10px;background:#ffffff;padding:8px 16px;box-shadow:0 3px 10px rgba(0,0,0,0.12);" />
              </div>
              <h1 style="margin:6px 0 0;color:#FFFFFF;font-size:22px;font-weight:700;">Appointment Cancelled</h1>
              <p style="margin:6px 0 0;color:#CBD5E1;font-size:14px;">Consultation session has been cancelled</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 16px;font-size:15px;color:#334155;">Dear <strong>${recipient}</strong>,</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#475569;">
                Your scheduled teleconsultation has been cancelled by <strong>${byWho}</strong>.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Doctor:</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:700;color:#0F172A;text-align:right;">Dr. ${doctor}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Date & Time:</td>
                        <td style="padding:6px 0;font-size:13px;font-weight:600;color:#0F172A;text-align:right;">${date} &bull; ${time}</td>
                      </tr>
                      ${appointmentId ? `
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:#64748B;">Booking ID:</td>
                        <td style="padding:6px 0;font-size:12px;font-family:monospace;color:#64748B;text-align:right;">${appointmentId}</td>
                      </tr>` : ""}
                    </table>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;margin:28px 0 20px;">
                <a href="https://cd4.co.in/open-app?target=appointments" target="_blank" style="display:inline-block;background-color:#0C7A61;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;box-shadow:0 3px 10px rgba(12,122,97,0.3);">
                  Check Status in CD4 App
                </a>
              </div>

              <div style="background:#F1F5F9;border:1px solid #CBD5E1;border-radius:10px;padding:14px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#334155;">
                  <strong>Refund Status:</strong> ${refundText}
                </p>
              </div>

              <div style="text-align:center;margin:28px 0 20px;">
                <a href="https://cd4.co.in/open-app?target=appointments" target="_blank" style="display:inline-block;background-color:#0C7A61;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;box-shadow:0 3px 10px rgba(12,122,97,0.3);">
                  Book Another Slot in CD4 App
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94A3B8;">&copy; 2026 CD4 Health. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return sendResendEmail({ to: args.toEmail, subject, html });
};

/**
 * 5. APPOINTMENT RESCHEDULED EMAIL
 */
export const sendAppointmentRescheduledEmail = async (args: {
  toEmail: string;
  patientName: string;
  doctorName: string;
  newDate: string;
  newTime: string;
  appointmentId?: string;
}) => {
  const patient = sanitizeText(args.patientName) || "Valued Patient";
  const doctor = sanitizeText(args.doctorName) || "Doctor";
  const newDate = sanitizeText(args.newDate) || "Updated Date";
  const newTime = sanitizeText(args.newTime) || "Updated Time";
  const appointmentId = sanitizeText(args.appointmentId);

  const subject = `Appointment Rescheduled — Dr. ${doctor} | CD4 Health`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1E293B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background:#FFFFFF;border-radius:16px;border:1px solid #E2E8F0;box-shadow:0 4px 18px rgba(0,0,0,0.05);overflow:hidden;" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:linear-gradient(135deg, #0C7A61 0%, #085241 100%);padding:32px 24px;text-align:center;">
              <div style="margin-bottom:12px;">
                <img src="${LOGO_URL}" alt="CD4 Health" width="130" style="display:inline-block;max-width:130px;height:auto;border-radius:10px;background:#ffffff;padding:8px 16px;box-shadow:0 3px 10px rgba(0,0,0,0.12);" />
              </div>
              <h1 style="margin:6px 0 0;color:#FFFFFF;font-size:22px;font-weight:700;">Appointment Rescheduled</h1>
              <p style="margin:6px 0 0;color:#A7F3D0;font-size:14px;">Your consultation has been moved to a new slot</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 16px;font-size:15px;color:#334155;">Dear <strong>${patient}</strong>,</p>
              <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#475569;">
                Your appointment with <strong>Dr. ${doctor}</strong> has been successfully rescheduled to:
              </p>

              <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
                <p style="margin:0;font-size:12px;color:#166534;font-weight:600;text-transform:uppercase;">NEW CONFIRMED SLOT</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:800;color:#0C7A61;">${newDate} &bull; ${newTime}</p>
              </div>

              ${appointmentId ? `
              <p style="margin:0 0 20px;font-size:12px;font-family:monospace;color:#64748B;text-align:center;">
                Booking ID: ${appointmentId}
              </p>` : ""}

              <div style="text-align:center;margin:28px 0 20px;">
                <a href="https://cd4.co.in/open-app?target=appointments" target="_blank" style="display:inline-block;background-color:#0C7A61;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;box-shadow:0 3px 10px rgba(12,122,97,0.3);">
                  View Updated Consultation in CD4 App
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:20px 24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94A3B8;">&copy; 2026 CD4 Health. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return sendResendEmail({ to: args.toEmail, subject, html });
};

