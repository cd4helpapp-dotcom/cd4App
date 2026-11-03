import fs from 'fs';
import path from 'path';

const apiKey = process.env.RESEND_API_KEY || '';
const toEmail = 'nitesh2kaushik@gmail.com';
const fromEmail = 'CD4 Health <noreply@cd4.co.in>';

async function sendTestEmailWithLogo() {
  console.log(`Sending CD4 branded email with logo to: ${toEmail}...`);

  // Load CD4 logo and encode to base64
  const logoPath = path.resolve('assets/images/cd4_logo.png');
  const logoBytes = fs.readFileSync(logoPath);
  const logoBase64 = logoBytes.toString('base64');

  const demoActionUrl = 'https://cd4.co.in/auth/verify?token=CD4-SECURE-DEMO-TOKEN';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background-color:#F8FBFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F8FBFA;padding:40px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" style="max-width:540px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 14px rgba(0,0,0,0.05);">
              
              <!-- Brand Header with CD4 Logo -->
              <tr>
                <td style="background:linear-gradient(135deg, #0C7A61 0%, #0D9488 100%);padding:32px;text-align:center;">
                  <img src="cid:cd4-logo" alt="CD4 Health" width="120" style="display:inline-block;max-width:120px;height:auto;border-radius:8px;background:#ffffff;padding:8px 14px;box-shadow:0 2px 8px rgba(0,0,0,0.12);" />
                  <p style="margin:12px 0 0;color:#CCFBF1;font-size:14px;font-weight:600;letter-spacing:0.5px;">CD4 HEALTHCARE SERVICES</p>
                </td>
              </tr>

              <!-- Main Content Card -->
              <tr>
                <td style="padding:36px 32px;">
                  <h2 style="margin:0 0 12px;color:#0F172A;font-size:21px;font-weight:800;">Email & Account Verification</h2>
                  <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:24px;">
                    Hi <strong>Nitesh</strong>,<br><br>
                    Welcome to CD4 Health! Please verify your email address to activate your patient dashboard and access verified doctors and AI guidance.
                  </p>

                  <!-- Primary Action Button -->
                  <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 24px;">
                    <tr>
                      <td align="center" style="border-radius:10px;background-color:#0C7A61;">
                        <a href="${demoActionUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.3px;">
                          Verify Account &rarr;
                        </a>
                      </td>
                    </tr>
                  </table>

                  <!-- 6-Digit OTP Box -->
                  <div style="background-color:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px;margin:20px 0;text-align:center;">
                    <p style="margin:0;color:#166534;font-size:13px;font-weight:600;">Or enter this 6-digit verification code in the app:</p>
                    <p style="margin:8px 0 0;color:#0C7A61;font-size:28px;font-weight:800;letter-spacing:6px;">849201</p>
                  </div>

                  <!-- Fallback URL Copy-Paste Box -->
                  <div style="margin-top:28px;border-top:1px solid #E2E8F0;padding-top:20px;">
                    <p style="margin:0 0 8px;color:#64748B;font-size:13px;line-height:18px;">
                      <strong>Button or link not opening?</strong> Copy and paste this URL into your browser:
                    </p>
                    <div style="background-color:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;padding:10px 14px;word-break:break-all;font-family:Courier, monospace;font-size:12px;color:#334155;line-height:18px;">
                      ${demoActionUrl}
                    </div>
                  </div>

                  <!-- Security Warning -->
                  <p style="margin:24px 0 0;color:#94A3B8;font-size:12px;line-height:18px;">
                    This link will expire in 24 hours. If you did not request this verification, please contact us immediately.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color:#F8FAFC;padding:24px 32px;border-top:1px solid #E2E8F0;text-align:center;">
                  <p style="margin:0;color:#64748B;font-size:13px;font-weight:600;">CD4 Health Technologies</p>
                  <p style="margin:6px 0 0;color:#94A3B8;font-size:12px;">
                    support@cd4.co.in &bull; <a href="https://cd4.co.in" style="color:#0C7A61;text-decoration:none;">https://cd4.co.in</a>
                  </p>
                  <p style="margin:10px 0 0;color:#CBD5E1;font-size:11px;">
                    Confidential &bull; Telemedicine & Health Information Privacy Compliant
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: 'CD4 Health — Account Verification & Consultation Access',
        html,
        attachments: [
          {
            filename: 'cd4_logo.png',
            content: logoBase64,
            content_id: 'cd4-logo',
            contentId: 'cd4-logo',
          },
        ],
      }),
    });

    const data = await response.json();
    if (response.ok) {
      console.log('SUCCESS! Branded email with logo and copy-paste link sent.');
      console.log('Resend Delivery ID:', data.id);
    } else {
      console.error('ERROR from Resend:', response.status, data);
    }
  } catch (err) {
    console.error('Network exception:', err.message);
  }
}

sendTestEmailWithLogo();
