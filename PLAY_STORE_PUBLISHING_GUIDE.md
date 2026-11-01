# 🚀 CD4 Google Play Store Publishing Guide

Comprehensive, step-by-step guide to publishing the **CD4 Health & Teleconsultation** app to the Google Play Store.

---

## 📌 Quick Summary & Links

| Item | Details |
| :--- | :--- |
| **Registration URL** | [Google Play Console Sign Up](https://play.google.com/console/signup) |
| **One-time Fee** | **$25 USD** (~₹2,100 INR) via International Credit/Debit Card |
| **Package Name** | `com.cd4.app` |
| **Target Build Type** | Android App Bundle (`.aab`) via EAS |
| **Mandatory Pages** | Privacy Policy, Terms of Service, In-App Account Deletion |

---

## 🛠️ Step 1: Generate Production Build (`.aab`)

Run the following command in your terminal from the project root:

```bash
eas build --platform android --profile production
```

* **Output:** EAS will build an optimized `.aab` (Android App Bundle).
* Once the build finishes on expo.dev, download the `.aab` file to your computer.

---

## 👤 Step 2: Google Play Console Account Setup

1. Open [play.google.com/console/signup](https://play.google.com/console/signup).
2. Choose account type:
   * **Personal Account (Individual):** Requires Government ID (Aadhaar / PAN / Passport / Driving License).
   * **Organization Account:** Requires Company Registration & D-U-N-S Number.
3. Pay the **$25 USD** one-time registration fee.
4. Upload your Government ID to complete **Identity Verification** (takes 24–48 hours).

---

## 📱 Step 3: Create App in Play Console

1. On the Play Console dashboard, click **"Create app"**.
2. Fill in the primary details:
   * **App name:** `CD4 - Doctor & AI Health Consultation`
   * **Default language:** `English (India)` or `English (United States)`
   * **App or game:** `App`
   * **Free or paid:** `Free`
3. Accept the Declarations and click **"Create app"**.

---

## 📋 Step 4: Complete "Set up your app" (Mandatory Declarations)

Go to **Policy and programs → App content** and complete each section:

### 1. Privacy Policy
* Paste your live privacy policy URL (e.g. `https://cd4helpapp.com/privacy-policy` or hosted link).

### 2. App Access (Google Reviewer Login)
* Select: **"All or some functionality is restricted"**
* Click **"Add new instructions"**:
  * **Account name:** `Google Review Demo`
  * **Username / Email:** `tester@cd4.app` (or your created demo patient account)
  * **Password:** *(Your demo password)*
  * **Instructions:** *"Use these credentials to log in as a patient and test doctor search, AI voice assistant, report analysis, and teleconsultation features."*

### 3. Ads
* Select: **"No, my app does not contain ads"**.

### 4. Content Rating Questionnaire
* Category: **Health / Medical / Utility**
* Violence, Sexual Content, Offensive Language: **No**
* User-generated content / sharing: **Yes (for doctor consultation chat & file sharing)**

### 5. Target Audience & Content
* Target Age: Select **18 and over**.
* Appeal to children: **No**.

### 6. Government Apps
* Select: **"No, this is not an official government app"**.

### 7. Financial Features / Health App Declaration
* Select: **Health & Fitness / Telehealth / Medical Information**.
* Declare that CD4 connects users with registered healthcare professionals and provides AI health information with medical disclaimers.

### 8. Data Safety Section
Declare the data collected and its purpose:
* **Personal info:** Name, Email, Phone number (App functionality & Account management).
* **Health info:** Symptoms, medical records, prescriptions (App functionality - Doctor consultation & AI triage).
* **Audio & Voice:** Microphone recordings (Voice AI Assistant & Teleconsultations).
* **Photos / Media:** Camera & Document files (Video consultation & Report upload).
* **Location:** Approximate & Precise Location (Finding nearby clinics and doctors).
* **Security Practices:**
  * Is data encrypted in transit? ➔ **Yes (HTTPS/TLS)**.
  * Can users request data deletion? ➔ **Yes (In-App: Settings → Help & Support → Delete account)**.

---

## 🎨 Step 5: Main Store Listing (Graphics & Descriptions)

### 1. Short Description (Max 80 chars):
```text
Consult verified doctors online, get AI voice guidance, and manage health records.
```

### 2. Full Description (Max 4000 chars):
```text
CD4 is your comprehensive digital healthcare companion, bringing certified doctor consultations, smart AI health triage, and seamless medical record management directly to your smartphone.

KEY FEATURES:

👨‍⚕️ 1-on-1 Doctor Teleconsultations:
Connect with verified specialists and general physicians through encrypted video calls, voice calls, and secure chat.

🎙️ Realtime AI Voice Health Assistant:
Speak your symptoms naturally to get instant triage guidance, specialty recommendations, and emergency warning flags.

📄 Smart Medical Report Analysis:
Upload lab reports and prescriptions to receive easy-to-understand summaries and follow-up guidance.

📍 Find Nearby Doctors & Clinics:
Discover top-rated healthcare providers, clinics, and hospitals in your local area.

📅 Easy Appointment Booking:
Book, reschedule, and manage doctor consultations with direct calendar reminders.

🔒 Private & Secure:
All health data, conversations, and records are encrypted with strict privacy controls. You can manage or delete your data at any time.

IMPORTANT MEDICAL DISCLAIMER:
CD4 connects users with licensed healthcare providers and provides informational AI triage support. The AI assistant does not provide medical diagnoses, prescriptions, or emergency treatment. If you are experiencing a medical emergency, please contact your local emergency services (112 / 102) or visit the nearest hospital emergency room immediately.
```

### 3. Graphic Assets Required:
* **App Icon:** `512 x 512 px` (32-bit PNG, max 1MB)
* **Feature Graphic Banner:** `1024 x 500 px` (JPG or 24-bit PNG, max 15MB)
* **Phone Screenshots:** At least 4 screenshots (aspect ratio 16:9 or 9:16, minimum 1080px resolution):
  1. Home / Doctor Discovery screen
  2. Doctor Profile & Appointment Booking
  3. AI Voice Assistant Dialog
  4. Video / Audio Teleconsultation
  5. Medical Reports / Health Records

---

## 🧪 Step 6: Testing & Production Rollout

### For Personal Developer Accounts (Created after Nov 2023):
1. Go to **Testing → Closed testing**.
2. Create a Closed Testing track (e.g. `Alpha Test`).
3. Upload the `.aab` file downloaded from Step 1.
4. Add **20 Testers** (email addresses of friends/colleagues with Android devices).
5. Testers must opt-in via Google Play link and keep the app installed for **14 consecutive days**.
6. After 14 days, the **"Apply for production"** button will be unlocked in your Play Console.

### For Organization Accounts:
1. Go directly to **Release → Production**.
2. Click **"Create new release"**.
3. Upload your `.aab` file.
4. Enter release notes:
   ```text
   Initial production release of CD4 - Doctor Teleconsultation & AI Health Assistant.
   ```
5. Click **"Review release"** ➔ **"Start rollout to Production"**.

---

## ⏳ Review Timeline
* Standard Google Play review typically takes **2 to 5 business days**.
* You will receive an email confirmation once the app is approved and Live on Google Play Store!
