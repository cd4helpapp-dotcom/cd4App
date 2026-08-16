import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function PublicDeleteAccountPage() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.brand}>CD4</Text>
      <Text style={styles.title}>Account deletion</Text>
      <Text style={styles.body}>To delete your CD4 account and associated personal and health data:</Text>
      <Text style={styles.step}>1. Sign in to the CD4 app.</Text>
      <Text style={styles.step}>2. Open Settings → Delete account.</Text>
      <Text style={styles.step}>3. Confirm deletion twice.</Text>
      <Text style={styles.body}>Your profile, uploaded reports, report conversations and account records will be deleted. Some legally required transaction or audit records may be retained where required by law.</Text>
      <Text style={styles.body}>If you cannot sign in, email support@cd4.app from your registered email address with the subject “Account deletion request”.</Text>
      <TouchableOpacity style={styles.button} onPress={() => Linking.openURL('mailto:support@cd4.app?subject=Account%20deletion%20request')}>
        <Text style={styles.buttonText}>Email support</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 28, justifyContent: 'center', backgroundColor: '#F8FBFF' },
  brand: { color: '#157A9E', fontSize: 16, fontWeight: '800', marginBottom: 10 },
  title: { color: '#12212B', fontSize: 28, fontWeight: '800', marginBottom: 18 },
  body: { color: '#44545E', fontSize: 16, lineHeight: 24, marginBottom: 16 },
  step: { color: '#12212B', fontSize: 16, lineHeight: 25, marginBottom: 5 },
  button: { backgroundColor: '#157A9E', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
