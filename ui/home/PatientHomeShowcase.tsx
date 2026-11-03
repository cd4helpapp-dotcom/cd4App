import React from 'react';
import {
    Image,
    ImageSourcePropType,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
    Activity,
    ArrowRight,
    ArrowUp,
    Baby,
    Bone,
    Brain,
    Droplets,
    Eye,
    Flower2,
    HeartPulse,
    Pill,
    Stethoscope,
    Thermometer,
    Wind,
    Bell,
    BadgeCheck,
    ChevronRight,
    FileText,
    Mic,
    Phone,
    Siren,
    Sparkles,
    Star,
    UserRound,
    Users,
    Video,
} from 'lucide-react-native';
import { useNotificationsSystem } from '../../hooks/useNotificationsSystem';
import { useAppTheme } from '../../hooks/useAppTheme';
import { PRO_PLAN_ENABLED } from '../../constants/Config';
import { elevation, Radius, Spacing, Typography } from '../../constants/Design';
import ClayIcon, { ArtBadge, iconForConcern, useClayTones, type IconComponent } from '../common/ClayIcon';
import DoctorAvatar from '../common/DoctorAvatar';
import { getNameInitials as getInitials } from '../../src/utils/doctors';

// Kept for callers that pass a partial theme; the component reads the full palette from useAppTheme().
type HomeTheme = {
    background: string;
    text: string;
    textSecondary: string;
    cardBackground: string;
    borderColor: string;
    successLight: string;
    success: string;
    tint: string;
};

type HomeDoctor = {
    id: string;
    name: string;
    specialization?: string | null;
    experience?: string | number | null;
    image?: string | null;
    feeLabel?: string | null;
    ratingLabel: string;
    isVerified?: boolean;
    city?: string | null;
};

type HomeDepartment = {
    id: string;
    label: string;
    Icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
    imageSource?: ImageSourcePropType;
};

type HomeConcern = { id: string; label: string; imageSource?: ImageSourcePropType };
type HomePromoDoctor = { id: string; name: string; specialization?: string | null; ratingLabel: string; image?: string | null };
type HomePromo = {
    id: string;
    tag: string;
    title: string;
    description: string;
    cta?: string;
    action?: string;
    doctors?: HomePromoDoctor[];
};

type Props = {
    theme: HomeTheme;
    locationCityLabel: string;
    showHeader?: boolean;
    selectedCityLabel: string;
    doctors: HomeDoctor[];
    departments: HomeDepartment[];
    concerns: HomeConcern[];
    promos: HomePromo[];
    isProUser: boolean;
    // 'error' shows a retry card instead of silently hiding the specialists section.
    doctorsCaption?: string;
    doctorsStatus?: 'ready' | 'error';
    onRetryDoctors?: () => void;
    aiTitle: string;
    aiSubtitle: string;
    symptomPlaceholder: string;
    symptomInput: string;
    isListening: boolean;
    shouldEmphasizeVoiceCta: boolean;
    shouldPulseMicButton: boolean;
    voicePulse: any;
    onSymptomChange: (value: string) => void;
    onSymptomSubmit: () => void;
    onVoicePress: () => void;
    onUpgrade: () => void;
    onViewAllDoctors: () => void;
    onDoctorProfile: (id?: string) => void;
    onConsultDoctor: (id?: string) => void;
    onNotificationPress: () => void;
    onProfilePress: () => void;
    onQuickAction: (label: string) => void;
    onConcernPress: (label: string) => void;
    onViewAllConcerns: () => void;
    onPromoPress: (id: string) => void;
    onEmergencyPress: () => void;
    onDepartmentPress: (label: string) => void;
    onViewAllDepartments: () => void;
};

type PatientHomeHeaderProps = Pick<Props, 'theme' | 'locationCityLabel' | 'onNotificationPress' | 'onProfilePress'>;

const EMERGENCY_NUMBER = '112';
const HOME_GUTTER = 20;
// Fixed gradient per promo type so a card keeps its colour when the order changes.
const PROMO_ACTION_ORDER = ['best_doctors', 'best_doctors_global', 'ai_chat', 'voice_triage', 'report_assistant'];
const CONCERN_TILE_WIDTH = 124;

