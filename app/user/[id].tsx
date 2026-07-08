import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import {
  MapPin,
  Star,
  ShieldCheck,
  ChevronLeft,
  Calendar,
  MessageCircle,
  Briefcase,
  IndianRupee,
  GraduationCap,
} from 'lucide-react-native';
import { usePublicProfile } from '../../hooks/usePublicProfile';
import { useAuthContext } from '../../context/AuthContext';
import { useCommunityFollowStats, useToggleCommunityFollow } from '../../hooks/useCommunityFollow';
import Colors from '../../constants/Colors';
import { getImageUrl } from '../../constants/Config';
import ShimmerBlock from '../../ui/common/ShimmerSkeleton';
import ScreenWrapper from '../../ui/common/ScreenWrapper';
import { useThemePreference } from '../../context/ThemePreferenceContext';

const { width } = Dimensions.get('window');

const getSkeletonPalette = (isDark: boolean) => ({
  base: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
  glow: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.72)',
});

const withOpacity = (hexColor: string, opacity: number): string => {
  const normalized = hexColor.replace('#', '');
  if (normalized.length !== 6) return hexColor;
  const bigint = Number.parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const normalizeText = (value: string | null | undefined): string => (value || '').trim().toLowerCase();

function PublicProfileSkeleton({ isDark }: { isDark: boolean }) {
  const palette = getSkeletonPalette(isDark);
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.skeletonWrap}>
      {/* Header Spacer */}
      <View style={{ height: 20 }} />

      {/* Top Identity Card Skeleton */}
      <View style={{ paddingHorizontal: 20 }}>
        <View
          style={{
            width: '100%',
            borderRadius: 22,
            borderWidth: 1,
            borderColor: isDark ? '#2B3130' : '#DFE7E4',
            backgroundColor: isDark ? '#1E2221' : '#FFF',
            padding: 16,
          }}
        >
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            {/* Avatar */}
            <ShimmerBlock width={96} height={96} borderRadius={48} baseColor={palette.base} highlightColor={palette.glow} />

            {/* Details */}
            <View style={{ flex: 1, gap: 6 }}>
              {/* Name */}
              <ShimmerBlock width={160} height={22} borderRadius={6} baseColor={palette.base} highlightColor={palette.glow} />

              {/* Claimed Badge */}
              <ShimmerBlock width={100} height={16} borderRadius={4} baseColor={palette.base} highlightColor={palette.glow} />

              {/* Specialty */}
              <ShimmerBlock width={140} height={14} borderRadius={4} baseColor={palette.base} highlightColor={palette.glow} />

              {/* Location */}
              <ShimmerBlock width={110} height={14} borderRadius={4} baseColor={palette.base} highlightColor={palette.glow} />
            </View>
          </View>

          {/* Fee Section inside card */}
          <View
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: isDark ? '#2B3130' : '#DFE7E4',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <ShimmerBlock width={80} height={14} borderRadius={4} baseColor={palette.base} highlightColor={palette.glow} />
            <ShimmerBlock width={60} height={20} borderRadius={6} baseColor={palette.base} highlightColor={palette.glow} />
          </View>
        </View>
      </View>

      {/* Tabs Row Placeholder */}
      <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
        <ShimmerBlock width="100%" height={40} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
      </View>

      {/* Sections placeholders */}
      <View style={styles.sectionsContainer}>
        {/* About Me */}
        <View style={{ marginBottom: 20 }}>
          <ShimmerBlock width={100} height={18} borderRadius={6} baseColor={palette.base} highlightColor={palette.glow} />
          <View style={{ height: 10 }} />
          <ShimmerBlock width="100%" height={50} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
        </View>

        {/* Clinics Preview */}
        <View style={{ marginBottom: 20 }}>
          <ShimmerBlock width={80} height={18} borderRadius={6} baseColor={palette.base} highlightColor={palette.glow} />
          <View style={{ height: 10 }} />
          <ShimmerBlock width="100%" height={120} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
        </View>

        {/* Specializations */}
        <View style={{ marginBottom: 20 }}>
          <ShimmerBlock width={120} height={18} borderRadius={6} baseColor={palette.base} highlightColor={palette.glow} />
          <View style={{ height: 10 }} />
          <View style={{ gap: 8 }}>
            <ShimmerBlock width={200} height={14} borderRadius={4} baseColor={palette.base} highlightColor={palette.glow} />
            <ShimmerBlock width={180} height={14} borderRadius={4} baseColor={palette.base} highlightColor={palette.glow} />
          </View>
        </View>

        {/* Experience & Education */}
        <View style={{ marginBottom: 20 }}>
          <ShimmerBlock width={100} height={18} borderRadius={6} baseColor={palette.base} highlightColor={palette.glow} />
          <View style={{ height: 10 }} />
          <ShimmerBlock width="100%" height={90} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
        </View>
      </View>
    </ScrollView>
  );
}

