import React from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import Colors from '../../constants/Colors';
import { Doctor } from '../../src/types';
import { resolveStorageSignedUrl } from '../../src/utils/storageSignedUrl';
import { useAdminDoctorById, useVerifyDoctor } from '../../hooks/useAdmin';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../../constants/Config';

const PROFILE_BUCKET = SUPABASE_PROFILE_MEDIA_BUCKET;
const KYC_BUCKET = 'doctor-kyc';
const DOC_SIGNED_URL_TTL_SECONDS = 60 * 30;
const PROFILE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

type ResolvedDoctorDocument = {
  path: string;
  url: string | null;
  isImage: boolean;
};

const isImagePath = (value: string) => {
  const normalized = (value || '').trim();
  const base = normalized.split('?')[0] || '';
  if (/\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(base)) return true;
  if (/^https?:\/\//i.test(normalized)) {
    if (/\.(pdf|docx?|xlsx?|pptx?|txt|zip)$/i.test(base)) return false;
    return true;
  }
  return false;
};

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

const toBucketRelativePath = (bucket: string, value: string): string => {
  const normalized = trimSlashes(value);
  const bucketPrefix = `${bucket}/`;
  if (normalized.startsWith(bucketPrefix)) {
    return normalized.slice(bucketPrefix.length);
  }
  return normalized;
};

const looksLikeKycPath = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith(`${KYC_BUCKET}/`)) return true;
  return /(^|\/)kyc[_-]/.test(normalized);
};

const resolveDocumentUrl = async (value: string): Promise<string | null> => {
  const normalized = (value || '').trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;

  const candidateBuckets = looksLikeKycPath(normalized)
    ? [KYC_BUCKET, PROFILE_BUCKET]
    : [PROFILE_BUCKET, KYC_BUCKET];

  for (const bucket of candidateBuckets) {
    const candidatePath = toBucketRelativePath(bucket, normalized);
    const signedUrl = await resolveStorageSignedUrl({
      bucket,
      value: candidatePath,
      ttlSeconds: DOC_SIGNED_URL_TTL_SECONDS,
    });
    if (/^https?:\/\//i.test((signedUrl || '').trim())) {
      return signedUrl;
    }
  }

  return null;
};

const renderValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text.length > 0 ? text : '-';
};

const renderDate = (value?: string): string => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const DetailRow = ({ label, value }: { label: string; value: unknown }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{renderValue(value)}</Text>
  </View>
);

