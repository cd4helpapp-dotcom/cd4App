import React from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import Colors from '../../constants/Colors';
import SettingsHeader from '../../ui/common/SettingsHeader';
import { useAuthContext } from '../../context/AuthContext';
import { supabase } from '../../src/lib/supabase';

export default function DeleteAccountPage() {
  const theme = Colors[useColorScheme() ?? 'light'];
  const { session, refreshAuth } = useAuthContext();
  const [isDeleting, setIsDeleting] = React.useState(false);

  const deleteAccount = () => {
    if (isDeleting) return;
    Alert.alert(
      'Delete account permanently?',
      'Your profile, reports, chats and account data will be deleted. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Final confirmation', 'Are you sure you want to permanently delete your CD4 account?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Yes, delete account',
                style: 'destructive',
                onPress: async () => {
                  setIsDeleting(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
                    if (error || !data?.success) throw new Error('Account deletion failed');
                    await supabase.auth.signOut();
                    await refreshAuth();
                    router.replace('/auth/login');
                  } catch (error) {
                    console.warn('[DeleteAccount] request failed:', error);
                    Toast.show({ type: 'error', text1: 'Could not delete account', text2: 'Please try again or contact support.' });
                  } finally {
                    setIsDeleting(false);
                  }
                },
              },
            ]);
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <SettingsHeader title="Delete account" onBack={() => router.back()} theme={theme} />
      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.title, { color: theme.text }]}>Request account deletion</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>You can permanently delete your CD4 account and associated personal and health data.</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>This includes your profile, uploaded medical reports, report conversations and account-related records. Some legally required transaction or audit records may be retained where required by law.</Text>
        <TouchableOpacity style={styles.deleteButton} onPress={deleteAccount} disabled={isDeleting}>
          {isDeleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteText}>Delete my account permanently</Text>}
        </TouchableOpacity>
        {!!session?.user?.email && <Text style={[styles.email, { color: theme.textSecondary }]}>Signed in as {session.user.email}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 32 },
  card: { margin: 20, padding: 20, borderRadius: 16, borderWidth: 1 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 12 },
  deleteButton: { marginTop: 14, backgroundColor: '#C62828', borderRadius: 10, padding: 15, alignItems: 'center' },
  deleteText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  email: { marginTop: 14, fontSize: 12 },
});
