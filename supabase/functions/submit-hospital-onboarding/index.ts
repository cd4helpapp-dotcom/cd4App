import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "hospital-onboarding-docs";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
};

const clip = (value: string, maxLength = 1000): string =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

const asText = (formData: FormData, key: string, maxLength = 1000): string => {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return clip(value.trim().replace(/\s+/g, " "), maxLength);
};

const asLongText = (formData: FormData, key: string, maxLength = 4000): string => {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return clip(value.trim(), maxLength);
};

const asInteger = (formData: FormData, key: string): number | null => {
  const value = asText(formData, key, 32).replace(/[^\d]/g, "");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const asBoolean = (formData: FormData, key: string): boolean => {
  const value = formData.get(key);
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ["yes", "true", "1", "on"].includes(normalized);
};

const asStringArray = (formData: FormData, key: string): string[] =>
  formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
    .slice(0, 40);

const asDateOrNull = (formData: FormData, key: string): string | null => {
  const value = asText(formData, key, 32);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const getOpdTimings = (formData: FormData): string => {
  const existing = asText(formData, "opd_timings", 240);
  if (existing) return existing;

  const days = asText(formData, "opd_days", 80);
  const start = asText(formData, "opd_start_time", 20);
  const end = asText(formData, "opd_end_time", 20);
  if (!days || !start || !end) return "";
  return `${days}, ${start} - ${end}`;
};

const normalizeFileName = (value: string): string =>
  (value || "document")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "document";

const isFileLike = (value: FormDataEntryValue | null): value is File =>
  typeof File !== "undefined" && value instanceof File && value.size > 0;

const uploadOptionalFile = async (
  serviceClient: ReturnType<typeof createClient>,
  formData: FormData,
  fieldName: string,
  requestId: string
): Promise<string | null> => {
  const value = formData.get(fieldName);
  if (!isFileLike(value)) return null;

  if (value.size > MAX_FILE_BYTES) {
    throw new Error(`${fieldName}_too_large`);
  }

  const contentType = value.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    throw new Error(`${fieldName}_unsupported_type`);
  }

  const safeName = normalizeFileName(value.name || `${fieldName}.pdf`);
  const objectPath = `${requestId}/${Date.now()}_${fieldName}_${safeName}`;
  const fileBytes = new Uint8Array(await value.arrayBuffer());

  const { error } = await serviceClient.storage
    .from(BUCKET)
    .upload(objectPath, fileBytes, {
      contentType,
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`${fieldName}_upload_failed:${error.message}`);
  }

  return `${BUCKET}/${objectPath}`;
};

const getSubmittedIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "";
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, message: "method_not_allowed" }, 405);
  }

  try {
    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return jsonResponse({ success: false, message: "service_env_missing" }, 500);
    }

    const formData = await req.formData();
    const botField = asText(formData, "bot-field", 200);
    if (botField) {
      return jsonResponse({ success: true, ignored: true });
    }

    const requiredFields = [
      "registered_name",
      "facility_type",
      "registration_number",
      "registering_authority",
      "full_address",
      "city",
      "state",
      "pin_code",
      "authorized_person_name",
      "designation",
      "mobile_number",
      "official_email",
      "hospital_login_email",
      "hospital_login_password",
      "hospital_login_password_confirm",
      "appointment_mode",
    ];

    const missingFields = requiredFields.filter((field) => !asText(formData, field, 200));
    const opdTimings = getOpdTimings(formData);
    if (!opdTimings) {
      missingFields.push("opd_timings");
    }
    if (missingFields.length > 0) {
      return jsonResponse({ success: false, message: "missing_required_fields", missingFields }, 400);
    }

    const officialEmail = normalizeEmail(asText(formData, "official_email", 254));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officialEmail)) {
      return jsonResponse({ success: false, message: "invalid_email" }, 400);
    }

    const hospitalLoginEmail = normalizeEmail(asText(formData, "hospital_login_email", 254));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hospitalLoginEmail)) {
      return jsonResponse({ success: false, message: "invalid_login_email" }, 400);
    }

    const hospitalLoginPassword = asText(formData, "hospital_login_password", 200);
    const hospitalLoginPasswordConfirm = asText(formData, "hospital_login_password_confirm", 200);
    if (hospitalLoginPassword.length < 8) {
      return jsonResponse({ success: false, message: "password_too_short" }, 400);
    }
    if (hospitalLoginPassword !== hospitalLoginPasswordConfirm) {
      return jsonResponse({ success: false, message: "password_mismatch" }, 400);
    }

    const pinCode = asText(formData, "pin_code", 16).replace(/[^\d]/g, "");
    if (!/^\d{6}$/.test(pinCode)) {
      return jsonResponse({ success: false, message: "invalid_pin_code" }, 400);
    }

    if (!asBoolean(formData, "authorization_confirmed")) {
      return jsonResponse({ success: false, message: "authorization_required" }, 400);
    }

    const specialities = asStringArray(formData, "specialities");
    if (specialities.length === 0) {
      return jsonResponse({ success: false, message: "at_least_one_speciality_required" }, 400);
    }

    const facilities = asStringArray(formData, "facilities");

    const requestId = crypto.randomUUID();
    const uploadedPaths = (
      await Promise.all([
        uploadOptionalFile(serviceClient, formData, "registration_certificate", requestId),
        uploadOptionalFile(serviceClient, formData, "additional_compliance_document", requestId),
      ])
    ).filter((path): path is string => Boolean(path));

    if (uploadedPaths.length === 0) {
      return jsonResponse({ success: false, message: "registration_certificate_required" }, 400);
    }

    const { data: existingProfile, error: existingProfileError } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("email", hospitalLoginEmail)
      .maybeSingle();

    if (existingProfileError) {
      return jsonResponse({ success: false, message: `login_email_check_failed:${existingProfileError.message}` }, 500);
    }

    if (existingProfile?.id) {
      return jsonResponse({ success: false, message: "login_email_already_registered" }, 409);
    }

    const registeredName = asText(formData, "registered_name", 240);
    const contactName = asText(formData, "authorized_person_name", 180);
    const mobileNumber = asText(formData, "mobile_number", 40);
    const { data: hospitalAuthData, error: hospitalAuthError } = await serviceClient.auth.admin.createUser({
      email: hospitalLoginEmail,
      password: hospitalLoginPassword,
      email_confirm: true,
      user_metadata: {
        role: "hospital",
        first_name: registeredName,
        last_name: "Hospital",
        phone: mobileNumber,
        hospital_name: registeredName,
        authorized_person_name: contactName,
        onboarding_request_id: requestId,
      },
    });

    if (hospitalAuthError || !hospitalAuthData?.user?.id) {
      return jsonResponse({
        success: false,
        message: `hospital_account_create_failed:${hospitalAuthError?.message || "missing_user_id"}`,
      }, 400);
    }

    const hospitalAdminUserId = hospitalAuthData.user.id;

    const row = {
      id: requestId,
      registered_name: registeredName,
      display_name: asText(formData, "display_name", 240) || null,
      facility_type: asText(formData, "facility_type", 120),
      ownership_type: asText(formData, "ownership_type", 120) || null,
      website: asText(formData, "website", 500) || null,
      years_in_operation: asInteger(formData, "years_in_operation"),
      hospital_description: asLongText(formData, "hospital_description", 2500) || null,
      registration_number: asText(formData, "registration_number", 160),
      registering_authority: asText(formData, "registering_authority", 240),
      registration_expiry: asDateOrNull(formData, "registration_expiry"),
      accreditation_status: asText(formData, "accreditation_status", 160) || null,
      tax_identifier: asText(formData, "tax_identifier", 80) || null,
      primary_document_link: asText(formData, "primary_document_link", 500) || null,
      available_documents: asStringArray(formData, "available_documents"),
      full_address: asLongText(formData, "full_address", 1600),
      city: asText(formData, "city", 120),
      state: asText(formData, "state", 120),
      pin_code: pinCode,
      google_maps_link: asText(formData, "google_maps_link", 500) || null,
      service_area: asText(formData, "service_area", 500) || null,
      authorized_person_name: contactName,
      designation: asText(formData, "designation", 160),
      mobile_number: mobileNumber,
      whatsapp_number: asText(formData, "whatsapp_number", 40) || null,
      official_email: officialEmail,
      backup_contact: asText(formData, "backup_contact", 40) || null,
      hospital_admin_user_id: hospitalAdminUserId,
      hospital_login_email: hospitalLoginEmail,
      app_account_status: "created_pending_review",
      specialities,
      facilities,
      appointment_mode: asText(formData, "appointment_mode", 120),
      opd_timings: opdTimings,
      initial_doctor_count: asInteger(formData, "initial_doctor_count"),
      consultation_fee_range: asText(formData, "consultation_fee_range", 160) || null,
      first_doctors_departments: asLongText(formData, "first_doctors_departments", 2500) || null,
      onboarding_priorities: asStringArray(formData, "onboarding_priorities"),
      go_live_timeline: asText(formData, "go_live_timeline", 120) || null,
      preferred_call_time: asText(formData, "preferred_call_time", 120) || null,
      referral_source: asText(formData, "referral_source", 200) || null,
      additional_notes: asLongText(formData, "additional_notes", 3000) || null,
      authorization_confirmed: true,
      whatsapp_contact_consent: asBoolean(formData, "whatsapp_contact_consent"),
      document_paths: uploadedPaths,
      submitted_ip: getSubmittedIp(req) || null,
      user_agent: req.headers.get("user-agent") || null,
      metadata: {
        source: "cd4-web-app",
        source_route: "/hospital-onboarding",
      },
    };

    const { error } = await serviceClient.from("hospital_onboarding_requests").insert(row);
    if (error) {
      await serviceClient.auth.admin.deleteUser(hospitalAdminUserId).catch(() => null);
      return jsonResponse({ success: false, message: `insert_failed:${error.message}` }, 500);
    }

    return jsonResponse({ success: true, id: requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return jsonResponse({ success: false, message }, 400);
  }
});
