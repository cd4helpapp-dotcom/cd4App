import { useQuery } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { resolveStorageSignedUrl } from '../src/utils/storageSignedUrl';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';

const parseOptionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
};

export interface PublicProfile {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  gender: string;
  age?: number;
  address?: string;
  weight?: number;
  bloodPressure?: string;
  pulse?: number;
  profilePicture: string;
  // Doctor specific fields
  specialization?: string;
  experience?: string;
  fee?: string;
  bio?: string;
  city?: string;
  registrationNumber?: string;
  degree?: string;
  university?: string;
  yearOfCompletion?: number;
  registrationCouncil?: string;
  currentHospitalClinic?: string;
  previousWorkDetails?: string;
  areasOfExpertise?: string[];
  languagesSpoken?: string[];
  treatmentApproach?: string;
  rating?: number;
  isVerified?: boolean;
  // Relationship flags
  hasAppointment?: boolean;
}

export const usePublicProfile = (userId: string | undefined | null) => {
  return useQuery({
    queryKey: ['public-profile', userId],
    queryFn: async () => {
      if (!userId) throw new Error('No user ID provided');

      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      const currentUserId = authUser?.id || null;
      const isOwnProfile = Boolean(currentUserId && currentUserId === userId);

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, gender, profile_picture, role_id')
        .eq('id', userId)
        .single();

      if (profileError) throw profileError;

      let roleSlug = '';
      if (profileData?.role_id) {
        try {
          const { data: roleRow } = await supabase
            .from('roles')
            .select('slug')
            .eq('id', profileData.role_id)
            .maybeSingle();
          roleSlug = typeof roleRow?.slug === 'string' ? roleRow.slug : '';
        } catch {
          roleSlug = '';
        }
      }

      let normalizedRole =
        roleSlug.toLowerCase() === 'doctor'
          ? 'Doctor'
          : roleSlug.toLowerCase() === 'admin'
            ? 'Admin'
            : 'Patient';

      const signedProfilePicture = await resolveStorageSignedUrl({
        bucket: SUPABASE_PROFILE_MEDIA_BUCKET,
        value: profileData?.profile_picture || '',
        ttlSeconds: 60 * 60 * 24 * 7,
      });

      let publicInfo: PublicProfile = {
        id: profileData.id,
        firstName: profileData.first_name || '',
        lastName: profileData.last_name || '',
        role: normalizedRole,
        gender: profileData.gender || 'Other',
        profilePicture: signedProfilePicture || '',
        hasAppointment: false,
      };

      // Sensitive patient fields are only fetched for self-profile.
      if (isOwnProfile) {
        try {
          const { data: privateData } = await supabase
            .from('profiles')
            .select('age, address, weight, blood_pressure, pulse')
            .eq('id', userId)
            .maybeSingle();
          publicInfo = {
            ...publicInfo,
            age: parseOptionalNumber(privateData?.age),
            address: privateData?.address || '',
            weight: parseOptionalNumber(privateData?.weight),
            bloodPressure: privateData?.blood_pressure || '',
            pulse: parseOptionalNumber(privateData?.pulse),
          };
        } catch {
          // best effort only
        }
      }

      let docData: any = null;
      try {
        const { data } = await supabase
          .from('doctors_public')
          .select(
            'id, city, specialization, experience, fee, bio, rating, is_verified, created_at, updated_at, first_name, last_name, profile_picture, gender'
          )
          .eq('id', userId)
          .maybeSingle();
        docData = data || null;
      } catch {
        docData = null;
      }

      if (docData) {
        normalizedRole = 'Doctor';
      }

      if (normalizedRole === 'Doctor' && docData) {
        const signedDoctorPicture = await resolveStorageSignedUrl({
          bucket: SUPABASE_PROFILE_MEDIA_BUCKET,
          value: docData.profile_picture || publicInfo.profilePicture || '',
          ttlSeconds: 60 * 60 * 24 * 7,
        });
        let doctorExtra: any = null;
        try {
          const { data } = await supabase
            .from('doctors')
            .select(
              'registration_number, degree, university, year_of_completion, registration_council, current_hospital_clinic, previous_work_details, areas_of_expertise, languages_spoken, treatment_approach'
            )
            .eq('id', userId)
            .maybeSingle();
          doctorExtra = data || null;
        } catch {
          doctorExtra = null;
        }

        publicInfo = {
          ...publicInfo,
          firstName: docData.first_name || publicInfo.firstName,
          lastName: docData.last_name || publicInfo.lastName,
          role: 'Doctor',
          profilePicture: signedDoctorPicture || publicInfo.profilePicture,
          specialization: docData.specialization || '',
          experience: docData.experience || '',
          fee: docData.fee || '',
          bio: docData.bio || '',
          city: docData.city || '',
          registrationNumber: doctorExtra?.registration_number || '',
          degree: doctorExtra?.degree || '',
          university: doctorExtra?.university || '',
          yearOfCompletion: parseOptionalNumber(doctorExtra?.year_of_completion),
          registrationCouncil: doctorExtra?.registration_council || '',
          currentHospitalClinic: doctorExtra?.current_hospital_clinic || '',
          previousWorkDetails: doctorExtra?.previous_work_details || '',
          areasOfExpertise: parseStringArray(doctorExtra?.areas_of_expertise),
          languagesSpoken: parseStringArray(doctorExtra?.languages_spoken),
          treatmentApproach: doctorExtra?.treatment_approach || '',
          rating: typeof docData.rating === 'number' ? docData.rating : 0,
          isVerified: Boolean(docData.is_verified),
        };

        if (currentUserId) {
          const { count } = await supabase
            .from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('patient_id', currentUserId)
            .eq('doctor_id', userId)
            .in('status', ['pending', 'confirmed', 'completed']);

          publicInfo.hasAppointment = (count || 0) > 0;
        }
      }

      return publicInfo;
    },
    enabled: !!userId,
  });
};