export default function AdminDoctorProfileScreen() {
  const { doctorId } = useLocalSearchParams<{ doctorId?: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const [resolvedDocuments, setResolvedDocuments] = React.useState<ResolvedDoctorDocument[]>([]);
  const [resolvedProfileImage, setResolvedProfileImage] = React.useState<string>('');
  const [isPreparingDocs, setIsPreparingDocs] = React.useState(false);

  const id = String(doctorId || '').trim();
  const { data: doctor, isLoading, refetch } = useAdminDoctorById(id);
  const verifyMutation = useVerifyDoctor();

  React.useEffect(() => {
    const run = async () => {
      if (!doctor) return;
      setIsPreparingDocs(true);
      try {
        const docs = Array.isArray(doctor.documents)
          ? doctor.documents.filter((item) => typeof item === 'string' && item.trim().length > 0)
          : [];
        const mapped: ResolvedDoctorDocument[] = await Promise.all(
          docs.map(async (path) => ({
            path,
            url: await resolveDocumentUrl(path),
            isImage: isImagePath(path),
          }))
        );

        const profileUrlCandidate = await resolveStorageSignedUrl({
          bucket: PROFILE_BUCKET,
          value: doctor.image || '',
          ttlSeconds: PROFILE_SIGNED_URL_TTL_SECONDS,
        });
        const normalizedProfileUrl = (profileUrlCandidate || '').trim();
        const profileUrl = /^https?:\/\//i.test(normalizedProfileUrl) ? normalizedProfileUrl : '';

        setResolvedProfileImage(profileUrl);
        setResolvedDocuments(mapped);
      } catch {
        setResolvedProfileImage('');
        setResolvedDocuments([]);
      } finally {
        setIsPreparingDocs(false);
      }
    };
    void run();
  }, [doctor]);

  const toggleVerification = (item: Doctor) => {
    const newStatus = !item.isVerified;
    verifyMutation.mutate(
      { doctorId: item.id, isVerified: newStatus },
      {
        onSuccess: async () => {
          Toast.show({
            type: 'success',
            text1: 'Verification updated',
            text2: `Doctor marked as ${newStatus ? 'Verified' : 'Pending'}.`,
          });
          await refetch();
        },
        onError: (error: any) => {
          Toast.show({
            type: 'error',
            text1: 'Error',
            text2: error?.message || 'Failed to update verification status.',
          });
        },
      }
    );
  };

  const openDocument = async (doc: ResolvedDoctorDocument) => {
    if (!doc.url) {
      Toast.show({ type: 'error', text1: 'Document unavailable' });
      return;
    }
    try {
      const canOpen = await Linking.canOpenURL(doc.url);
      if (!canOpen) {
        Toast.show({ type: 'error', text1: 'Cannot open document' });
        return;
      }
      await Linking.openURL(doc.url);
    } catch {
      Toast.show({ type: 'error', text1: 'Open failed' });
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: theme.cardBackground }]}>
          <Ionicons name="arrow-back" size={18} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Doctor Profile Review</Text>
        <View style={{ width: 34 }} />
      </View>

      {isLoading || !doctor ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={theme.tint} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.profileHero, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <Image source={{ uri: resolvedProfileImage || doctor.image || 'https://via.placeholder.com/80' }} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: theme.text }]}>Dr. {doctor.firstName} {doctor.lastName}</Text>
              <Text style={[styles.sub, { color: theme.textSecondary }]}>{renderValue(doctor.specialization)}</Text>
              <Text style={[styles.subMuted, { color: theme.textSecondary }]}>{renderValue(doctor.email)}</Text>
            </View>
            <Switch
              trackColor={{ false: '#767577', true: theme.successLight }}
              thumbColor={doctor.isVerified ? theme.success : '#f4f3f4'}
              onValueChange={() => toggleVerification(doctor)}
              value={doctor.isVerified}
              disabled={verifyMutation.isPending}
            />
          </View>

          <View style={[styles.sectionCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Identity</Text>
            <DetailRow label="Doctor ID" value={doctor.id} />
            <DetailRow label="Phone" value={doctor.phoneNumber} />
            <DetailRow label="Gender" value={doctor.gender} />
            <DetailRow label="City" value={doctor.city} />
          </View>

          <View style={[styles.sectionCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Verification</Text>
            <DetailRow label="Doctor Verification" value={doctor.isVerified ? 'Verified' : 'Pending'} />
            <DetailRow label="KYC Verification" value={doctor.kycVerify ? 'Verified' : 'Pending'} />
            <DetailRow label="Registration Number" value={doctor.registrationNumber} />
            <DetailRow label="Created At" value={renderDate(doctor.createdAt)} />
            <DetailRow label="Updated At" value={renderDate(doctor.updatedAt)} />
          </View>

          <View style={[styles.sectionCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Professional Profile</Text>
            <DetailRow label="Specialization" value={doctor.specialization} />
            <DetailRow label="Experience" value={doctor.experience} />
            <DetailRow label="Consultation Fee" value={doctor.fee} />
            <DetailRow label="Bio" value={doctor.bio} />
            <DetailRow label="Degree" value={doctor.degree} />
            <DetailRow label="University" value={doctor.university} />
            <DetailRow label="Year Of Completion" value={doctor.yearOfCompletion} />
            <DetailRow label="Registration Council" value={doctor.registrationCouncil} />
            <DetailRow label="Current Hospital / Clinic" value={doctor.currentHospitalClinic} />
            <DetailRow label="Previous Work Details" value={doctor.previousWorkDetails} />
            <DetailRow label="Treatment Approach" value={doctor.treatmentApproach} />
            <DetailRow label="Areas Of Expertise" value={doctor.areasOfExpertise?.join(', ')} />
            <DetailRow label="Languages Spoken" value={doctor.languagesSpoken?.join(', ')} />
          </View>

          <View style={[styles.sectionCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Uploaded Documents</Text>
            {isPreparingDocs ? (
              <ActivityIndicator color={theme.tint} />
            ) : resolvedDocuments.length === 0 ? (
              <Text style={[styles.noDocs, { color: theme.textSecondary }]}>No document uploaded.</Text>
            ) : (
              resolvedDocuments.map((doc, index) => (
                <View key={`${doc.path}-${index}`} style={[styles.documentCard, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                  <Text style={[styles.documentPath, { color: theme.text }]} numberOfLines={2}>{doc.path}</Text>
                  {doc.isImage && doc.url ? <Image source={{ uri: doc.url }} style={[styles.documentPreview, { backgroundColor: theme.borderColor }]} /> : null}
                  <TouchableOpacity style={[styles.documentBtn, { borderColor: theme.tint, backgroundColor: theme.successLight }]} onPress={() => void openDocument(doc)}>
                    <Text style={[styles.documentBtnText, { color: theme.tint }]}>Open Document</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#2b2b2b',
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Outfit-SemiBold',
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 14,
    paddingBottom: 30,
  },
  profileHero: {
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#333' },
  name: { color: '#fff', fontSize: 18, fontFamily: 'Outfit-Bold' },
  sub: { color: '#c6c6c6', fontSize: 13, marginTop: 2 },
  subMuted: { color: '#9c9c9c', fontSize: 12, marginTop: 2 },
  sectionCard: {
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Outfit-Bold',
    marginBottom: 8,
  },
  detailRow: { marginBottom: 8 },
  detailLabel: {
    color: '#9f9f9f',
    fontSize: 11,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Outfit-Medium',
  },
  noDocs: { color: '#b4b4b4', fontSize: 13 },
  documentCard: {
    borderWidth: 1,
    borderColor: '#2f2f2f',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#171717',
  },
  documentPath: { color: '#fff', fontSize: 12, fontFamily: 'Outfit-Medium' },
  documentPreview: {
    width: '100%',
    height: 130,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#2f2f2f',
  },
  documentBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#43e97b',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(67, 233, 123, 0.14)',
  },
  documentBtnText: {
    color: '#43e97b',
    fontSize: 12,
    fontFamily: 'Outfit-SemiBold',
  },
});
