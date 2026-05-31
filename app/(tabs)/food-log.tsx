import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';

export default function FoodLogScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const tabSwipeHandlers = useTabSwipeNavigation('food-log');

  return (
    <SafeAreaView {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>Food Log</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Track your meals and macros here.</Text>
        <View style={[styles.placeholderBox, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={{ color: theme.textSecondary }}>Full Food Logger Coming Soon</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, alignItems: 'center', justifyContent: 'center', flex: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { fontSize: 16, marginBottom: 30 },
  placeholderBox: { width: '100%', height: 200, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});
