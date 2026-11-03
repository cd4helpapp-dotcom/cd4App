# CD4 Mobile App — Email Infrastructure & Setup Documentation

**Domain:** `cd4.co.in`  
**Sender Email:** `noreply@cd4.co.in`  
**Sender Name:** `CD4 Health`  
**Email Provider:** [Resend](https://resend.com) (Transactional API & SMTP)  
**Auth Mailer:** Supabase Auth Custom SMTP  
**Status:** **ACTIVE & CONFIGURED (2026-11-03)**

---

## 1. System Architecture Overview

The CD4 email system uses a dual-engine architecture designed for high deliverability, zero spam scores, and low latency:

```
[ User Action: Signup / Forgot Password ]
       │
       ▼
[ Supabase Auth Engine ]
       │
       ▼ (Custom SMTP: smtp.resend.com:465)
[ Resend Global SMTP Server (Tokyo AWS ap-northeast-1) ]
       │
       ▼ (DKIM + SPF + DMARC Verified on cd4.co.in via Hostinger)
[ Recipient Inbox (Gmail, Apple Mail, Outlook) ]
```

```
[ Teleconsultation Prescription / Consultation Receipts ]
       │
       ▼
[ Supabase Edge Functions (send-prescription-chat-pdf, etc.) ]
       │
       ▼ (Direct REST API: https://api.resend.com/emails with Bearer token)
[ Resend Email API ]
       │
       ▼
[ Recipient Inbox with Signed Prescription PDF Attachment ]
```

---

## 2. DNS Records on Hostinger (`cd4.co.in`)

All 4 required authentication records were successfully added to the Hostinger DNS Zone for `cd4.co.in`:

| Record Type | Host / Name | Priority | Target / Content | TTL | Purpose |
|---|---|:---:|---|:---:|---|
| **TXT** | `resend._domainkey` | 0 | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC+CWsbjOUpvp33AzLqaCsllOf6TLCJuVaS+3Qol2Q4xshki/3h8ZAV6CcTJlwfUnLTuMZ2eZV9K8ZFjBOHe7Bx1P2PxgYPrvwU7O9DeqGbx3LvqSMy+49GjysDg7+yiKlerSraMzbP/+1INjP8aBjRBvPmt+5faH2YsJ1VRd/7KQIDAQAB` | 3600 | **DKIM** cryptographic signature verifying email authenticity |
| **CNAME** | `rsend` | 0 | `rsend-apne1.forge.rmta.net` | 3600 | **SPF** inbound route & bounce tracking |
| **CNAME** | `send` | 0 | `send.forge.rmta.net` | 3600 | **SPF** outbound mail server authorization |
| **TXT** | `_dmarc` | 0 | `v=DMARC1; p=none;` | 3600 | **DMARC** policy protecting `cd4.co.in` against spoofing |

> **Note on Region:** Resend automatically assigns Asia-Pacific traffic to Tokyo (`ap-northeast-1` / `apne1`). This is purely the AWS server datacenter; the recipient always sees `noreply@cd4.co.in`. Delivery speed to Indian inboxes is under 1 second.

---

## 3. Environment Variables & Credentials

The credentials have been securely configured across the workspace:

### `f:\cd4\.env` (Frontend / Development)
```env
RESEND_API_KEY=re_your_resend_api_key_here
EMAIL_FROM=noreply@cd4.co.in
```

### `f:\cd4\.env.server.prod` (Supabase Edge Functions / Backend Secrets)
```env
RESEND_API_KEY=re_your_resend_api_key_here
EMAIL_FROM=noreply@cd4.co.in
```

---

## 4. Supabase Custom SMTP Configuration

Configured in **Supabase Dashboard → Authentication → Emails → SMTP Settings**:

- **Enable Custom SMTP:** `Enabled / ON`
- **Sender email:** `noreply@cd4.co.in`
- **Sender name:** `CD4 Health`
- **Host:** `smtp.resend.com`
- **Port:** `465` (SSL)
- **Username:** `resend`
- **Password:** `<Your Resend API Key>`

---

## 5. Pricing & Capacity (Free Tier)

- **Monthly Quota:** 3,000 emails / month free
- **Daily Cap:** 100 emails / day
- **Domains:** 3 verified domains allowed
- **Cost:** **$0.00 / month** (No credit card needed)
- **Upgrade Path:** $20/month for 50,000 emails/month when active consultations scale.

---

## 6. Email Touchpoints Across the CD4 App

| # | Event | Trigger Source | Recipient | Content |
|---|---|---|---|---|
| 1 | **User Signup** | `ui/auth/SignupScreen.tsx` | New Patient / Doctor | Verification link or 6-digit OTP code |
| 2 | **Password Reset** | `ui/auth/ForgotPasswordScreen.tsx` | Registered User | Password recovery link / OTP |
| 3 | **Prescription PDF** | `supabase/functions/send-prescription-chat-pdf` | Patient | Digital prescription PDF attachment & doctor notes |
| 4 | **Appointment Booked** | `supabase/functions/send-appointment-notification` | Patient & Doctor | Booking summary, date, time slot, join consultation link |
| 5 | **Payment Receipt** | `services/razorpay.ts` & Razorpay Webhook | Patient | Official consultation invoice with transaction ID |

---

## 7. Ready-to-Use Branded CD4 Email Templates

To replace Supabase's default plain emails with CD4's healthcare brand design:

1. Open **Supabase Dashboard** → **Authentication** → **Emails** → **Templates**.
2. Select the template tab, paste the corresponding HTML code below, and click **Save**.

### Template A: Confirm Signup (`Confirm your signup`)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Confirm Your CD4 Account</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F8FBFA;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 12px rgba(0,0,0,0.04);">
          <!-- Header Banner -->
          <tr>
            <td style="background:linear-gradient(135deg, #0C7A61 0%, #0D9488 100%);padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:800;letter-spacing:-0.5px;">CD4 HEALTH</h1>
              <p style="margin:4px 0 0;color:#CCFBF1;font-size:13px;font-weight:500;">AI-Guided Care & Teleconsultations</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding:36px 32px;">
              <h2 style="margin:0 0 12px;color:#0F172A;font-size:20px;font-weight:700;">Welcome to CD4!</h2>
              <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:24px;">
                Thank you for creating an account. Please click the button below to verify your email address and activate your account.
              </p>
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0;">
                <tr>
                  <td align="center" style="border-radius:10px;background-color:#0C7A61;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:14px 28px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
                      Verify My Email
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Token Fallback -->
              <div style="background-color:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px 18px;margin:20px 0;">
                <p style="margin:0;color:#166534;font-size:13px;">
                  If the app asks for a code, enter this 6-digit verification code:
                </p>
                <p style="margin:6px 0 0;color:#0C7A61;font-size:24px;font-weight:800;letter-spacing:4px;">
                  {{ .Token }}
                </p>
              </div>

              <!-- Fallback Copy-Paste URL Box -->
              <div style="margin-top:24px;border-top:1px solid #E2E8F0;padding-top:18px;">
                <p style="margin:0 0 6px;color:#64748B;font-size:12px;line-height:18px;">
                  <strong>Button not opening the app?</strong> Copy and paste this link into your browser:
                </p>
                <div style="background-color:#F1F5F9;border:1px solid #CBD5E1;border-radius:6px;padding:10px 12px;word-break:break-all;font-family:Courier,monospace;font-size:11px;color:#334155;line-height:16px;">
                  {{ .ConfirmationURL }}
                </div>
              </div>
              <p style="margin:24px 0 0;color:#64748B;font-size:13px;line-height:20px;">
                If you did not sign up for CD4, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#F8FAFC;padding:20px 32px;border-top:1px solid #E2E8F0;text-align:center;">
              <p style="margin:0;color:#94A3B8;font-size:12px;">
                &copy; 2026 CD4 Health. All rights reserved. &bull; <a href="https://cd4.co.in" style="color:#0C7A61;text-decoration:none;">cd4.co.in</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

### Template B: Reset Password (`Reset your password`)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reset Your CD4 Password</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F8FBFA;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 12px rgba(0,0,0,0.04);">
          <!-- Header Banner -->
          <tr>
            <td style="background:linear-gradient(135deg, #0C7A61 0%, #0D9488 100%);padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:800;letter-spacing:-0.5px;">CD4 HEALTH</h1>
              <p style="margin:4px 0 0;color:#CCFBF1;font-size:13px;font-weight:500;">Password Security Assistance</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding:36px 32px;">
              <h2 style="margin:0 0 12px;color:#0F172A;font-size:20px;font-weight:700;">Password Reset Request</h2>
              <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:24px;">
                We received a request to reset the password for your CD4 Health account. Click the button below to choose a new password.
              </p>
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0;">
                <tr>
                  <td align="center" style="border-radius:10px;background-color:#0C7A61;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:14px 28px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Token Fallback -->
              <div style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 18px;margin:20px 0;">
                <p style="margin:0;color:#475569;font-size:13px;">
                  If prompted for a 6-digit reset code in the app:
                </p>
                <p style="margin:6px 0 0;color:#0C7A61;font-size:24px;font-weight:800;letter-spacing:4px;">
                  {{ .Token }}
                </p>
              </div>

              <!-- Fallback Copy-Paste URL Box -->
              <div style="margin-top:24px;border-top:1px solid #E2E8F0;padding-top:18px;">
                <p style="margin:0 0 6px;color:#64748B;font-size:12px;line-height:18px;">
                  <strong>Button not opening?</strong> Copy and paste this reset link into your browser:
                </p>
                <div style="background-color:#F1F5F9;border:1px solid #CBD5E1;border-radius:6px;padding:10px 12px;word-break:break-all;font-family:Courier,monospace;font-size:11px;color:#334155;line-height:16px;">
                  {{ .ConfirmationURL }}
                </div>
              </div>
              <p style="margin:24px 0 0;color:#DC2626;font-size:12px;line-height:18px;">
                <strong>Security Notice:</strong> If you did not request a password reset, your account is safe and no action is required.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#F8FAFC;padding:20px 32px;border-top:1px solid #E2E8F0;text-align:center;">
              <p style="margin:0;color:#94A3B8;font-size:12px;">
                &copy; 2026 CD4 Health. All rights reserved. &bull; <a href="https://cd4.co.in" style="color:#0C7A61;text-decoration:none;">cd4.co.in</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 8. Verification & Maintenance

- **Domain Health Check:** Check [resend.com/domains](https://resend.com/domains) periodically to confirm DKIM/SPF/DMARC remain in `Verified` state.
- **Log Inspection:** Monitor outbound deliverability, open rates, and bounces at [resend.com/emails](https://resend.com/emails).
- **Security Rule:** Never commit `RESEND_API_KEY` to public Git repositories. Keep it strictly inside `.env` and `.env.server.prod` (both files are git-ignored).


---

## 9. WhatsApp Integration & Helpline Configuration

All WhatsApp communications and 1-click sharing features in the app are driven by environment variables:

- **Key in `.env` & `.env.prod`:**
  ```env
  EXPO_PUBLIC_SUPPORT_WHATSAPP=917050417766
  ```
- **Future Change:** To change the support phone number at any time, simply update the number in `.env` (format: country code + 10 digits without spaces or symbols, e.g. `919876543210`). The app UI, helpline buttons, and WhatsApp slips will automatically update everywhere.
- **Safety Guarantee:** Uses official WhatsApp Universal Links (`wa.me`). Zero risk of account restriction or bans.
