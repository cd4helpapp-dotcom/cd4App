import React from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { ArrowLeft, Download, ExternalLink, FileText } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useHospitalVoiceIntake } from '../../hooks/useHospital';
import { downloadAiReport, openAiReport } from '../../src/utils/reportDownload';

const formatDateTime = (value?: string) => {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
};

const formatStatus = (value?: string) =>
    (value || 'draft')
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

const sanitizeFileNamePart = (value: string) =>
    (value || 'hospital-intake')
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'hospital-intake';

export default function HospitalVoiceIntakeReportScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const params = useLocalSearchParams<{ id?: string }>();
    const intakeId = typeof params.id === 'string' ? params.id : undefined;
    const intakeQuery = useHospitalVoiceIntake(intakeId);
    const intake = intakeQuery.data;
    const reportFileName = `cd4-hospital-intake-${sanitizeFileNamePart(intake?.title || '')}.pdf`;

    const handleOpenPdf = async () => {
        if (!intake?.pdfUrl) {
            Toast.show({ type: 'info', text1: 'Report preview available', text2: 'PDF file will be attached for new AI intakes.' });
            return;
        }

        try {
            await openAiReport(intake.pdfUrl);
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'PDF unavailable',
                text2: error?.message || 'Could not open the intake PDF.',
            });
        }
    };

    const handleDownloadPdf = async () => {
        if (!intake?.pdfUrl) {
            Toast.show({ type: 'info', text1: 'PDF not attached', text2: 'Generate a new intake to create a PDF file.' });
            return;
        }

        try {
            await downloadAiReport(intake.pdfUrl, reportFileName);
            Toast.show({ type: 'success', text1: 'Downloading PDF', text2: 'Hospital intake PDF download started.' });
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Download failed',
                text2: error?.message || 'Could not download the intake PDF.',
            });
        }
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 2 }]}
            refreshControl={<RefreshControl refreshing={intakeQuery.isRefetching} onRefresh={intakeQuery.refetch} tintColor={theme.tint} />}
        >
            <View style={styles.header}>
                <TouchableOpacity
                    style={[styles.backButton, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                    onPress={() => router.back()}
                >
                    <ArrowLeft size={18} color={theme.text} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.kicker, { color: theme.tint }]}>AI Intake PDF</Text>
                    <Text style={[styles.title, { color: theme.text }]}>Doctor review report</Text>
                </View>
            </View>

            {intakeQuery.isLoading ? (
                <View style={[styles.loadingCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <ActivityIndicator color={theme.tint} />
                </View>
            ) : !intake ? (
                <View style={[styles.loadingCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>Intake not found</Text>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Refresh the hospital AI voice tab and try again.</Text>
                </View>
            ) : (
                <>
                    <View style={styles.actionRow}>
                        <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.tint }]} onPress={handleOpenPdf}>
                            <ExternalLink size={17} color={theme.buttonText} />
                            <Text style={[styles.actionButtonText, { color: theme.buttonText }]}>Open PDF file</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.secondaryButton, { borderColor: theme.borderColor }]} onPress={handleDownloadPdf}>
                            <Download size={17} color={theme.tint} />
                            <Text style={[styles.secondaryButtonText, { color: theme.tint }]}>Download</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.paper}>
                        <View style={styles.paperHeader}>
                            <View>
                                <Text style={styles.brand}>CD4 AI</Text>
                                <Text style={styles.paperTitle}>Hospital Voice Intake Report</Text>
                            </View>
                            <FileText size={26} color="#008d80" />
                        </View>

                        <View style={styles.metaBox}>
                            <MetaItem label="Intake" value={intake.title} />
                            <MetaItem label="Created" value={formatDateTime(intake.createdAt)} />
                            <MetaItem label="Status" value={formatStatus(intake.status)} />
                            <MetaItem label="Language" value={intake.language || 'Hindi / English'} />
                        </View>

                        <ReportSection title="AI Doctor Summary" value={intake.aiSummary || 'Summary not available.'} />
                        <ReportSection
                            title="Clinical Note"
                            value="This intake is an AI-assisted handoff for doctor review. It is not a diagnosis or prescription. The doctor should verify symptoms, vitals, medicines, allergies, and red flags directly with the patient."
                        />
                    </View>
                </>
            )}
        </ScrollView>
    );
}

function MetaItem({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>{label}</Text>
            <Text style={styles.metaValue}>{value}</Text>
        </View>
    );
}

function ReportSection({ title, value }: { title: string; value: string }) {
    return (
        <View style={styles.reportSection}>
            <Text style={styles.reportSectionTitle}>{title}</Text>
            <Text style={styles.reportText}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: 14, paddingBottom: 24 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    backButton: { width: 42, height: 42, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    kicker: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 },
    title: { fontSize: 25, lineHeight: 31, fontWeight: '900' },
    loadingCard: { borderWidth: 1, borderRadius: 18, padding: 18, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { fontSize: 16, fontWeight: '900' },
    emptyText: { marginTop: 6, fontSize: 13, lineHeight: 19, fontWeight: '600', textAlign: 'center' },
    actionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    actionButton: { flex: 1.2, height: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    actionButtonText: { fontSize: 14, fontWeight: '900' },
    secondaryButton: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    secondaryButtonText: { fontSize: 14, fontWeight: '900' },
    paper: { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12 },
    paperHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: '#DDE7E4', paddingBottom: 10 },
    brand: { color: '#008D80', fontSize: 14, fontWeight: '900', letterSpacing: 1.1 },
    paperTitle: { marginTop: 5, color: '#111827', fontSize: 22, lineHeight: 28, fontWeight: '900' },
    metaBox: { marginTop: 10, borderWidth: 1, borderColor: '#DDE7E4', borderRadius: 8, padding: 10, gap: 6, backgroundColor: '#F7FBFA' },
    metaItem: { gap: 2 },
    metaLabel: { color: '#667085', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
    metaValue: { color: '#111827', fontSize: 13, lineHeight: 18, fontWeight: '800' },
    reportSection: { marginTop: 12 },
    reportSectionTitle: { color: '#008D80', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 7 },
    reportText: { color: '#1F2937', fontSize: 13, lineHeight: 20, fontWeight: '600' },
});
