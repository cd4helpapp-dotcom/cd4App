import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../src/lib/supabase';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';
import { uploadDoctorSignature, type PickedSignature } from '../src/services/doctorSignature';

const PENDING_REG_PREFIX = 'cd4_pending_doctor_reg_';
const PROFILE_MEDIA_BUCKET = SUPABASE_PROFILE_MEDIA_BUCKET;
const PROFILE_MEDIA_FOLDER = 'profile-pictures';
const KYC_BUCKET = 'doctor-kyc';

export interface PendingDoctorRegistration {
  userId: string;
  email: string;
  profileImageUri?: string | null;
  kycDocUris?: string[];
  signature?: PickedSignature | null;
  formData: {
    city: string;
    specialization: string;
    experience: string;
    fee: string;
    registrationNumber: string;
    bio: string;
  };
  savedAt: string;
}

export const savePendingDoctorRegistration = async (
  data: Omit<PendingDoctorRegistration, 'savedAt'>
): Promise<void> => {
  try {
    const payload: PendingDoctorRegistration = {
      ...data,
      savedAt: new Date().toISOString(),
    };
    const key = `${PENDING_REG_PREFIX}${data.userId}`;
    await AsyncStorage.setItem(key, JSON.stringify(payload));
    if (data.email) {
      await AsyncStorage.setItem(
        `${PENDING_REG_PREFIX}email_${data.email.trim().toLowerCase()}`,
        JSON.stringify(payload)
      );
    }
  } catch (error) {
    console.warn('Failed to save pending doctor registration to storage:', error);
  }
};

export const syncPendingDoctorRegistration = async (
  userId: string,
  userEmail?: string
): Promise<boolean> => {
  if (!userId) return false;

  try {
    // 1. Check for pending registration
    let stored = await AsyncStorage.getItem(`${PENDING_REG_PREFIX}${userId}`);
    if (!stored && userEmail) {
      stored = await AsyncStorage.getItem(
        `${PENDING_REG_PREFIX}email_${userEmail.trim().toLowerCase()}`
      );
    }
    if (!stored) return false;

    const data: PendingDoctorRegistration = JSON.parse(stored);

    // 2. Ensure active Supabase session
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.access_token) {
      return false; // Can only sync once user is authenticated
    }

    // 3. Upload Profile Image if provided
    let profileImageUrl = '';
    if (data.profileImageUri) {
      try {
        const fileExt = data.profileImageUri.split('.').pop() || 'jpg';
        const fileName = `${PROFILE_MEDIA_FOLDER}/${userId}/profile.${fileExt}`;
        const response = await fetch(data.profileImageUri);
        if (response.ok) {
          const blob = await response.blob();
          const { error: uploadError } = await supabase.storage
            .from(PROFILE_MEDIA_BUCKET)
            .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

          if (!uploadError) {
            profileImageUrl = fileName;
            await supabase
              .from('profiles')
              .update({ profile_picture: fileName })
              .eq('id', userId);
          }
        }
      } catch (imgError) {
        console.warn('Failed to upload pending profile image:', imgError);
      }
    }

    // 4. Upload KYC Documents if provided
    const kycPaths: string[] = [];
    if (data.kycDocUris && data.kycDocUris.length > 0) {
      for (let i = 0; i < data.kycDocUris.length; i++) {
        const docUri = data.kycDocUris[i];
        try {
          const fileExt = docUri.split('.').pop() || 'jpg';
          const fileName = `${userId}/kyc_${i}.${fileExt}`;
          const response = await fetch(docUri);
          if (response.ok) {
            const blob = await response.blob();
            const { error: uploadError } = await supabase.storage
              .from(KYC_BUCKET)
              .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

            if (!uploadError) {
              kycPaths.push(`${KYC_BUCKET}/${fileName}`);
            }
          }
        } catch (kycError) {
          console.warn(`Failed to upload pending KYC document ${i}:`, kycError);
        }
      }
    }

    // 5. Update Doctors table
    const doctorUpdates: Record<string, any> = {
      id: userId,
      city: data.formData.city,
      specialization: data.formData.specialization,
      experience: data.formData.experience,
      fee: data.formData.fee,
      bio: data.formData.bio,
      registration_number: data.formData.registrationNumber,
    };
    if (profileImageUrl) {
      doctorUpdates.image = profileImageUrl;
    }
    if (kycPaths.length > 0) {
      doctorUpdates.documents = kycPaths;
    }

    const { error: doctorError } = await supabase
      .from('doctors')
      .upsert(doctorUpdates, { onConflict: 'id' });

    if (doctorError) {
      console.warn('Failed to upsert pending doctor data:', doctorError.message);
    }

    // 6. Upload Signature if provided
    if (data.signature) {
      await uploadDoctorSignature(userId, data.signature).catch((sigError) => {
        console.warn('Could not upload pending doctor signature:', sigError?.message);
      });
    }

    // 7. Cleanup storage on success
    await AsyncStorage.removeItem(`${PENDING_REG_PREFIX}${userId}`);
    if (data.email) {
      await AsyncStorage.removeItem(
        `${PENDING_REG_PREFIX}email_${data.email.trim().toLowerCase()}`
      );
    }

    return true;
  } catch (error) {
    console.warn('Error syncing pending doctor registration:', error);
    return false;
  }
};
