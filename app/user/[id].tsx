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
      <View
        style={[
          styles.headerBanner,
          {
            backgroundColor: isDark ? '#171A19' : '#F3F7F5',
            borderBottomWidth: 1,
            borderBottomColor: isDark ? '#2B3130' : '#DFE7E4',
          },
        ]}
      />
      <View style={styles.profileCardWrapper}>
        <ShimmerBlock width={120} height={120} borderRadius={60} baseColor={palette.base} highlightColor={palette.glow} />
        <View style={styles.profileInfo}>
          <ShimmerBlock width={220} height={24} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
          <View style={{ height: 10 }} />
          <ShimmerBlock width={150} height={16} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
        </View>
      </View>

      <View style={styles.sectionsContainer}>
        <View style={styles.statsRow}>
          <ShimmerBlock width="31%" height={114} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
          <ShimmerBlock width="31%" height={114} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
          <ShimmerBlock width="31%" height={114} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
        </View>

        <ShimmerBlock width="46%" height={22} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
        <View style={{ height: 12 }} />
        <ShimmerBlock width="100%" height={70} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
        <View style={{ height: 22 }} />

        <ShimmerBlock width="55%" height={22} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
        <View style={{ height: 12 }} />
        <ShimmerBlock width="100%" height={158} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
      </View>
    </ScrollView>
  );
}

export default function PublicProfileScreen() {
  const { id, source } = useLocalSearchParams<{ id?: string | string[]; source?: string | string[] }>();
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

  const renderDoctorDetails = () => {
    const qualificationParts = [profile.degree, profile.university].filter(Boolean) as string[];
    if (profile.yearOfCompletion) qualificationParts.push(`Passed ${profile.yearOfCompletion}`);
    const qualification = qualificationParts.join(' • ');
    const registration = [profile.registrationNumber, profile.registrationCouncil].filter(Boolean).join(' • ');
    const expertise = formatList(profile.areasOfExpertise);
    const languages = formatList(profile.languagesSpoken);
    const professionalRows = [
      { label: 'Qualification', value: qualification },
      { label: 'Registration', value: registration },
      { label: 'Areas of Expertise', value: expertise },
      { label: 'Languages', value: languages },
      { label: 'Treatment Approach', value: profile.treatmentApproach || '' },
    ].filter((item) => item.value);
    const clinicParts = [profile.currentHospitalClinic, profile.city]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const uniqueClinicParts = Array.from(
      new Map(clinicParts.map((value) => [normalizeText(value), value])).values()
    );
    const clinicLine = uniqueClinicParts.join(', ');

    return (
      <View style={styles.sectionsContainer}>
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={[styles.statIconWrap, { backgroundColor: withOpacity(theme.tint, isDark ? 0.2 : 0.12) }]}>
              <Briefcase size={18} color={theme.tint} />
            </View>
            <Text style={[styles.statValue, { color: theme.text }]}>{profile.experience || 'N/A'}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Experience</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={[styles.statIconWrap, { backgroundColor: withOpacity(theme.tint, isDark ? 0.2 : 0.12) }]}>
              <IndianRupee size={18} color={theme.tint} />
            </View>
            <Text style={[styles.statValue, { color: theme.text }]}>{formatFeeValue(profile.fee)}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Consult Fee</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={[styles.statIconWrap, { backgroundColor: withOpacity('#F59E0B', isDark ? 0.2 : 0.16) }]}>
              <Star size={18} color="#F59E0B" fill="#F59E0B" />
            </View>
            <Text style={[styles.statValue, { color: theme.text }]}>{formattedRating}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Rating</Text>
          </View>
        </View>

        {profile.bio && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>About Doctor</Text>
            <Text style={[styles.bioText, { color: theme.textSecondary }]}>{profile.bio}</Text>
          </View>
        )}

        {clinicLine && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Clinic Location</Text>
            <View style={[styles.locationBox, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              <View style={[styles.locationIconBox, { backgroundColor: theme.tint + '20' }]}>
                <MapPin size={20} color={theme.tint} />
              </View>
              <Text style={[styles.locationText, { color: theme.text }]}>{clinicLine}</Text>
            </View>
          </View>
        )}

        {professionalRows.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Professional Details</Text>
            <View style={[styles.detailCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              {professionalRows.map((item, index) => (
                <View key={item.label} style={[styles.detailRow, index < professionalRows.length - 1 && styles.detailRowDivider, { borderBottomColor: theme.borderColor }]}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.detailValue, { color: theme.text }]}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {profile.previousWorkDetails && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Previous Work</Text>
            <Text style={[styles.bioText, { color: theme.textSecondary }]}>{profile.previousWorkDetails}</Text>
          </View>
        )}
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
                    <Text style={[styles.doctorSubtitle, { color: theme.textSecondary }]} numberOfLines={2}>
                      {isDoctor ? profile.specialization || 'Medical Specialist' : 'Patient'}
                    </Text>
                    {isDoctor ? (
                      <View style={[styles.profileRoleBadge, styles.profileRoleBadgeInline, { backgroundColor: withOpacity(theme.tint, isDark ? 0.2 : 0.1), borderColor: withOpacity(theme.tint, isDark ? 0.45 : 0.28) }]}>
                        <ShieldCheck size={12} color={theme.tint} />
                        <Text style={[styles.profileRoleBadgeText, { color: theme.tint }]}>Verified Clinical Profile</Text>
                      </View>
                    ) : null}
                    {isDoctor ? (
                      <View style={styles.profileMetaRowLeft}>
                        {profile.city ? (
                          <View style={[styles.profileMetaChip, { backgroundColor: withOpacity(theme.tint, isDark ? 0.2 : 0.11), borderColor: withOpacity(theme.tint, isDark ? 0.42 : 0.25) }]}>
                            <MapPin size={12} color={theme.tint} />
                            <Text style={[styles.profileMetaText, { color: theme.text }]} numberOfLines={1}>
                              {profile.city}
                            </Text>
                          </View>
                        ) : null}
                        {profile.experience ? (
                          <View style={[styles.profileMetaChip, { backgroundColor: withOpacity(theme.tint, isDark ? 0.2 : 0.11), borderColor: withOpacity(theme.tint, isDark ? 0.42 : 0.25) }]}>
                            <Briefcase size={12} color={theme.tint} />
                            <Text style={[styles.profileMetaText, { color: theme.text }]} numberOfLines={1}>
                              {profile.experience}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>
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
});
