import React from 'react';
import { View, Text, StyleSheet, ScrollView, useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { HomeTabSkeleton } from './TabLoadingSkeletons';

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message = 'Loading...' }) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.skeletonWrap,
          {
            paddingTop: 8,
            paddingBottom: Math.max(12, insets.bottom),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <HomeTabSkeleton theme={theme} />
      </ScrollView>
      <Text
        style={[
          styles.message,
          {
            color: theme.textSecondary,
            marginBottom: Math.max(6, insets.bottom * 0.35),
          },
        ]}
      >
        {message}
      </Text>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
  },
  skeletonWrap: {
    flexGrow: 1,
  },
  message: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default LoadingScreen;
