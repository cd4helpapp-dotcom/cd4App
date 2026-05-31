import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Flame, Utensils, Footprints, Moon, BrainCircuit, Check, Plus, User } from 'lucide-react-native';
import { Theme } from '../../constants/Colors';

interface DiabetesReversalViewProps {
    theme: Theme;
}

export default function DiabetesReversalView({ theme }: DiabetesReversalViewProps) {
    const [checklist, setChecklist] = useState([
        { id: 1, title: 'High-protein Breakfast', time: '9:00 AM', status: 'completed' },
        { id: 2, title: '15-min Post-meal walk', time: 'After Lunch', status: 'pending' },
        { id: 3, title: 'Take Metformin (500mg)', time: '2:00 PM', status: 'pending' },
        { id: 4, title: '10-min Breathwork', time: 'Evening', status: 'pending' },
    ]);

    const toggleTask = (id: number) => { setChecklist(prev => prev.map(item => item.id === id ? { ...item, status: item.status === 'completed' ? 'pending' : 'completed' } : item)); };
    const getColor = (index: number) => ['#FF9F43', '#2ECC71', '#9B59B6', '#1ABC9C'][index];
    const getValue = (index: number) => ['3/4 Logged', '4,500 Steps', '7h 20m', 'Low Level'][index];
    const getLucideIcon = (index: number) => { if (index === 0) return <Utensils size={18} color="#FF9F43" />; if (index === 1) return <Footprints size={18} color="#2ECC71" />; if (index === 2) return <Moon size={18} color="#9B59B6" />; return <BrainCircuit size={18} color="#1ABC9C" />; };
    const getTaskIcon = (title: string) => { if (title.includes('Breakfast')) return <Utensils size={20} color={theme.text} />; if (title.includes('walk')) return <Footprints size={20} color={theme.text} />; if (title.includes('Metformin')) return <Plus size={20} color={theme.text} />; return <BrainCircuit size={20} color={theme.text} />; };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={[styles.appName, { color: theme.text }]}>Diabetes Reversal OS</Text>
                <View style={[styles.activityBadge, { backgroundColor: theme.success }]}><Flame size={14} color="#fff" /><Text style={styles.activityText}>Streak: 12 Days</Text></View>
            </View>
            <View style={[styles.mainCard, { backgroundColor: theme.cardBackground }]}>
                <View style={styles.mainCardHeader}>
                    <View>
                        <Text style={[styles.cardTitle, { color: theme.text }]}>Today's Reversal Plan</Text>
                        <Text style={[styles.quote, { color: theme.textSecondary }]}>"Aaj ka plan aapke sugar ko stable rakhega"</Text>
                        <View style={[styles.pill, { backgroundColor: theme.successLight }]}><Text style={[styles.pillText, { color: theme.success }]}>● PHASE 1: STABILIZATION</Text></View>
                    </View>
                    <View style={[styles.scoreCircle, { borderColor: theme.success }]}><Text style={[styles.scoreText, { color: theme.text }]}>85</Text><Text style={[styles.scoreLabel, { color: theme.textSecondary }]}>SCORE</Text></View>
                </View>
            </View>
            <View style={[styles.feedbackCard, { backgroundColor: theme.successLight }]}>
                <View style={styles.feedbackHeader}>
                    <View style={[styles.doctorAvatar, { backgroundColor: theme.iconPrimary }]}><User size={16} color="#fff" /></View>
                    <View><Text style={[styles.doctorName, { color: theme.text }]}>Dr. Sharma</Text><Text style={[styles.doctorRole, { color: theme.textSecondary }]}>Diabetologist</Text></View>
                </View>
                <Text style={[styles.feedbackText, { color: theme.text }]}>"Excellent work with your walking routine, Nitesh. Your fasting levels are stabilizing."</Text>
            </View>
            <View style={styles.statsGrid}>
                {['Meals', 'Activity', 'Sleep', 'Stress'].map((item, index) => (
                    <View key={index} style={[styles.statCard, { backgroundColor: theme.cardBackground }]}><View style={[styles.statIcon, { borderColor: getColor(index) }]}>{getLucideIcon(index)}</View><Text style={[styles.statLabel, { color: theme.text }]}>{item}</Text><Text style={[styles.statValue, { color: theme.textSecondary }]}>{getValue(index)}</Text></View>
                ))}
            </View>
            <View style={styles.sectionHeader}><View style={{ flexDirection: 'row', alignItems: 'center' }}><Check size={18} color={theme.success} /><Text style={[styles.sectionTitle, { color: theme.text, marginLeft: 8 }]}>Daily Checklist</Text></View><Text style={[styles.sectionSubtitle, { color: theme.textSecondary, backgroundColor: theme.borderColor }]}>{checklist.filter(i => i.status === 'pending').length} Tasks Left</Text></View>
            {checklist.map((item) => (
                <Pressable key={item.id} onPress={() => toggleTask(item.id)} style={[styles.taskCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, item.status === 'completed' && { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                    <View style={[styles.taskIcon, { backgroundColor: theme.background }]}>{getTaskIcon(item.title)}</View>
                    <View style={styles.taskContent}><Text style={[styles.taskTitle, { color: theme.text }, item.status === 'completed' && styles.taskTitleCompleted]}>{item.title}</Text><Text style={[styles.taskTime, { color: theme.textSecondary }]}>{item.time}</Text></View>
                    <View style={[styles.checkBox, { borderColor: theme.textSecondary }, item.status === 'completed' && { backgroundColor: theme.success, borderColor: theme.success }]}>{item.status === 'completed' && <Check size={14} color="#fff" />}</View>
                </Pressable>
            ))}
            <TouchableOpacity style={[styles.connectButton, { backgroundColor: theme.iconPrimary }]}><Text style={[styles.connectButtonText, { color: theme.background }]}>Connect Glucose Monitor</Text></TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    container: { // Added local padding since global was removed
        paddingHorizontal: 20,
        paddingBottom: 100,
    },
    appName: { fontSize: 18, fontWeight: '700' },
    activityBadge: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center' },
    activityText: { color: '#FFF', fontWeight: 'bold', fontSize: 12, marginLeft: 4 },
    mainCard: { borderRadius: 20, padding: 20, marginBottom: 15, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
    mainCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 5 },
    quote: { fontSize: 13, marginBottom: 15, width: 200 },
    pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start' },
    pillText: { fontWeight: '700', fontSize: 10 },
    scoreCircle: { width: 70, height: 70, borderRadius: 35, borderWidth: 5, justifyContent: 'center', alignItems: 'center' },
    scoreText: { fontSize: 24, fontWeight: 'bold' },
    scoreLabel: { fontSize: 8, fontWeight: 'bold' },
    feedbackCard: { borderRadius: 20, padding: 20, marginBottom: 20 },
    feedbackHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    doctorAvatar: { width: 30, height: 30, borderRadius: 15, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
    doctorName: { fontWeight: 'bold', fontSize: 14 },
    doctorRole: { fontSize: 11 },
    feedbackText: { fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
    statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
    statCard: { width: '23%', padding: 12, borderRadius: 15, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 5, elevation: 2 },
    statIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, marginBottom: 8, alignItems: 'center', justifyContent: 'center' },
    statLabel: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
    statValue: { fontSize: 9, textAlign: 'center' },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold' },
    sectionSubtitle: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    taskCard: { borderRadius: 15, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 10, borderWidth: 1 },
    taskIcon: { width: 40, height: 40, borderRadius: 20, marginRight: 15, alignItems: 'center', justifyContent: 'center' },
    taskContent: { flex: 1 },
    taskTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
    taskTitleCompleted: { textDecorationLine: 'line-through' },
    taskTime: { fontSize: 12 },
    checkBox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    connectButton: { marginTop: 20, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
    connectButtonText: { fontWeight: 'bold' },
});
