import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_DATA_FILE = 'supabase/seed/india_dummy_doctors.json';
const DEFAULT_PASSWORD = process.env.DUMMY_DOCTOR_PASSWORD || 'CD4@12345';

const normalizeExperience = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '0 Years';
  return `${Math.round(numeric)} Years`;
};

const normalizeFee = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '₹0';
  return `₹${Math.round(numeric)}`;
};

const parseGender = (value) => {
  if (value === 'Male' || value === 'Female' || value === 'Other') return value;
  return 'Other';
};

const parseStringArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
};

const stripWrappingQuotes = (value) => {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
};

const loadDotEnvFile = async (filename) => {
  const filePath = path.resolve(process.cwd(), filename);
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const index = normalized.indexOf('=');
    if (index <= 0) continue;
    const key = normalized.slice(0, index).trim();
    const valueRaw = normalized.slice(index + 1).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripWrappingQuotes(valueRaw);
  }
};

const fail = (message) => {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args.find((item) => item.startsWith('--file='));
const sourceFile = fileArg ? fileArg.slice('--file='.length).trim() : DEFAULT_DATA_FILE;

const run = async () => {
  await loadDotEnvFile('.env');
  await loadDotEnvFile('.env.local');

  const runtimeSupabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const runtimeServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_SERVICE_KEY;

  const absolutePath = path.resolve(process.cwd(), sourceFile);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const dataset = JSON.parse(raw);
  if (!Array.isArray(dataset) || dataset.length === 0) {
    fail('Seed dataset is empty. Add at least one doctor object.');
  }

  console.log(`Loaded ${dataset.length} doctors from ${absolutePath}`);

  if (dryRun) {
    console.log('Dry run mode: JSON validated. No DB writes performed.');
    return;
  }

  if (!runtimeSupabaseUrl) fail('SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) is required.');
  if (!runtimeServiceRoleKey) {
    fail(
      'SUPABASE_SERVICE_ROLE_KEY is required for seeding. You can also use SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE.'
    );
  }

  const supabase = createClient(runtimeSupabaseUrl, runtimeServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: doctorRoleRow, error: roleError } = await supabase
    .from('roles')
    .select('id')
    .eq('slug', 'doctor')
    .maybeSingle();

  if (roleError || !doctorRoleRow?.id) {
    fail(`Doctor role not found in roles table. ${roleError?.message || ''}`.trim());
  }
  const doctorRoleId = doctorRoleRow.id;

  let createdUsers = 0;
  let existingUsers = 0;
  let upsertedDoctors = 0;

  for (const [index, item] of dataset.entries()) {
    const line = `#${index + 1}`;
    const email = String(item.email || '').trim().toLowerCase();
    const firstName = String(item.first_name || '').trim();
    const lastName = String(item.last_name || '').trim();
    const city = String(item.city || '').trim();
    const specialization = String(item.specialization || '').trim();
    const registrationNumber = String(item.registration_number || '').trim();

    if (!email || !firstName || !city || !specialization || !registrationNumber) {
      console.warn(`${line} skipped: missing required values (email/first_name/city/specialization/registration_number).`);
      continue;
    }

    const phoneNumber = String(item.phone_number || '').trim() || null;
    const gender = parseGender(item.gender);
    const experience = normalizeExperience(item.experience_years);
    const fee = normalizeFee(item.fee_inr);
    const bio = String(item.bio || '').trim();
    const rating = Number(item.rating);
    const registrationCouncil = String(item.registration_council || '').trim();
    const degree = String(item.degree || '').trim();
    const university = String(item.university || '').trim();
    const completionYear = Number(item.year_of_completion);
    const currentHospitalClinic = String(item.current_hospital_clinic || '').trim();
    const previousWork = String(item.previous_work_details || '').trim();
    const areasOfExpertise = parseStringArray(item.areas_of_expertise);
    const languagesSpoken = parseStringArray(item.languages_spoken);
    const treatmentApproach = String(item.treatment_approach || 'Audio + Video').trim();
    const kycDocumentUrls = parseStringArray(item.kyc_document_urls);
    const score = Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 4.5;

    let userId = null;

    const { data: existingProfile, error: profileLookupError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    if (profileLookupError) {
      throw new Error(`${line} profile lookup failed: ${profileLookupError.message}`);
    }

    if (existingProfile?.id) {
      userId = existingProfile.id;
      existingUsers += 1;
      console.log(`${line} existing auth/profile found for ${email}`);
    } else {
      const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        user_metadata: {
          role: 'doctor',
          first_name: firstName,
          last_name: lastName,
          city,
          specialization,
          experience,
          fee,
          bio,
          registration_number: registrationNumber,
        },
      });

      if (createError || !createdUser?.user?.id) {
        throw new Error(`${line} auth user creation failed for ${email}: ${createError?.message || 'unknown error'}`);
      }
      userId = createdUser.user.id;
      createdUsers += 1;
      console.log(`${line} created auth user for ${email}`);
    }

    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({
        first_name: firstName,
        last_name: lastName || 'Doctor',
        phone_number: phoneNumber,
        gender,
        role_id: doctorRoleId,
        profile_setup_completed: true,
        is_verified: true,
      })
      .eq('id', userId);

    if (profileUpdateError) {
      throw new Error(`${line} profile update failed for ${email}: ${profileUpdateError.message}`);
    }

    const { error: doctorUpsertError } = await supabase
      .from('doctors')
      .upsert(
        {
          id: userId,
          city,
          specialization,
          experience,
          fee,
          bio,
          rating: score,
          registration_number: registrationNumber,
          registration_council: registrationCouncil || null,
          kyc_verify: true,
          is_verified: true,
          documents: kycDocumentUrls,
          degree: degree || null,
          university: university || null,
          year_of_completion: Number.isInteger(completionYear) ? completionYear : null,
          current_hospital_clinic: currentHospitalClinic || null,
          previous_work_details: previousWork || null,
          areas_of_expertise: areasOfExpertise,
          languages_spoken: languagesSpoken,
          treatment_approach: treatmentApproach || null,
          profile_completion_done: true,
          profile_completion_done_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (doctorUpsertError) {
      throw new Error(`${line} doctor upsert failed for ${email}: ${doctorUpsertError.message}`);
    }

    upsertedDoctors += 1;
    console.log(`${line} doctor row upserted (${firstName} ${lastName || ''} / ${city} / ${specialization})`);
  }

  console.log('\nDummy doctor seed completed.');
  console.log(`Created auth users : ${createdUsers}`);
  console.log(`Existing auth users: ${existingUsers}`);
  console.log(`Doctor rows upsert : ${upsertedDoctors}`);
  console.log(`Default password  : ${DEFAULT_PASSWORD}`);
};

run().catch((error) => {
  fail(error?.message || 'Unexpected seeding error.');
});
