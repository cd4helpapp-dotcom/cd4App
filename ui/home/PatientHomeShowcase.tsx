import React from 'react';
import { Image, ImageSourcePropType, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Activity, ArrowRight, Bell, CheckCircle, ChevronRight, FileText, Mic, ShieldCheck, Sparkles, Star, UserRound, Users, Video } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNotificationsSystem } from '../../hooks/useNotificationsSystem';

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
};

type HomeDepartment = {
    id: string;
    label: string;
    Icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
    imageSource?: ImageSourcePropType;
};

type HomeConcern = { id: string; label: string; imageSource?: ImageSourcePropType };
type HomePromo = { id: string; tag: string; title: string; description: string };

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

export function PatientHomeHeader({ theme, locationCityLabel, onNotificationPress, onProfilePress }: PatientHomeHeaderProps) {
    const { unreadCount } = useNotificationsSystem();

    return (
        <View style={[styles.brandHeader, { backgroundColor: theme.background }]}>
                <View style={styles.brandIdentity}>
                <Image source={require('../../assets/images/cd4_logo.png')} style={styles.brandLogo} resizeMode="contain" />
                <View style={styles.brandCopy}><Text style={[styles.brandName, { color: theme.text }]} numberOfLines={1}>CD4</Text><Text style={[styles.brandLocation, { color: theme.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">● {locationCityLabel.toUpperCase()}, INDIA</Text></View>
            </View>
            <View style={styles.headerActions}>
                <TouchableOpacity style={[styles.headerIcon, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]} onPress={onNotificationPress} activeOpacity={0.82}><Bell size={17} color={theme.text} />{unreadCount > 0 ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}</TouchableOpacity>
                <TouchableOpacity style={[styles.headerIcon, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]} onPress={onProfilePress} activeOpacity={0.82}><UserRound size={17} color={theme.text} /></TouchableOpacity>
            </View>
        </View>
    );
}

export function PatientHomeShowcase({
    theme, locationCityLabel, showHeader = true, selectedCityLabel, doctors, departments, concerns, promos, isProUser, aiTitle, aiSubtitle,
    symptomPlaceholder, symptomInput, isListening, shouldEmphasizeVoiceCta, shouldPulseMicButton,
    voicePulse, onSymptomChange, onSymptomSubmit, onVoicePress, onUpgrade, onViewAllDoctors,
    onDoctorProfile, onConsultDoctor, onNotificationPress, onProfilePress, onQuickAction, onConcernPress, onViewAllConcerns, onPromoPress, onEmergencyPress, onDepartmentPress, onViewAllDepartments,
}: Props) {
    const isDarkTheme = theme.background.toLowerCase() === '#121212' || theme.cardBackground.toLowerCase() === '#1e1e1e';
    const { width: screenWidth } = useWindowDimensions();
    const promoCardWidth = Math.max(240, Math.min(320, screenWidth - 32));
    const promoScrollStep = promoCardWidth + 14;
    const departmentSurface = (index: number) => isDarkTheme
        ? (index % 2 ? '#2B2028' : '#1B3029')
        : (index % 2 ? '#FFF1F4' : '#EEF8F6');
    const promoSurface = (index: number) => isDarkTheme
        ? (index % 2 ? '#223044' : '#193328')
        : (index % 2 ? '#EAF4FF' : '#E7F8F0');
    const promoCarouselRef = React.useRef<ScrollView>(null);
    const promoIndexRef = React.useRef(0);
    const concernCarouselRef = React.useRef<ScrollView>(null);
    const concernIndexRef = React.useRef(0);
    const doctorCarouselRef = React.useRef<ScrollView>(null);
    const doctorIndexRef = React.useRef(0);
    const promoItems: HomePromo[] = promos.length > 0 ? promos : [
        { id: 'best-doctors-fallback', tag: 'Best Doctors', title: 'Find the right specialist', description: 'Browse verified doctors and book a consultation.' },
        { id: 'ai-chat-fallback', tag: 'AI Assistant', title: 'Get guided health support', description: 'Share your concern and get the next best step.' },
        { id: 'records-fallback', tag: 'Health Records', title: 'Keep your care organized', description: 'Access your reports and consultation history.' },
    ];

    React.useEffect(() => {
        if (promoItems.length < 2) return;
        const timer = setInterval(() => {
            promoIndexRef.current = (promoIndexRef.current + 1) % promoItems.length;
            promoCarouselRef.current?.scrollTo({
                x: promoIndexRef.current * promoScrollStep,
                animated: true,
            });
        }, 3600);
        return () => clearInterval(timer);
    }, [promoItems.length, promoScrollStep]);

    React.useEffect(() => {
        if (concerns.length < 2) return;
        const timer = setInterval(() => {
            concernIndexRef.current = (concernIndexRef.current + 1) % concerns.length;
            concernCarouselRef.current?.scrollTo({ x: concernIndexRef.current * 152, animated: true });
        }, 4200);
        return () => clearInterval(timer);
    }, [concerns.length]);

    React.useEffect(() => {
        if (doctors.length < 2) return;
        const timer = setInterval(() => {
            doctorIndexRef.current = (doctorIndexRef.current + 1) % Math.min(doctors.length, 6);
            doctorCarouselRef.current?.scrollTo({ x: doctorIndexRef.current * 294, animated: true });
        }, 4600);
        return () => clearInterval(timer);
    }, [doctors.length]);

    return (
        <>
            {showHeader ? <PatientHomeHeader theme={theme} locationCityLabel={locationCityLabel} onNotificationPress={onNotificationPress} onProfilePress={onProfilePress} /> : null}

            <View style={styles.heroCard}>
                <View style={styles.heroOrb} />
                <View style={styles.heroTopRow}>
                    <Text style={styles.onlinePill}>AI Assistant Online</Text>
                    {isProUser ? <Text style={styles.proPill}>PRO</Text> : <TouchableOpacity style={styles.proPill} onPress={onUpgrade}><Text style={styles.proPillText}>Go Pro</Text></TouchableOpacity>}
                </View>
                <Text style={styles.heroTitle}>{aiTitle || 'How can I help you today?'}</Text>
                <Text style={styles.heroSubtitle}>{aiSubtitle || 'Talk to me about your symptoms or medical concerns.'}</Text>
                <View style={[styles.heroInputWrap, isListening && styles.heroInputListening]}>
                    <TextInput style={styles.heroInput} placeholder={symptomPlaceholder} placeholderTextColor="rgba(255,255,255,.72)" value={symptomInput} onChangeText={onSymptomChange} onSubmitEditing={onSymptomSubmit} returnKeyType="send" />
                    <TouchableOpacity style={[styles.heroMic, shouldPulseMicButton && { transform: [{ scale: voicePulse }] }]} onPress={onVoicePress}>
                        {shouldEmphasizeVoiceCta ? <Mic size={27} color="#002110" strokeWidth={2.8} /> : <Text style={styles.heroMicGlyph}>➤</Text>}
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.quickActionsRow}>
                {[
                    { label: 'Reports', Icon: FileText }, { label: 'AI Insights', Icon: Sparkles },
                    { label: 'Community', Icon: Users }, { label: 'Video Call', Icon: Video },
                ].map(({ label, Icon }) => (
                    <TouchableOpacity key={label} style={styles.quickAction} onPress={() => onQuickAction(label)} activeOpacity={0.82}>
                        <View style={[styles.quickIcon, { backgroundColor: theme.cardBackground }]}><Icon size={21} color={theme.tint} /></View>
                        <Text style={[styles.quickLabel, { color: theme.text }]}>{label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <View><Text style={[styles.sectionTitle, { color: theme.text }]}>Choose your concern</Text><Text style={[styles.sectionCaption, { color: theme.textSecondary }]}>Personalized AI triage</Text></View>
                    <TouchableOpacity onPress={onViewAllConcerns} activeOpacity={0.8} accessibilityLabel="View all concerns" style={styles.viewAllIconButton}><ChevronRight size={20} color={theme.tint} strokeWidth={2.5} /></TouchableOpacity>
                </View>
                <ScrollView ref={concernCarouselRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.concernsContent} snapToInterval={152} snapToAlignment="start" decelerationRate="fast">
                    {concerns.slice(0, 8).map((concern, index) => (
                        <TouchableOpacity key={concern.id} style={[styles.concernCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]} onPress={() => onConcernPress(concern.label)} activeOpacity={0.84}>
                            <View style={[styles.concernIcon, { backgroundColor: isDarkTheme ? (index % 2 ? '#27394D' : '#352C47') : (index % 2 ? '#EAF2FB' : '#F1EEF9') }]}>{concern.imageSource ? <Image source={concern.imageSource} style={styles.concernImage} resizeMode="cover" /> : <Activity size={24} color={index % 2 ? (isDarkTheme ? '#8EB4D8' : '#5A718B') : '#E04455'} />}</View>
                            <Text numberOfLines={1} style={[styles.concernLabel, { color: theme.text }]}>{concern.label}</Text>
                            <Text style={[styles.concernHint, { color: theme.textSecondary }]}>Tap to start AI triage</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Promo carousel is rendered after departments to match the Home flow. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promosContent} style={[styles.promosScroll, { display: 'none' }]}>
                {promoItems.slice(0, 4).map((promo, index) => (
                    <TouchableOpacity key={promo.id} style={[styles.promoCard, { backgroundColor: promoSurface(index), borderColor: theme.borderColor }]} onPress={() => onPromoPress(promo.id)} activeOpacity={0.86}>
                        <Text style={[styles.promoTag, { color: theme.tint }]}>{promo.tag}</Text>
                        <Text numberOfLines={2} style={[styles.promoTitle, { color: theme.text }]}>{promo.title}</Text>
                        <Text numberOfLines={2} style={[styles.promoDescription, { color: theme.textSecondary }]}>{promo.description}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            <View style={styles.secondOpinionSection}>
                <View style={styles.sectionHeader}>
                    <View><Text style={[styles.sectionTitle, { color: theme.text }]}>Second Opinion</Text><Text style={[styles.sectionCaption, { color: theme.textSecondary }]}>A trusted expert review on CD4</Text></View>
                </View>
                <TouchableOpacity style={[styles.secondOpinionImageOnlyCard, { borderColor: isDarkTheme ? '#355E8C' : '#C9DBFD' }]} onPress={() => onPromoPress('second-opinion')} activeOpacity={0.88} accessibilityLabel="Open Second Opinion appointments">
                    <Image source={require('../../assets/second_opinion.jpeg')} style={styles.secondOpinionImageOnly} resizeMode="contain" />
                </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.emergencyCard} onPress={onEmergencyPress} activeOpacity={0.88}>
                <View style={styles.emergencyIcon}><Text style={styles.emergencyIconText}>*</Text></View>
                <View style={styles.emergencyCopy}><Text style={styles.emergencyTitle}>Medical Emergency?</Text><Text style={styles.emergencySubtitle}>Call a doctor in under 60 seconds</Text></View>
                <View style={styles.emergencyButton}><Text style={styles.emergencyButtonText}>Call{`\n`}Now</Text></View>
            </TouchableOpacity>

            <View style={styles.section}><View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.text }]}>Explore Departments</Text><Text style={[styles.sectionCaption, { color: theme.textSecondary }]}>Choose the right care for you</Text></View><TouchableOpacity onPress={onViewAllDepartments} activeOpacity={0.8} accessibilityLabel="View all departments" style={styles.viewAllIconButton}><ChevronRight size={20} color={theme.tint} strokeWidth={2.5} /></TouchableOpacity></View><View style={styles.departmentGrid}>{departments.slice(0, 4).map((department, index) => { const DepartmentIcon = department.Icon || Activity; return <TouchableOpacity key={`early-${department.id}`} style={[styles.departmentCard, { backgroundColor: departmentSurface(index), borderColor: theme.borderColor }]} onPress={() => onDepartmentPress(department.label)} activeOpacity={0.86}>{department.imageSource ? <Image source={department.imageSource} style={styles.departmentImageFull} resizeMode="cover" /> : <View style={[styles.departmentFallbackIcon, { backgroundColor: theme.cardBackground }]}><DepartmentIcon size={28} color={index % 2 ? '#E04455' : theme.tint} /></View>}<View style={styles.departmentImageShade} />{/* Image already contains the department label; no overlay label here. */}</TouchableOpacity>; })}</View></View>

            <ScrollView ref={promoCarouselRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promosContent} style={styles.promosScroll} decelerationRate="fast" snapToInterval={promoScrollStep} snapToAlignment="start">
                {promoItems.slice(0, 4).map((promo, index) => (
                    <TouchableOpacity key={`after-department-${promo.id}`} style={[styles.promoCard, { width: promoCardWidth, backgroundColor: promoSurface(index), borderColor: theme.borderColor }]} onPress={() => onPromoPress(promo.id)} activeOpacity={0.86}>
                        <Text style={[styles.promoTag, { color: theme.tint }]}>{promo.tag}</Text>
                        <Text numberOfLines={2} style={[styles.promoTitle, { color: theme.text }]}>{promo.title}</Text>
                        <Text numberOfLines={2} style={[styles.promoDescription, { color: theme.textSecondary }]}>{promo.description}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {doctors.length > 0 ? <View style={styles.section}>
                <View style={styles.sectionHeader}><View><Text style={[styles.sectionTitle, { color: theme.text }]}>Top Specialists</Text><Text style={[styles.sectionCaption, { color: theme.textSecondary }]}>Available near {selectedCityLabel}</Text></View><TouchableOpacity onPress={onViewAllDoctors} activeOpacity={0.8} accessibilityLabel="View all specialists" style={styles.viewAllIconButton}><ChevronRight size={20} color={theme.tint} strokeWidth={2.5} /></TouchableOpacity></View>
                <ScrollView ref={doctorCarouselRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.doctorsContent} snapToInterval={294} snapToAlignment="start" decelerationRate="fast">
                    {doctors.slice(0, 6).map((doctor) => <View key={doctor.id} style={[styles.doctorCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <TouchableOpacity onPress={() => onDoctorProfile(doctor.id)} activeOpacity={0.82}>
                            <View style={styles.doctorTop}><Image source={{ uri: doctor.image || 'https://i.pravatar.cc/100?img=11' }} style={styles.doctorAvatar} /><View style={[styles.verified, { backgroundColor: theme.successLight }]}><CheckCircle size={10} color={theme.tint} /><Text style={[styles.verifiedText, { color: theme.tint }]}>VERIFIED</Text></View></View>
                            <Text numberOfLines={1} style={[styles.doctorName, { color: theme.text }]}>{doctor.name}</Text><Text numberOfLines={1} style={[styles.doctorMeta, { color: theme.textSecondary }]}>{doctor.specialization || 'Specialist'} • {doctor.experience || '—'} yrs</Text>
                            <View style={styles.doctorBottom}><View><Text style={[styles.feeCaption, { color: theme.textSecondary }]}>FEE</Text><Text style={[styles.fee, { color: theme.tint }]}>{doctor.feeLabel || 'On request'}</Text></View><View style={[styles.rating, { backgroundColor: theme.successLight }]}><Star size={10} color={theme.success} fill={theme.success} /><Text style={[styles.ratingText, { color: theme.success }]}>{doctor.ratingLabel}</Text></View></View>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.consult, { backgroundColor: theme.text }]} onPress={() => onConsultDoctor(doctor.id)}><Text style={styles.consultText}>Consult</Text></TouchableOpacity>
                    </View>)}
                </ScrollView>
            </View> : null}

            <View style={[styles.section, { display: 'none' }]}><View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Explore Departments</Text><TouchableOpacity onPress={onViewAllDepartments}><Text style={[styles.viewAllText, { color: theme.tint }]}>View all</Text></TouchableOpacity></View><View style={styles.departmentGrid}>{departments.slice(0, 4).map((department, index) => { const DepartmentIcon = department.Icon || Activity; return <TouchableOpacity key={department.id} style={[styles.departmentCard, { backgroundColor: index % 2 ? '#FFF1F4' : '#EEF8F6', borderColor: theme.borderColor }]} onPress={() => onDepartmentPress(department.label)}><View style={[styles.departmentIcon, { backgroundColor: theme.cardBackground }]}>{department.imageSource ? <Image source={department.imageSource} style={styles.departmentImage} resizeMode="contain" /> : <DepartmentIcon size={23} color={index % 2 ? '#E04455' : theme.tint} />}</View><Text style={[styles.departmentLabel, { color: theme.text }]}>{department.label}</Text></TouchableOpacity>; })}</View></View>
        </>
    );
}

const styles = StyleSheet.create({
    viewAllIconButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    brandHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 16, paddingTop: 3, paddingBottom: 3 }, brandIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }, brandLogo: { width: 36, height: 36, borderRadius: 10, marginRight: 10, alignSelf: 'center' }, brandCopy: { flex: 1, minWidth: 0, justifyContent: 'center' }, brandName: { flexShrink: 1, fontSize: 17, lineHeight: 19, fontWeight: '800' }, brandLocation: { maxWidth: '100%', fontSize: 8, lineHeight: 10, fontWeight: '700', letterSpacing: 0.7, marginTop: 1 }, headerActions: { flexShrink: 0, flexDirection: 'row', gap: 8, marginLeft: 8 }, headerIcon: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, notificationBadge: { position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#E5424C', borderWidth: 1.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, notificationBadgeText: { color: '#FFFFFF', fontSize: 9, lineHeight: 11, fontWeight: '900' },
    heroCard: { overflow: 'hidden', backgroundColor: '#006D41', borderRadius: 26, padding: 20, minHeight: 282, marginBottom: 20, shadowColor: '#006D41', shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 7 }, heroOrb: { position: 'absolute', right: -55, bottom: -45, width: 170, height: 170, borderRadius: 85, backgroundColor: '#2CC17B', opacity: 0.8 }, heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, onlinePill: { color: '#fff', fontSize: 10, fontWeight: '700', borderWidth: 1, borderColor: 'rgba(255,255,255,.25)', backgroundColor: 'rgba(255,255,255,.08)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }, proPill: { color: '#002110', backgroundColor: '#72FCB0', borderRadius: 20, paddingHorizontal: 17, paddingVertical: 8, fontSize: 12, fontWeight: '800' }, proPillText: { color: '#002110', fontSize: 12, fontWeight: '800' }, heroTitle: { color: '#fff', fontSize: 28, lineHeight: 31, fontWeight: '800', maxWidth: 260, marginTop: 22 }, heroSubtitle: { color: 'rgba(255,255,255,.78)', fontSize: 14, lineHeight: 20, maxWidth: 280, marginTop: 10 }, heroInputWrap: { height: 52, flexDirection: 'row', alignItems: 'center', borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,.32)', backgroundColor: 'rgba(255,255,255,.10)', marginTop: 16, paddingLeft: 13, paddingRight: 5 }, heroInputListening: { borderColor: '#72FCB0', backgroundColor: 'rgba(0,33,16,.28)' }, heroInput: { flex: 1, color: '#fff', fontSize: 14 }, heroMic: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#72FCB0', alignItems: 'center', justifyContent: 'center' }, heroMicGlyph: { color: '#002110', fontSize: 22, fontWeight: '900' }, heroInputTouchTarget: { ...StyleSheet.absoluteFillObject, top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'transparent' },
    quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 27, paddingHorizontal: 5 }, quickAction: { alignItems: 'center', width: '23%' }, quickIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#0B1C30', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, quickLabel: { fontSize: 11, fontWeight: '700', marginTop: 8, textAlign: 'center' }, section: { marginBottom: 26 }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }, sectionTitle: { fontSize: 18, fontWeight: '600' }, sectionCaption: { fontSize: 11, marginTop: 3 }, viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 }, viewAllText: { fontSize: 13, fontWeight: '800' }, doctorsContent: { gap: 14, paddingRight: 20 }, doctorCard: { width: 280, height: 220, borderRadius: 24, borderWidth: 1, padding: 18, overflow: 'hidden' }, doctorTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, doctorAvatar: { width: 64, height: 64, borderRadius: 18 }, verified: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4 }, verifiedText: { fontSize: 8, fontWeight: '800' }, doctorName: { fontSize: 16, fontWeight: '600', marginTop: 12 }, doctorMeta: { fontSize: 12, marginTop: 3 }, doctorBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 25 }, feeCaption: { fontSize: 9, fontWeight: '700' }, fee: { fontSize: 15, fontWeight: '800', marginTop: 2 }, rating: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 3 }, ratingText: { fontSize: 9, fontWeight: '800' }, consult: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11, position: 'absolute', right: 18, bottom: 18 }, consultText: { color: '#fff', fontSize: 13, fontWeight: '800' }, departmentGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 2, columnGap: 10, rowGap: 10 }, departmentCard: { width: '48%', height: 156, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden', shadowColor: '#0B1C30', shadowOpacity: 0.09, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 }, departmentIcon: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 10, overflow: 'hidden' }, departmentImage: { width: '100%', height: '100%', borderRadius: 15 }, departmentImageFull: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' }, departmentImageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.08)' }, departmentLabelPill: { minHeight: 38, width: '92%', marginBottom: 8, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 7, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.9)' }, departmentFallbackIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 28 }, departmentLabel: { fontSize: 12, fontWeight: '800', textAlign: 'center' }, 
    concernsContent: { gap: 14, paddingRight: 20 }, concernCard: { width: 138, height: 138, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, overflow: 'hidden' }, concernIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 8, overflow: 'hidden' }, concernImage: { width: '100%', height: '100%', borderRadius: 34 }, concernLabel: { fontSize: 13, fontWeight: '800', textAlign: 'center' }, concernHint: { fontSize: 9, marginTop: 4, textAlign: 'center' },
    promosScroll: { marginBottom: 20 }, promosContent: { gap: 14, paddingRight: 20 }, promoCard: { width: 295, height: 142, borderRadius: 22, borderWidth: 1, padding: 18, shadowColor: '#0B1C30', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, promoTag: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: .6 }, promoTitle: { fontSize: 17, fontWeight: '800', marginTop: 10 }, promoDescription: { fontSize: 11, lineHeight: 16, marginTop: 7 }, emergencyCard: { height: 92, borderRadius: 22, backgroundColor: '#202D42', flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 20 }, emergencyIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#D51E27', alignItems: 'center', justifyContent: 'center', marginRight: 10 }, emergencyIconText: { color: '#fff', fontSize: 23, fontWeight: '900' }, emergencyCopy: { flex: 1 }, emergencyTitle: { color: '#fff', fontSize: 15, fontWeight: '800' }, emergencySubtitle: { color: 'rgba(255,255,255,.7)', fontSize: 10, marginTop: 3 }, emergencyButton: { backgroundColor: '#D51E27', borderRadius: 10, minWidth: 60, paddingVertical: 8, alignItems: 'center' }, emergencyButtonText: { color: '#fff', fontSize: 11, lineHeight: 14, fontWeight: '800', textAlign: 'center' },
    secondOpinionArtworkImage: { width: '100%', height: '100%', borderRadius: 47 },
    secondOpinionImageOnlyCard: { width: '100%', height: 238, borderRadius: 24, borderWidth: 1, overflow: 'hidden', backgroundColor: '#FFFFFF' }, secondOpinionImageOnly: { width: '100%', height: '100%' },
    secondOpinionCardGradientVertical: { minHeight: 320, padding: 14, flexDirection: 'column' }, secondOpinionHeroImageWrap: { width: '100%', height: 158, borderRadius: 18, overflow: 'hidden', position: 'relative', backgroundColor: '#FFFFFF' }, secondOpinionHeroImage: { width: '100%', height: '100%' }, secondOpinionImageBadge: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.92)' },
    secondOpinionSection: { marginBottom: 26 }, secondOpinionCard: { minHeight: 194, borderRadius: 24, borderWidth: 1, overflow: 'hidden' }, secondOpinionCardGradient: { minHeight: 194, padding: 16, flexDirection: 'row', alignItems: 'center' }, secondOpinionArtwork: { width: 104, height: 150, alignItems: 'center', justifyContent: 'center', marginRight: 14 }, secondOpinionArtworkCircle: { width: 94, height: 94, borderRadius: 47, alignItems: 'center', justifyContent: 'center' }, secondOpinionDocument: { position: 'absolute', right: -2, bottom: 7, width: 68, height: 78, borderRadius: 12, padding: 8, shadowColor: '#0B1C30', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }, secondOpinionReportHeader: { flexDirection: 'row', alignItems: 'center', gap: 3 }, secondOpinionReportLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 0.3 }, secondOpinionReportLine: { width: 42, height: 3, borderRadius: 2, marginTop: 7 }, secondOpinionReportVerified: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 10 }, secondOpinionReportVerifiedText: { fontSize: 6, fontWeight: '900' }, secondOpinionCardCopy: { flex: 1 }, secondOpinionBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }, secondOpinionBadgeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.4 }, secondOpinionCardTitle: { fontSize: 17, lineHeight: 21, fontWeight: '800' }, secondOpinionCardText: { fontSize: 11, lineHeight: 16, marginTop: 7 }, secondOpinionCta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 9, marginTop: 12 }, secondOpinionCtaText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