export default function PublicProfileScreen() {
  const { id, source } = useLocalSearchParams<{ id?: string | string[]; source?: string | string[] }>();
  const [activeTab, setActiveTab] = React.useState<'overview' | 'clinics' | 'reviews' | 'ask'>('overview');
  const profileId = Array.isArray(id) ? id[0] : id;
  const profileSource = Array.isArray(source) ? source[0] : source;
  const isCommunityProfileView = profileSource === 'community';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resolvedColorScheme } = useThemePreference();
  const colorScheme = resolvedColorScheme;
  const isDark = (colorScheme ?? 'light') === 'dark';
  const theme = Colors[colorScheme ?? 'light'];
  const { user: currentUser } = useAuthContext();

  const { data: profile, isLoading, error } = usePublicProfile(profileId);
  const { data: followStats } = useCommunityFollowStats(currentUser?.id, profileId);
  const toggleFollowMutation = useToggleCommunityFollow(currentUser?.id, profileId);

  const handleBack = () => router.back();

  const handleBookAppointment = () => {
    if (!profileId) return;
    router.push({ pathname: '/(tabs)/appointments', params: { doctorId: profileId } } as any);
  };

  const handleMessage = () => {
    if (!profileId) return;
    router.push({ pathname: '/chat-detail', params: { otherId: profileId, name: `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() } } as any);
  };

  if (isLoading) {
    return (
      <ScreenWrapper withScrollView={false} keyboardAvoiding={false} applyTopInset applyBottomInset>
        <PublicProfileSkeleton isDark={isDark} />
      </ScreenWrapper>
    );
  }

  if (error || !profile) {
    return (
      <ScreenWrapper withScrollView={false} keyboardAvoiding={false} applyTopInset applyBottomInset>
        <View style={styles.centerContainer}>
          <Text style={[styles.errorText, { color: theme.textSecondary }]}>
            Profile not found or unable to load.
          </Text>
          <TouchableOpacity style={[styles.backButtonCenter, { backgroundColor: theme.tint }]} onPress={handleBack}>
            <Text style={styles.backButtonTextCenter}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenWrapper>
    );
  }

  const isDoctor = profile.role === 'Doctor';
  const isOwnProfile = Boolean(currentUser?.id && profileId && currentUser.id === profileId);
  const showActionButtons = !isCommunityProfileView && currentUser?.role === 'Patient' && isDoctor;
  const canFollow = Boolean(currentUser?.id && profileId && !isOwnProfile);
  const formatList = (values?: string[]) => (values && values.length > 0 ? values.join(', ') : '');
  const formatFeeValue = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return 'N/A';
    return raw.startsWith('₹') ? raw : `₹${raw}`;
  };
  const formattedRating = Number(profile.rating || 0) > 0 ? Number(profile.rating || 0).toFixed(1) : 'N/A';

  const renderTabs = () => {
    return (
      <View style={[styles.tabsRow, { borderBottomColor: theme.borderColor }]}>
        {(['overview', 'clinics', 'reviews', 'ask'] as const).map((tab) => {
          const isActive = activeTab === tab;
          const label = tab === 'ask' ? 'Ask Doctor' : tab.charAt(0).toUpperCase() + tab.slice(1);
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, isActive && styles.activeTabItem]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, { color: isActive ? theme.tint : theme.textSecondary, fontWeight: isActive ? '800' : '600' }]}>
                {label}
              </Text>
              {isActive && <View style={[styles.tabIndicator, { backgroundColor: theme.tint }]} />}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderClinicCard = () => {
    return (
      <View style={[styles.clinicCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <View style={styles.clinicHeaderRow}>
          <View style={styles.clinicNameCol}>
            <Text style={[styles.clinicName, { color: theme.text }]} numberOfLines={2}>
              {profile.currentHospitalClinic || 'CD4 Partner Clinic'}
            </Text>
            <View style={styles.clinicAddressRow}>
              <MapPin size={14} color={theme.textSecondary} style={{ marginRight: 4 }} />
              <Text style={[styles.clinicAddressText, { color: theme.textSecondary }]} numberOfLines={2}>
                {profile.address || `${profile.city || 'Gurugram'}, Haryana, India`}
              </Text>
            </View>
          </View>
          <View style={styles.clinicFeeCol}>
            <Text style={[styles.clinicFeeLabel, { color: theme.textSecondary }]}>Consult Fee</Text>
            <Text style={[styles.clinicFeeValue, { color: '#10B981' }]}>
              {formatFeeValue(profile.fee)}
            </Text>
          </View>
        </View>

        <View style={styles.clinicTimeRow}>
          <Text style={[styles.clinicDays, { color: theme.text }]}>Mon - Fri</Text>
          <Text style={[styles.clinicHours, { color: theme.textSecondary }]}>
            11:00 AM - 08:00 PM
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.clinicConsultButton, { backgroundColor: theme.tint }]}
          onPress={handleBookAppointment}
          activeOpacity={0.88}
        >
          <Text style={styles.clinicConsultButtonText}>Clinic Consult</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderReviewsTab = () => {
    return (
      <View style={{ marginTop: 12 }}>
        <View style={[styles.reviewsSummaryCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.reviewsRatingValue, { color: theme.text }]}>{formattedRating}</Text>
          <View style={styles.reviewsStarsRow}>
            {Array.from({ length: 5 }).map((_, i) => {
              const ratingNum = Number(profile.rating || 0);
              const isFilled = i < Math.floor(ratingNum || 5);
              return (
                <Star
                  key={i}
                  size={18}
                  color="#F59E0B"
                  fill={isFilled ? '#F59E0B' : 'transparent'}
                  style={{ marginHorizontal: 2 }}
                />
              );
            })}
          </View>
          <Text style={[styles.reviewsRatingLabel, { color: theme.textSecondary }]}>
            Average Rating based on patient consultations
          </Text>
        </View>

        <Text style={[styles.overviewSectionTitle, { color: theme.text, marginTop: 24, marginBottom: 12 }]}>Patient Feedback</Text>
        <View style={[styles.feedbackCommentCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.feedbackCommentText, { color: theme.textSecondary }]}>
            No written reviews have been submitted for this doctor yet. Only patients with confirmed consultations can leave reviews.
          </Text>
        </View>
      </View>
    );
  };

  const renderAskDoctorTab = () => {
    return (
      <View style={{ marginTop: 12 }}>
        <View style={[styles.askDoctorCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <MessageCircle size={32} color={theme.tint} style={styles.askDoctorIcon} />
          <Text style={[styles.askDoctorTitle, { color: theme.text }]}>Direct Consultation Chat</Text>
          <Text style={[styles.askDoctorText, { color: theme.textSecondary }]}>
            Connect with {isDoctor ? 'Dr. ' : ''}{profile.firstName} {profile.lastName} for diagnostic follow-ups, report explanations, or prescription guidance.
          </Text>
          <TouchableOpacity
            style={[styles.askDoctorButton, { backgroundColor: theme.tint }]}
            onPress={handleMessage}
            activeOpacity={0.88}
          >
            <Text style={styles.askDoctorButtonText}>Start Conversation</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderDoctorDetails = () => {
    const expertise = profile.areasOfExpertise || [];

    return (
      <View style={styles.sectionsContainer}>
        {renderTabs()}
        {activeTab === 'overview' && (
          <View style={{ marginTop: 12 }}>
            {profile.bio ? (
              <View style={styles.overviewSection}>
                <Text style={[styles.overviewSectionTitle, { color: theme.text }]}>About Me</Text>
                <Text style={[styles.overviewBioText, { color: theme.textSecondary }]}>{profile.bio}</Text>
              </View>
            ) : null}

            <View style={styles.overviewSection}>
              <Text style={[styles.overviewSectionTitle, { color: theme.text }]}>Clinics</Text>
              {renderClinicCard()}
            </View>

            {expertise.length > 0 && (
              <View style={styles.overviewSection}>
                <Text style={[styles.overviewSectionTitle, { color: theme.text }]}>Specializations</Text>
                <View style={styles.specializationsList}>
                  {expertise.map((spec: string, index: number) => (
                    <View key={index} style={styles.bulletRow}>
                      <View style={[styles.bulletDot, { backgroundColor: theme.tint }]} />
                      <Text style={[styles.bulletText, { color: theme.textSecondary }]}>{spec}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.overviewSection}>
              <Text style={[styles.overviewSectionTitle, { color: theme.text }]}>Experience</Text>
              <View style={[styles.experienceCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={[styles.experienceHeader, { borderBottomColor: theme.borderColor }]}>
                  <Briefcase size={16} color={theme.tint} />
                  <Text style={[styles.experienceTitle, { color: theme.text }]}>
                    {profile.previousWorkDetails || profile.currentHospitalClinic || 'General Medical Practice'}
                  </Text>
                </View>
                <View style={styles.experienceDetails}>
                  <Text style={[styles.experienceRole, { color: theme.textSecondary }]}>
                    {profile.specialization || 'Clinical Specialist'}
                  </Text>
                  {profile.city && (
                    <Text style={[styles.experienceLocation, { color: theme.textSecondary }]}>
                      {profile.city}, India
                    </Text>
                  )}
                  <View style={styles.experienceDateRow}>
                    <Calendar size={14} color={theme.textSecondary} style={{ marginRight: 6 }} />
                    <Text style={[styles.experienceDate, { color: theme.textSecondary }]}>
                      {profile.experience || '7 Years'} of Clinical Practice
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {(profile.degree || profile.university) && (
              <View style={styles.overviewSection}>
                <Text style={[styles.overviewSectionTitle, { color: theme.text }]}>Education</Text>
                <View style={[styles.educationCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                  <View style={[styles.educationHeader, { borderBottomColor: theme.borderColor }]}>
                    <GraduationCap size={16} color={theme.tint} />
                    <Text style={[styles.educationTitle, { color: theme.text }]}>
                      {profile.degree || 'Bachelor of Medicine'}
                    </Text>
                  </View>
                  <View style={styles.educationDetails}>
                    <Text style={[styles.educationUni, { color: theme.textSecondary }]}>
                      {profile.university || 'Medical Sciences University'}
                    </Text>
                    {profile.city && (
                      <Text style={[styles.educationLocation, { color: theme.textSecondary }]}>
                        {profile.city}, India
                      </Text>
                    )}
                    <View style={styles.educationDateRow}>
                      <Calendar size={14} color={theme.textSecondary} style={{ marginRight: 6 }} />
                      <Text style={[styles.educationDate, { color: theme.textSecondary }]}>
                        {profile.yearOfCompletion ? `Completed in ${profile.yearOfCompletion}` : 'Verified Degree'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
        {activeTab === 'clinics' && (
          <View style={{ marginTop: 12 }}>
            {renderClinicCard()}
          </View>
        )}
        {activeTab === 'reviews' && renderReviewsTab()}
        {activeTab === 'ask' && renderAskDoctorTab()}
      </View>
    );
  };

  const renderPatientDetails = () => (
    <View style={styles.sectionsContainer}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Basic Information</Text>
        <View style={[styles.detailCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={[styles.detailRow, styles.detailRowDivider, { borderBottomColor: theme.borderColor }]}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Gender</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>{profile.gender || 'Not specified'}</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowDivider, { borderBottomColor: theme.borderColor }]}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Age</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>{profile.age ?? 'Not specified'}</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowDivider, { borderBottomColor: theme.borderColor }]}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Address</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>{profile.address || 'Not specified'}</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowDivider, { borderBottomColor: theme.borderColor }]}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Weight (kg)</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>{profile.weight ?? 'Not specified'}</Text>
          </View>
          <View style={[styles.detailRow, styles.detailRowDivider, { borderBottomColor: theme.borderColor }]}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Blood Pressure</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>{profile.bloodPressure || 'Not specified'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Pulse (bpm)</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>{profile.pulse ?? 'Not specified'}</Text>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <ScreenWrapper withScrollView={false} keyboardAvoiding={false} applyTopInset applyBottomInset>
      <View style={styles.container}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {!isCommunityProfileView ? (
            <View style={styles.profileHeaderRow}>
              <TouchableOpacity
                style={styles.profileHeaderBackButtonTouch}
                onPress={handleBack}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.themeBackButton,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.borderColor,
                    },
                  ]}
                >
                  <ChevronLeft size={22} color={theme.text} />
                </View>
              </TouchableOpacity>
              <Text style={[styles.profileHeaderTitle, { color: theme.text }]}>
                {isDoctor ? 'Doctor Profile' : 'Profile'}
              </Text>
              <View style={styles.profileHeaderSpacer} />
            </View>
          ) : null}

          {/* Header Background */}
          <View
            style={[
              styles.headerBanner,
              isCommunityProfileView
                ? {
                  backgroundColor: theme.cardBackground,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.borderColor,
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  height: 120,
                }
                : {
                  backgroundColor: theme.background,
                  borderBottomWidth: 0,
                  borderBottomColor: 'transparent',
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  height: 26,
                },
            ]}
          >
            <View
              style={[
                styles.headerOverlay,
                isCommunityProfileView
                  ? { backgroundColor: 'transparent' }
                  : { backgroundColor: 'transparent' },
              ]}
            />
          </View>

          {/* Profile Card Overlay */}
          <View style={[styles.profileCardWrapper, !isCommunityProfileView && styles.profileCardWrapperTight]}>
            {isCommunityProfileView ? (
              <TouchableOpacity
                style={[styles.profileBackButton, styles.profileBackButtonCommunity]}
                onPress={handleBack}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.themeBackButton,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.borderColor,
                    },
                  ]}
                >
                  <ChevronLeft size={22} color={theme.text} />
                </View>
              </TouchableOpacity>
            ) : null}
            <View
              style={[
                styles.profileIdentityCard,
                {
                  backgroundColor: theme.cardBackground,
                  borderColor: theme.borderColor,
                  shadowColor: colorScheme === 'dark' ? '#000000' : '#0b1f18',
                  paddingTop: isCommunityProfileView ? 18 : 12,
                  borderRadius: isCommunityProfileView ? 0 : 20,
                  borderWidth: isCommunityProfileView ? 0 : 1,
                  shadowOpacity: isCommunityProfileView ? 0 : 0.09,
                  elevation: isCommunityProfileView ? 0 : 4,
                  overflow: isCommunityProfileView ? 'visible' : 'hidden',
                },
              ]}
            >
              {!isCommunityProfileView ? (
                <View style={[styles.profileCardAccent, { backgroundColor: withOpacity(theme.tint, isDark ? 0.3 : 0.18) }]} />
              ) : null}
              {isCommunityProfileView ? (
                <View style={styles.fbProfileTop}>
                  <Image
                    source={{ uri: getImageUrl(profile.profilePicture) || 'https://i.pravatar.cc/300?img=12' }}
                    style={styles.fbAvatar}
                  />
                  <View style={styles.fbMetaCol}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.fbName, { color: theme.text }]}>
                        {profile.firstName} {profile.lastName}
                      </Text>
                      {profile.isVerified && <ShieldCheck size={18} color={theme.tint} style={{ marginLeft: 6 }} />}
                    </View>
                    <Text style={[styles.fbSubtitle, { color: theme.textSecondary }]}>
                      {isDoctor ? 'Doctor • Community' : 'Patient • Community'}
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.doctorHeroRow}>
                    <Image
                      source={{ uri: getImageUrl(profile.profilePicture) || 'https://i.pravatar.cc/300?img=12' }}
                      style={styles.avatar}
                    />
                    <View style={styles.doctorHeroContent}>
                      <View style={styles.doctorNameRow}>
                        <Text style={[styles.doctorName, { color: theme.text }]}>
                          {isDoctor ? 'Dr. ' : ''}
                          {profile.firstName} {profile.lastName}
                        </Text>
                      </View>

                      {isDoctor ? (
                        <>
                          <View style={[styles.claimedProfileBadge, { backgroundColor: withOpacity('#10B981', 0.12), borderColor: withOpacity('#10B981', 0.28) }]}>
                            <Text style={styles.claimedProfileText}>Claimed Profile</Text>
                            <ShieldCheck size={14} color="#10B981" style={{ marginLeft: 4 }} />
                          </View>
                        </>
                      ) : (
                        <Text style={[styles.doctorSubtitle, { color: theme.textSecondary }]}>Patient</Text>
                      )}
                    </View>
                  </View>

                  {isDoctor && (
                    <View style={[styles.cardFeeContainer, { borderTopColor: theme.borderColor }]}>
                      <Text style={[styles.cardFeeLabel, { color: theme.textSecondary }]}>CONSULT FEE</Text>
                      <Text style={[styles.cardFeeAmount, { color: theme.text }]}>{formatFeeValue(profile.fee)}</Text>
                    </View>
                  )}
                </>
              )}
              {isCommunityProfileView ? (
                <View style={styles.fbStatsWrap}>
                  <View style={styles.socialStatsRow}>
                    <View style={styles.socialStatCol}>
                      <Text style={[styles.socialStatValue, { color: theme.text }]}>{followStats?.postsCount ?? 0}</Text>
                      <Text style={[styles.socialStatLabel, { color: theme.textSecondary }]}>Posts</Text>
                    </View>
                    <View style={styles.socialStatCol}>
                      <Text style={[styles.socialStatValue, { color: theme.text }]}>{followStats?.followersCount ?? 0}</Text>
                      <Text style={[styles.socialStatLabel, { color: theme.textSecondary }]}>Followers</Text>
                    </View>
                    <View style={styles.socialStatCol}>
                      <Text style={[styles.socialStatValue, { color: theme.text }]}>{followStats?.followingCount ?? 0}</Text>
                      <Text style={[styles.socialStatLabel, { color: theme.textSecondary }]}>Following</Text>
                    </View>
                  </View>
                  {canFollow ? (
                    <TouchableOpacity
                      style={[
                        styles.followButton,
                        {
                          backgroundColor: followStats?.isFollowing ? theme.cardBackground : theme.tint,
                          borderColor: theme.tint,
                        },
                      ]}
                      onPress={() => {
                        void toggleFollowMutation.mutateAsync(!Boolean(followStats?.isFollowing));
                      }}
                      disabled={toggleFollowMutation.isPending}
                    >
                      <Text
                        style={[
                          styles.followButtonText,
                          { color: followStats?.isFollowing ? theme.tint : '#FFF' },
                        ]}
                      >
                        {followStats?.isFollowing ? 'Following' : 'Follow'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>

          {/* Dynamic Content */}
          {isCommunityProfileView ? (
            <View style={styles.sectionsContainer}>
              {profile.bio ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>About</Text>
                  <Text style={[styles.bioText, { color: theme.textSecondary }]}>{profile.bio}</Text>
                </View>
              ) : null}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Community</Text>
                <Text style={[styles.bioText, { color: theme.textSecondary }]}>
                  {profile.firstName} participates in CD4 community posts and updates.
                </Text>
              </View>
            </View>
          ) : isDoctor ? renderDoctorDetails() : renderPatientDetails()}
        </ScrollView>

        {/* Conditional Action Buttons for Patients */}
        {showActionButtons && (
          <BlurView
            intensity={80}
            tint={colorScheme === 'dark' ? 'dark' : 'light'}
            style={[styles.bottomBar, { paddingBottom: insets.bottom || 20, borderTopColor: theme.borderColor }]}
          >
            {profile.hasAppointment ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.messageBtn, { backgroundColor: theme.cardBackground, borderColor: theme.tint, marginRight: 8 }]}
                  onPress={handleMessage}
                  activeOpacity={0.8}
                >
                  <MessageCircle size={20} color={theme.tint} />
                  <Text style={[styles.actionBtnText, styles.messageBtnText, { color: theme.tint }]}>Message</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.bookBtn, { backgroundColor: theme.tint, marginLeft: 8 }]}
                  onPress={handleBookAppointment}
                  activeOpacity={0.8}
                >
                  <Calendar size={20} color="#FFF" />
                  <Text style={[styles.actionBtnText, styles.bookBtnText]}>Book Now</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, styles.bookBtn, { backgroundColor: theme.tint, marginHorizontal: 0 }]}
                onPress={handleBookAppointment}
                activeOpacity={0.8}
              >
                <Calendar size={20} color="#FFF" />
                <Text style={[styles.actionBtnText, styles.bookBtnText]}>Book Appointment</Text>
              </TouchableOpacity>
            )}
          </BlurView>
        )}
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingBottom: 122,
  },
  skeletonWrap: {
    paddingBottom: 120,
  },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { fontSize: 16, marginBottom: 20 },
  backButtonCenter: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  backButtonTextCenter: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  profileHeaderRow: {
    height: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileHeaderBackButtonTouch: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  profileHeaderTitle: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  profileHeaderSpacer: {
    width: 40,
    height: 40,
  },
  headerBanner: { height: 146, width: '100%', borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  themeBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCardWrapper: { alignItems: 'center', marginTop: -60, paddingHorizontal: 20 },
  profileCardWrapperTight: { marginTop: -12 },
  profileBackButton: {
    position: 'absolute',
    left: 4,
    zIndex: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  profileBackButtonCommunity: {
    top: -18,
  },
  profileIdentityCard: {
    width: '100%',
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    paddingTop: 26,
    paddingBottom: 18,
    paddingHorizontal: 18,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  profileCardAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  doctorHeroRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  doctorHeroContent: {
    flex: 1,
    minWidth: 0,
  },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: '#FFF', backgroundColor: '#E2E8F0' },
  doctorNameRow: { flexDirection: 'row', alignItems: 'center' },
  doctorName: {
    flexShrink: 1,
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: 0.2,
    lineHeight: 29,
  },
  doctorSubtitle: {
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600',
  },
  profileMetaRowLeft: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  profileInfo: { alignItems: 'center', marginTop: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' },
  name: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
    lineHeight: 29,
    textAlign: 'center',
    flexShrink: 1,
    maxWidth: '90%',
  },
  subtitle: { fontSize: 14, marginTop: 4, fontWeight: '600' },
  profileMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  profileMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: width * 0.56,
  },
  profileMetaText: { fontSize: 12, fontWeight: '700' },
  profileFooterArea: {
    width: '100%',
    marginTop: 12,
    alignItems: 'flex-start',
  },
  socialStatsRow: {
    width: '100%',
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  socialStatCol: {
    flex: 1,
    alignItems: 'center',
  },
  socialStatValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  socialStatLabel: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  followButton: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  fbProfileTop: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 0,
  },
  fbAvatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 4,
    borderColor: '#FFF',
    backgroundColor: '#E2E8F0',
  },
  fbMetaCol: {
    marginLeft: 12,
    flex: 1,
    paddingRight: 6,
  },
  fbName: {
    fontSize: 22,
    fontWeight: '800',
  },
  fbSubtitle: {
    fontSize: 14,
    marginTop: 2,
    fontWeight: '500',
  },
  fbStatsWrap: {
    width: '100%',
    alignItems: 'stretch',
    marginTop: 10,
  },
  followButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileRoleBadge: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  profileRoleBadgeInline: {
    alignSelf: 'flex-start',
  },
  profileRoleBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  sectionsContainer: { paddingHorizontal: 20, marginTop: 14 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, gap: 10 },
  statBox: { flex: 1, paddingHorizontal: 10, paddingVertical: 14, borderRadius: 16, alignItems: 'center', borderWidth: 1, minHeight: 112 },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  statValue: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  statLabel: { fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 15 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12, letterSpacing: 0.2 },
  bioText: { fontSize: 15, lineHeight: 23 },
  detailCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  detailRow: { paddingHorizontal: 14, paddingVertical: 12 },
  detailRowDivider: { borderBottomWidth: 1 },
  detailLabel: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  detailValue: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  locationBox: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1 },
  locationIconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  locationText: { fontSize: 15, fontWeight: '600', flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1 },
  infoCol: { marginLeft: 16, flex: 1 },
  infoLabel: { fontSize: 13, marginBottom: 4 },
  infoValue: { fontSize: 16, fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    justifyContent: 'space-between',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
  },
  actionBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderRadius: 14, marginHorizontal: 6 },
  messageBtn: { borderWidth: 1 },
  bookBtn: {
    shadowColor: '#0f5132',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 6,
  },
  actionBtnText: { fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  messageBtnText: {},
  bookBtnText: { color: '#FFF' },

  // Redesigned Doctor Profile Layout styles
  claimedProfileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginTop: 6,
    marginBottom: 4,
  },
  claimedProfileText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#10B981',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  bulletText: {
    fontSize: 13,
    fontWeight: '600',
  },
  locationPinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  locationPinText: {
    fontSize: 13,
    fontWeight: '500',
  },
  cardFeeContainer: {
    width: '100%',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardFeeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cardFeeAmount: {
    fontSize: 20,
    fontWeight: '900',
    color: '#10B981',
  },
  tabsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderBottomWidth: 1,
    marginBottom: 10,
    width: '100%',
  },
  tabItem: {
    alignItems: 'center',
    paddingVertical: 12,
    position: 'relative',
    flex: 1,
  },
  activeTabItem: {},
  tabText: {
    fontSize: 14,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 3,
    borderRadius: 2,
  },
  overviewSection: {
    marginBottom: 20,
  },
  overviewSectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: 0.1,
  },
  overviewBioText: {
    fontSize: 14,
    lineHeight: 22,
  },
  specializationsList: {
    paddingLeft: 4,
  },
  clinicCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 14,
  },
  clinicHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  clinicNameCol: {
    flex: 1,
    marginRight: 10,
  },
  clinicName: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
    marginBottom: 4,
  },
  clinicAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  clinicAddressText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    flex: 1,
  },
  clinicFeeCol: {
    alignItems: 'flex-end',
  },
  clinicFeeLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  clinicFeeValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  clinicTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#DFE7E4',
  },
  clinicDays: {
    fontSize: 13,
    fontWeight: '700',
    marginRight: 8,
  },
  clinicHours: {
    fontSize: 12,
    fontWeight: '500',
  },
  clinicConsultButton: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  clinicConsultButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  experienceCard: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  experienceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  experienceTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  experienceDetails: {
    padding: 12,
  },
  experienceRole: {
    fontSize: 13,
    fontWeight: '600',
  },
  experienceLocation: {
    fontSize: 12,
    marginTop: 2,
  },
  experienceDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  experienceDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  educationCard: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  educationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  educationTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  educationDetails: {
    padding: 12,
  },
  educationUni: {
    fontSize: 13,
    fontWeight: '600',
  },
  educationLocation: {
    fontSize: 12,
    marginTop: 2,
  },
  educationDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  educationDate: {
    fontSize: 12,
    fontWeight: '500',
  },
  reviewsSummaryCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  reviewsRatingValue: {
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 6,
  },
  reviewsStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewsRatingLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  feedbackCommentCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  feedbackCommentText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  askDoctorCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  askDoctorIcon: {
    marginBottom: 12,
  },
  askDoctorTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  askDoctorText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 18,
  },
  askDoctorButton: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askDoctorButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
