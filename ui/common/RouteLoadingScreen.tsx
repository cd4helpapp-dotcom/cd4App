import React from 'react';
import { ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { HomeTabSkeleton } from './TabLoadingSkeletons';

type RouteLoadingScreenProps = {
  message?: string;
};

export default function RouteLoadingScreen({ message = 'Preparing your workspace...' }: RouteLoadingScreenProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      accessibilityLabel={message}
      style={[styles.container, { backgroundColor: theme.background }]}
    >
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skeletonWrap: {
    flexGrow: 1,
  },
});
