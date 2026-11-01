import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Trash2, Mail, ShieldAlert } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { useColorScheme } from 'react-native';

export default function PublicAccountDeletionPage() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  const handleEmailSupport = () => {
    Linking.openURL('mailto:support@cd4.app?subject=Account%20and%20Data%20Deletion%20Request');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderColor }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Account & Data Deletion</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.banner, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <ShieldAlert size={32} color="#D32F2F" />
          <Text style={[styles.bannerTitle, { color: theme.text }]}>Delete Your CD4 Account</Text>
          <Text style={[styles.bannerSubtitle, { color: theme.textSecondary }]}>
            You have the right to request permanent deletion of your account and all associated personal and health data.
          </Text>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>1. How to Delete In-App</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          If you are logged into the CD4 mobile app, you can permanently delete your account directly:
        </Text>
        <View style={[styles.stepBox, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.stepText, { color: theme.text }]}>• Open CD4 App</Text>
          <Text style={[styles.stepText, { color: theme.text }]}>• Go to Profile / Settings tab</Text>
          <Text style={[styles.stepText, { color: theme.text }]}>• Tap on "Help & Support"</Text>
          <Text style={[styles.stepText, { color: theme.text }]}>• Tap "Delete Account" and confirm</Text>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 24 }]}>2. Request Deletion via Web / Email</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          If you have uninstalled the app or cannot log in, send an email from your registered email address to:
        </Text>

        <TouchableOpacity style={styles.emailButton} onPress={handleEmailSupport} activeOpacity={0.85}>
          <Mail size={20} color="#FFFFFF" />
          <Text style={styles.emailButtonText}>Email support@cd4.app</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { color: theme.text, marginTop: 24 }]}>3. What Data is Deleted?</Text>
        <Text style={[styles.paragraph, { color: theme.textSecondary }]}>
          Upon account deletion, the following data is permanently purged within 30 days:
        </Text>
        <Text style={[styles.bullet, { color: theme.textSecondary }]}>• User profile, name, phone number, and email</Text>
        <Text style={[styles.bullet, { color: theme.textSecondary }]}>• Uploaded medical records, lab reports, and prescriptions</Text>
        <Text style={[styles.bullet, { color: theme.textSecondary }]}>• AI consultation conversation history and voice transcripts</Text>
        <Text style={[styles.bullet, { color: theme.textSecondary }]}>• Appointment history and saved doctor records</Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 20,
  },
  banner: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 24,
  },
  bannerTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 10,
  },
  bannerSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  stepBox: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '500',
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#047857',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 6,
    marginBottom: 16,
  },
  emailButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  bullet: {
    fontSize: 14,
    lineHeight: 22,
    marginLeft: 8,
  },
});