// Compact labels for the 4-column grid, where long single words would otherwise break mid-word.
const SHORT_DEPARTMENT_LABELS: Record<string, string> = {
    gastroenterology: 'Gastro & Liver',
    ophthalmology: 'Eye Care',
    endocrinology: 'Diabetes & Thyroid',
    otorhinolaryngology: 'ENT',
    obstetrics: "Women's Health",
    gynecology: "Women's Health",
    'general physician': 'General Physician',
    dermatology: 'Skin & Hair',
    rheumatology: 'Joints',
    pulmonology: 'Lungs & Chest',
    nephrology: 'Kidney',
    neurology: 'Brain & Nerves',
};
const shortDepartmentLabel = (label: string) => SHORT_DEPARTMENT_LABELS[label.trim().toLowerCase()] || label;


function IconButton({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
    const { theme } = useAppTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={6}
            style={({ pressed }) => [
                styles.headerIcon,
                { backgroundColor: pressed ? theme.surfaceMuted : theme.cardBackground, borderColor: theme.borderColor },
            ]}
        >
            {children}
        </Pressable>
    );
}

export function PatientHomeHeader({ locationCityLabel, onNotificationPress, onProfilePress }: PatientHomeHeaderProps) {
    const { theme } = useAppTheme();
    const { unreadCount } = useNotificationsSystem();

    return (
        <View style={[styles.brandHeader, { backgroundColor: theme.background }]}>
            <View style={styles.brandIdentity}>
                <Image source={require('../../assets/images/cd4_logo.png')} style={styles.brandLogo} resizeMode="contain" />
                <View style={styles.brandCopy}>
                    <Text style={[styles.brandName, { color: theme.text }]} numberOfLines={1}>
                        CD4
                    </Text>
                    <View style={styles.locationRow}>
                        <View style={[styles.locationDot, { backgroundColor: theme.success }]} />
                        <Text style={[styles.brandLocation, { color: theme.textSecondary }]} numberOfLines={1}>
                            {locationCityLabel}, India
                        </Text>
                    </View>
                </View>
            </View>
            <View style={styles.headerActions}>
                <IconButton onPress={onNotificationPress} label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
                    <Bell size={18} color={theme.text} />
                    {unreadCount > 0 ? (
                        <View style={[styles.notificationBadge, { backgroundColor: theme.danger, borderColor: theme.background }]}>
                            <Text style={styles.notificationBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                        </View>
                    ) : null}
                </IconButton>
                <IconButton onPress={onProfilePress} label="Profile">
                    <UserRound size={18} color={theme.text} />
                </IconButton>
            </View>
        </View>
    );
}

function SectionHeader({ title, caption, onViewAll, viewAllLabel }: { title: string; caption?: string; onViewAll?: () => void; viewAllLabel?: string }) {
    const { theme } = useAppTheme();
    return (
        <View style={styles.sectionHeader}>
            <View style={styles.flexShrink}>
                <Text style={[Typography.heading, { color: theme.text }]} accessibilityRole="header">
                    {title}
                </Text>
                {caption ? <Text style={[Typography.caption, { color: theme.textSecondary, marginTop: 2 }]}>{caption}</Text> : null}
            </View>
            {onViewAll ? (
                <Pressable onPress={onViewAll} accessibilityRole="button" accessibilityLabel={viewAllLabel || `View all ${title}`} hitSlop={8} style={styles.viewAll}>
                    <Text style={[Typography.label, { color: theme.primary }]}>See all</Text>
                    <ChevronRight size={16} color={theme.primary} strokeWidth={2.5} />
                </Pressable>
            ) : null}
        </View>
    );
}

export function PatientHomeShowcase({
    locationCityLabel,
    showHeader = true,
    selectedCityLabel,
    doctors,
    departments,
    concerns,
    promos,
    isProUser,
    doctorsStatus = 'ready',
    doctorsCaption,
    onRetryDoctors,
    aiTitle,
    aiSubtitle,
    symptomPlaceholder,
    symptomInput,
    isListening,
    shouldEmphasizeVoiceCta,
    shouldPulseMicButton,
    voicePulse,
    onSymptomChange,
    onSymptomSubmit,
    onVoicePress,
    onUpgrade,
    onViewAllDoctors,
    onDoctorProfile,
    onConsultDoctor,
    onNotificationPress,
    onProfilePress,
    onQuickAction,
    onConcernPress,
    onViewAllConcerns,
    onPromoPress,
    onEmergencyPress,
    onDepartmentPress,
    onViewAllDepartments,
    theme: legacyTheme,
}: Props) {
    const { theme, isDark } = useAppTheme();
    const toneAt = useClayTones();
    const { width: screenWidth } = useWindowDimensions();
    const promoCardWidth = Math.max(240, Math.min(320, screenWidth - 48));
    const promoScrollStep = promoCardWidth + Spacing.md;
    const promoCarouselRef = React.useRef<ScrollViewInstance | null>(null);
    const hasTypedSymptom = symptomInput.trim().length > 0;

    const promoItems: HomePromo[] =
        promos.length > 0
            ? promos
            : [
                  { id: 'best-doctors-fallback', tag: 'Best Doctors', title: 'Find the right specialist', description: 'Browse verified doctors and book a consultation.' },
                  { id: 'ai-chat-fallback', tag: 'CD4 AI', title: 'Get guided health support', description: 'Share your concern and get the next best step.' },
                  { id: 'records-fallback', tag: 'Health Records', title: 'Keep your care organized', description: 'Access your reports and consultation history.' },
              ];

    // Cards never auto-scroll (that moved content under the user's finger); dots follow the manual scroll.
    const [activePromo, setActivePromo] = React.useState(0);
    const handlePromoScroll = (event: any) => {
        const next = Math.round(event.nativeEvent.contentOffset.x / promoScrollStep);
        setActivePromo((current) => (current === next ? current : next));
    };
    const promoCount = Math.min(promoItems.length, 4);
    // Auto-advance every 4.5s and wrap from the last card back to the first. Any manual drag pauses it for 8s
    // so the strip never moves under the user's finger.
    const promoPausedUntilRef = React.useRef(0);
    const activePromoRef = React.useRef(0);
    activePromoRef.current = activePromo;
    React.useEffect(() => {
        if (promoCount < 2) return;
        const timer = setInterval(() => {
            if (Date.now() < promoPausedUntilRef.current) return;
            const next = (activePromoRef.current + 1) % promoCount;
            promoCarouselRef.current?.scrollTo({ x: next * promoScrollStep, animated: true });
            setActivePromo(next);
        }, 4500);
        return () => clearInterval(timer);
    }, [promoCount, promoScrollStep]);
    const promoGradients = (isDark
        ? [['#0F5F5B', '#0A3A44'], ['#1B3F9B', '#14275E'], ['#5B2FB3', '#34196B'], ['#9A4A0C', '#5C2C08']]
        : [['#059669', '#047857'], ['#2F6BEB', '#1A3FA8'], ['#7C4DDB', '#4B2AA0'], ['#E0701A', '#A8480C']]) as Array<[string, string]>;
    const promoIcon = (tag: string): IconComponent =>
        /doctor|specialist/i.test(tag) ? Stethoscope : /ai|assistant|voice|chat/i.test(tag) ? Sparkles : /record|report|health/i.test(tag) ? FileText : Activity;

    const quickActions = [
        { label: 'Reports', Icon: FileText, tone: theme.primary, soft: theme.primarySoft },
        { label: 'AI Insights', Icon: Sparkles, tone: theme.accent, soft: theme.accentSoft },
        { label: 'Community', Icon: Users, tone: isDark ? '#C4B5FD' : '#6D28D9', soft: isDark ? '#231B3D' : '#F3EEFF' },
        { label: 'Video Call', Icon: Video, tone: isDark ? '#FDBA74' : '#C2410C', soft: isDark ? '#33210F' : '#FFF3E8' },
    ];

    const heroGradient = (isDark ? ['#065F46', '#073B2C', '#062A22'] : ['#047857', '#059669', '#10B981']) as [string, string, string];

    return (
        <>
            {showHeader ? (
                <PatientHomeHeader theme={legacyTheme} locationCityLabel={locationCityLabel} onNotificationPress={onNotificationPress} onProfilePress={onProfilePress} />
            ) : null}

            {/* Hero: layered gradient + soft orbs give depth without heavy 3D assets. */}
            <View style={[styles.heroShadow, elevation(3, isDark ? '#000' : '#047857')]}>
                <LinearGradient colors={heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
                    <View pointerEvents="none" style={[styles.orb, styles.orbLarge]} />
                    <View pointerEvents="none" style={[styles.orb, styles.orbSmall]} />
                    <LinearGradient
                        pointerEvents="none"
                        colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.heroSheen}
                    />

                    <View style={styles.heroTopRow}>
                        <View style={styles.onlinePill}>
                            <View style={styles.onlineDot} />
                            <Text style={styles.onlinePillText}>CD4 AI</Text>
                        </View>
                        {isProUser ? (
                            <View style={styles.proPill}>
                                <BadgeCheck size={13} color="#0B4F4C" />
                                <Text style={styles.proPillText}>PRO</Text>
                            </View>
                        ) : PRO_PLAN_ENABLED ? (
                            <Pressable onPress={onUpgrade} accessibilityRole="button" style={styles.proPill}>
                                <Sparkles size={13} color="#0B4F4C" />
                                <Text style={styles.proPillText}>Go Pro</Text>
                            </Pressable>
                        ) : null}
                    </View>

                    <Text style={styles.heroTitle}>{aiTitle || 'How can I help you today?'}</Text>
                    <Text style={styles.heroSubtitle}>{aiSubtitle || 'Describe your symptoms by voice or text.'}</Text>

                    <View style={[styles.heroInputWrap, isListening && styles.heroInputListening]}>
                        <TextInput
                            style={[styles.heroInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
                            placeholder={symptomPlaceholder}
                            placeholderTextColor="rgba(255,255,255,0.7)"
                            value={symptomInput}
                            onChangeText={onSymptomChange}
                            onSubmitEditing={onSymptomSubmit}
                            returnKeyType="send"
                            accessibilityLabel="Describe your symptoms"
                        />
                        <Pressable
                            onPress={hasTypedSymptom ? onSymptomSubmit : onVoicePress}
                            accessibilityRole="button"
                            accessibilityLabel={hasTypedSymptom ? 'Send symptoms' : 'Start voice assistant'}
                            style={shouldPulseMicButton && !hasTypedSymptom ? { transform: [{ scale: voicePulse }] } : null}
                        >
                            {/* Glossy button: base gradient + top highlight reads as a raised 3D control. */}
                            <LinearGradient colors={['#FFFFFF', '#D8F5F1']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.heroMic}>
                                <View pointerEvents="none" style={styles.heroMicHighlight} />
                                {hasTypedSymptom || !shouldEmphasizeVoiceCta ? (
                                    <ArrowUp size={22} color="#0B4F4C" strokeWidth={2.6} />
                                ) : (
                                    <Mic size={22} color="#0B4F4C" strokeWidth={2.4} />
                                )}
                            </LinearGradient>
                        </Pressable>
                    </View>
                    <Text style={styles.heroDisclaimer}>AI guidance is not a diagnosis. In an emergency call {EMERGENCY_NUMBER}.</Text>
                </LinearGradient>
            </View>

            <View style={styles.quickActionsRow}>
                {quickActions.map(({ label, Icon, tone, soft }) => (
                    <Pressable
                        key={label}
                        style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
                        onPress={() => onQuickAction(label)}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                    >
                        <View style={[styles.quickIcon, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
                            <View style={[styles.quickIconInner, { backgroundColor: soft }]}>
                                <Icon size={20} color={tone} />
                            </View>
                        </View>
                        <Text style={[styles.quickLabel, { color: theme.text }]} numberOfLines={1}>
                            {label}
                        </Text>
                    </Pressable>
                ))}
            </View>

            {concerns.length > 0 ? (
                <View style={styles.section}>
                    <SectionHeader title="Choose your concern" caption="Start a guided AI check-up" onViewAll={onViewAllConcerns} viewAllLabel="View all concerns" />
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.bleed}
                        contentContainerStyle={styles.hList}
                        snapToInterval={CONCERN_TILE_WIDTH + Spacing.md}
                        decelerationRate="fast"
                    >
                        {concerns.slice(0, 8).map((concern, index) => (
                            <Pressable
                                key={concern.id}
                                style={({ pressed }) => [styles.concernCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, pressed && styles.pressed]}
                                onPress={() => onConcernPress(concern.label)}
                                accessibilityRole="button"
                                accessibilityLabel={`${concern.label}, start AI triage`}
                            >
                                <View style={styles.concernArt}>{concern.imageSource ? (
                                    <ArtBadge source={concern.imageSource} tone={toneAt(index)} size={68} />
                                ) : (
                                    <ClayIcon Icon={iconForConcern(concern.label)} tone={toneAt(index)} size={60} />
                                )}</View>
                                <Text numberOfLines={2} style={[styles.tileLabel, { color: theme.text }]}>
                                    {concern.label}
                                </Text>
                                <Text style={[Typography.caption, styles.center, { color: theme.textSecondary }]}>AI check-up</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            ) : null}

            <View style={styles.section}>
                <SectionHeader title="Second opinion" caption="Expert review of your diagnosis or treatment plan" />
                <Pressable
                    style={({ pressed }) => [styles.secondOpinionCard, { borderColor: theme.borderColor }, pressed && styles.pressed]}
                    onPress={() => onPromoPress('second-opinion')}
                    accessibilityRole="button"
                    accessibilityLabel="Book a second opinion"
                >
                    <Image source={require('../../assets/second_opinion.jpeg')} style={styles.fill} resizeMode="cover" />
                </Pressable>
            </View>

            <View style={[styles.emergencyCard, { backgroundColor: theme.dangerSoft, borderColor: theme.dangerBorder }]}>
                <View style={styles.emergencyTop}>
                    <View style={[styles.emergencyIcon, { backgroundColor: theme.danger }]}>
                        <Siren size={20} color="#FFFFFF" />
                    </View>
                    <View style={styles.flexShrink}>
                        <Text style={[Typography.subheading, { color: theme.text }]}>Medical emergency?</Text>
                        <Text style={[Typography.caption, { color: theme.textSecondary, marginTop: 2 }]}>
                            Call {EMERGENCY_NUMBER} for an ambulance. For urgent advice, consult a doctor online.
                        </Text>
                    </View>
                </View>
                <View style={styles.emergencyActions}>
                    <Pressable
                        onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`).catch(() => {})}
                        accessibilityRole="button"
                        accessibilityLabel={`Call ${EMERGENCY_NUMBER}`}
                        style={({ pressed }) => [styles.emergencyButton, { backgroundColor: theme.danger }, pressed && styles.pressed]}
                    >
                        <Phone size={16} color="#FFFFFF" />
                        <Text style={styles.emergencyButtonText}>Call {EMERGENCY_NUMBER}</Text>
                    </Pressable>
                    <Pressable
                        onPress={onEmergencyPress}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.emergencyButton,
                            { backgroundColor: theme.cardBackground, borderColor: theme.dangerBorder, borderWidth: 1 },
                            pressed && styles.pressed,
                        ]}
                    >
                        <Video size={16} color={theme.danger} />
                        <Text style={[styles.emergencyButtonText, { color: theme.danger }]}>Consult online</Text>
                    </Pressable>
                </View>
            </View>

            {departments.length > 0 ? (
                <View style={styles.section}>
                    <SectionHeader title="Explore departments" caption="Find the right specialist" onViewAll={onViewAllDepartments} viewAllLabel="View all departments" />
                    <View style={[styles.departmentGrid, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        {departments.slice(0, 8).map((department, index) => (
                            <Pressable
                                key={department.id}
                                style={({ pressed }) => [styles.departmentItem, pressed && styles.pressed]}
                                onPress={() => onDepartmentPress(department.label)}
                                accessibilityRole="button"
                                accessibilityLabel={department.label}
                            >
                                {department.imageSource ? (
                                    <ArtBadge source={department.imageSource} tone={toneAt(index + 1)} size={60} />
                                ) : (
                                    <ClayIcon Icon={department.Icon || Stethoscope} tone={toneAt(index + 1)} size={52} />
                                )}
                                <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.departmentLabel, { color: theme.text }]}>
                                    {shortDepartmentLabel(department.label)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : null}

            <View style={styles.section}>
                <ScrollView
                    ref={promoCarouselRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.bleed}
                    contentContainerStyle={styles.hList}
                    decelerationRate="fast"
                    snapToInterval={promoScrollStep}
                    snapToAlignment="start"
                    onScroll={handlePromoScroll}
                    onScrollBeginDrag={() => { promoPausedUntilRef.current = Date.now() + 8000; }}
                    onMomentumScrollEnd={() => { promoPausedUntilRef.current = Date.now() + 8000; }}
                    scrollEventThrottle={32}
                >
                    {promoItems.slice(0, 4).map((promo, index) => {
                        const PromoIcon = promoIcon(promo.tag);
                        const gradient = promoGradients[(PROMO_ACTION_ORDER.indexOf(promo.action || '') >= 0 ? PROMO_ACTION_ORDER.indexOf(promo.action || '') : index) % 4];
                        const hasDoctors = Boolean(promo.doctors && promo.doctors.length > 0);
                        return (
                            <Pressable
                                key={promo.id}
                                style={({ pressed }) => [styles.promoShadow, { width: promoCardWidth, shadowColor: gradient[1] }, pressed && styles.pressed]}
                                onPress={() => onPromoPress(promo.id)}
                                accessibilityRole="button"
                                accessibilityLabel={`${promo.title}. ${promo.cta || 'Open'}`}
                            >
                                <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.promoCard}>
                                    <View pointerEvents="none" style={styles.promoOrbA} />
                                    <View pointerEvents="none" style={styles.promoOrbB} />
                                    <View pointerEvents="none" style={styles.promoSheen} />

                                    <View style={styles.promoTopRow}>
                                        <View style={styles.promoTagChip}>
                                            <PromoIcon size={13} color="#FFFFFF" strokeWidth={2.2} />
                                            <Text style={styles.promoTag}>{promo.tag.toUpperCase()}</Text>
                                        </View>
                                    </View>

                                    <Text numberOfLines={2} style={styles.promoTitle}>{promo.title}</Text>

                                    {hasDoctors ? (
                                        <View style={styles.promoDoctors}>
                                            {promo.doctors!.map((doctor) => (
                                                <View key={doctor.id} style={styles.promoDoctorRow}>
                                                    {doctor.image ? (
                                                        <Image source={{ uri: doctor.image }} style={styles.promoDoctorAvatar} />
                                                    ) : (
                                                        <View style={[styles.promoDoctorAvatar, styles.promoDoctorAvatarFallback]}>
                                                            <Text style={styles.promoDoctorInitials}>{getInitials(doctor.name)}</Text>
                                                        </View>
                                                    )}
                                                    <View style={styles.promoDoctorText}>
                                                        <Text numberOfLines={1} style={styles.promoDoctorName}>{doctor.name}</Text>
                                                        {doctor.specialization ? <Text numberOfLines={1} style={styles.promoDoctorSpec}>{doctor.specialization}</Text> : null}
                                                    </View>
                                                    <View style={styles.promoRating}>
                                                        <Star size={11} color="#FDE68A" fill="#FDE68A" />
                                                        <Text style={styles.promoRatingText}>{doctor.ratingLabel}</Text>
                                                    </View>
                                                </View>
                                            ))}
                                        </View>
                                    ) : (
                                        <Text numberOfLines={3} style={styles.promoDesc}>{promo.description}</Text>
                                    )}

                                    <View style={styles.promoCta}>
                                        <Text style={styles.promoCtaText}>{promo.cta || 'Open'}</Text>
                                        <ArrowRight size={15} color="#FFFFFF" strokeWidth={2.4} />
                                    </View>
                                </LinearGradient>
                            </Pressable>
                        );
                    })}
                </ScrollView>
                {promoCount > 1 ? (
                    <View style={styles.dotsRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        {Array.from({ length: promoCount }).map((_, i) => (
                            <View key={i} style={[styles.dot, { backgroundColor: i === activePromo ? theme.primary : theme.borderColor, width: i === activePromo ? 18 : 6 }]} />
                        ))}
                    </View>
                ) : null}
            </View>

            {doctorsStatus === 'error' && doctors.length === 0 ? (
                <View style={styles.section}>
                    <SectionHeader title="Top specialists" />
                    <View style={[styles.errorCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[Typography.bodyStrong, { color: theme.text }]}>Couldn't load doctors</Text>
                        <Text style={[Typography.caption, { color: theme.textSecondary }]}>Check your internet connection and try again.</Text>
                        {onRetryDoctors ? (
                            <Pressable onPress={onRetryDoctors} accessibilityRole="button" style={[styles.retryButton, { borderColor: theme.primaryBorder, backgroundColor: theme.primarySoft }]}>
                                <Text style={[Typography.label, { color: theme.primary }]}>Retry</Text>
                            </Pressable>
                        ) : null}
                    </View>
                </View>
            ) : null}

            {doctors.length > 0 ? (
                <View style={styles.section}>
                    <SectionHeader title="Top specialists" caption={doctorsCaption || `Available near ${selectedCityLabel}`} onViewAll={onViewAllDoctors} viewAllLabel="View all specialists" />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.hList} snapToInterval={272 + Spacing.md} decelerationRate="fast">
                        {doctors.slice(0, 6).map((doctor) => (
                            <View key={doctor.id} style={[styles.doctorCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
                                <Pressable style={styles.doctorMain} onPress={() => onDoctorProfile(doctor.id)} accessibilityRole="button" accessibilityLabel={`View ${doctor.name}'s profile`}>
                                    <View style={styles.doctorTop}>
                                        <DoctorAvatar uri={doctor.image} name={doctor.name} />
                                        <View style={styles.flexShrink}>
                                            <View style={styles.nameRow}>
                                                <Text numberOfLines={2} style={[Typography.subheading, styles.flexShrink, { color: theme.text }]}>
                                                    {doctor.name}
                                                </Text>
                                                {doctor.isVerified ? <BadgeCheck size={16} color={theme.primary} accessibilityLabel="Verified doctor" /> : null}
                                            </View>
                                            <Text numberOfLines={1} style={[Typography.caption, { color: theme.textSecondary, marginTop: 2 }]}>
                                                {doctor.specialization || 'Specialist'}
                                            </Text>
                                            <Text numberOfLines={1} style={[Typography.caption, { color: theme.textSecondary, marginTop: 1 }]}>
                                                {[doctor.experience ? `${doctor.experience} yrs exp` : '', doctor.city || ''].filter(Boolean).join(' · ')}
                                            </Text>
                                            {/* A doctor without reviews shows "New", not a star that reads like a rating. */}
                                            {/^\d/.test(doctor.ratingLabel) ? (
                                                <View style={[styles.ratingPill, { backgroundColor: theme.warningSoft }]}>
                                                    <Star size={11} color="#F59E0B" fill="#F59E0B" />
                                                    <Text style={[Typography.caption, { color: theme.text, fontWeight: '600' }]}>{doctor.ratingLabel}</Text>
                                                </View>
                                            ) : (
                                                <View style={[styles.ratingPill, { backgroundColor: theme.primarySoft }]}>
                                                    <Text style={[Typography.caption, { color: theme.primary, fontWeight: '700' }]}>New on CD4</Text>
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                </Pressable>
                                <View style={[styles.doctorBottom, { borderTopColor: theme.divider }]}>
                                    <View>
                                        <Text style={[Typography.overline, { color: theme.textTertiary }]}>FEE</Text>
                                        <Text style={[Typography.bodyStrong, { color: theme.text }]}>{doctor.feeLabel || 'On request'}</Text>
                                    </View>
                                    <Pressable
                                        style={({ pressed }) => [styles.consult, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary }]}
                                        onPress={() => onConsultDoctor(doctor.id)}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Consult ${doctor.name}`}
                                    >
                                        <Text style={styles.consultText}>Consult</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ))}
                    </ScrollView>
                </View>
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    fill: { width: '100%', height: '100%' },
    center: { textAlign: 'center' },
    flexShrink: { flexShrink: 1, flex: 1 },
    pressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },

    brandHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        marginBottom: Spacing.sm,
    },
    brandIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
    brandLogo: { width: 38, height: 38, borderRadius: 10, marginRight: Spacing.md },
    brandCopy: { flex: 1, minWidth: 0 },
    brandName: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
    locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
    locationDot: { width: 6, height: 6, borderRadius: 3 },
    brandLocation: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
    headerActions: { flexDirection: 'row', gap: Spacing.sm, marginLeft: Spacing.sm },
    headerIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    notificationBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    notificationBadgeText: { color: '#FFFFFF', fontSize: 9, lineHeight: 11, fontWeight: '800' },

    heroShadow: { borderRadius: 24, marginBottom: Spacing.xl },
    heroCard: { overflow: 'hidden', borderRadius: 24, padding: Spacing.xl },
    heroSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: 120 },
    orb: { position: 'absolute', borderRadius: 999 },
    orbLarge: { width: 220, height: 220, right: -70, top: -60, backgroundColor: 'rgba(255,255,255,0.10)' },
    orbSmall: { width: 120, height: 120, right: 40, bottom: -50, backgroundColor: 'rgba(46,196,182,0.35)' },
    heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    onlinePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: Radius.pill,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
    },
    onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#5EF2C2' },
    onlinePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    proPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: Radius.pill,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#FFFFFF',
    },
    proPillText: { color: '#0B4F4C', fontSize: 12, fontWeight: '700' },
    heroTitle: { color: '#FFFFFF', fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.4, marginTop: Spacing.xl, maxWidth: 280 },
    heroSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20, marginTop: Spacing.sm, maxWidth: 300 },
    heroInputWrap: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Radius.lg,
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        marginTop: Spacing.xl,
        paddingLeft: Spacing.lg,
        paddingRight: 6,
    },
    heroInputListening: { borderColor: '#5EF2C2', backgroundColor: 'rgba(0,0,0,0.18)' },
    heroInput: { flex: 1, color: '#FFFFFF', fontSize: 15, height: '100%' },
    heroMic: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        ...elevation(2, '#000'),
    },
    heroMicHighlight: {
        position: 'absolute',
        top: 2,
        left: 8,
        right: 8,
        height: 16,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.75)',
    },
    heroDisclaimer: { color: 'rgba(255,255,255,0.7)', fontSize: 11, lineHeight: 15, marginTop: Spacing.md },

    quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.xxl },
    quickAction: { alignItems: 'center', width: '23%' },
    quickIcon: { width: 60, height: 60, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    quickIconInner: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    quickLabel: { fontSize: 12, fontWeight: '600', marginTop: Spacing.sm, textAlign: 'center' },

    section: { marginBottom: Spacing.xxl },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
    viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    // Carousels run edge to edge while the first card stays aligned with the page gutter.
    bleed: { marginHorizontal: -HOME_GUTTER },
    hList: { gap: Spacing.md, paddingHorizontal: HOME_GUTTER },
    tileLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600', textAlign: 'center', minHeight: 36, marginTop: 2 },
    promoText: { flex: 1 },

    concernCard: {
        width: CONCERN_TILE_WIDTH,
        borderRadius: Radius.lg,
        borderWidth: 1,
        alignItems: 'center',
        paddingVertical: Spacing.lg,
        paddingHorizontal: Spacing.sm,
        gap: 6,
        justifyContent: 'flex-start',
    },
    concernArt: { height: 68, alignItems: 'center', justifyContent: 'center' },

    // Banner is 1533×1026; matching its aspect ratio makes it fill the card exactly on every screen width.
    secondOpinionCard: { width: '100%', aspectRatio: 1533 / 1026, borderRadius: Radius.xl, borderWidth: 1, overflow: 'hidden', backgroundColor: '#FFFFFF' },

    emergencyCard: { borderRadius: Radius.xl, borderWidth: 1, padding: Spacing.lg, marginBottom: Spacing.xxl, gap: Spacing.md },
    emergencyTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    emergencyIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    emergencyActions: { flexDirection: 'row', gap: Spacing.sm },
    emergencyButton: {
        flex: 1,
        height: 44,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    emergencyButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

    departmentGrid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: Radius.xl, paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xs, rowGap: Spacing.lg },
    departmentItem: { width: '25%', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: 2 },
    departmentLabel: { fontSize: 12, lineHeight: 15, fontWeight: '600', textAlign: 'center' },

    promoShadow: { borderRadius: Radius.xl, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
    promoCard: { flex: 1, minHeight: 196, borderRadius: Radius.xl, padding: Spacing.lg + 2, overflow: 'hidden', gap: Spacing.sm + 2 },
    promoTopRow: { flexDirection: 'row', alignItems: 'center' },
    promoTagChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
    promoDoctors: { gap: 8 },
    promoDoctorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: Radius.md, padding: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
    promoDoctorAvatar: { width: 34, height: 34, borderRadius: 17 },
    promoDoctorAvatarFallback: { backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
    promoDoctorInitials: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    promoDoctorText: { flex: 1, minWidth: 0 },
    promoDoctorName: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
    promoDoctorSpec: { color: 'rgba(255,255,255,0.78)', fontSize: 11.5, marginTop: 1 },
    promoRating: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
    promoRatingText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    promoCta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 9, marginTop: 'auto', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    promoCtaText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    promoOrbA: { position: 'absolute', width: 150, height: 150, borderRadius: 75, right: -40, top: -50, backgroundColor: 'rgba(255,255,255,0.10)' },
    promoOrbB: { position: 'absolute', width: 90, height: 90, borderRadius: 45, right: 50, bottom: -45, backgroundColor: 'rgba(255,255,255,0.08)' },
    promoSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: 56, backgroundColor: 'rgba(255,255,255,0.10)' },
    promoTag: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
    promoTitle: { color: '#FFFFFF', fontSize: 18, lineHeight: 23, fontWeight: '700', marginTop: 4 },
    promoDesc: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, lineHeight: 17, marginTop: 6 },
    promoIconWrap: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
    dotsRow: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, marginTop: Spacing.md },
    dot: { height: 6, borderRadius: 3 },

    doctorCard: { width: 272, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg },
    doctorTop: { flexDirection: 'row', gap: Spacing.md },
    doctorMain: { flexGrow: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ratingPill: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        borderRadius: Radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 6,
    },
    doctorBottom: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        marginTop: Spacing.md,
        paddingTop: Spacing.md,
    },
    consult: { borderRadius: Radius.md, paddingHorizontal: 18, paddingVertical: 10 },
    errorCard: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, gap: 4, alignItems: 'flex-start' },
    retryButton: { marginTop: Spacing.sm, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 8 },
    consultText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
