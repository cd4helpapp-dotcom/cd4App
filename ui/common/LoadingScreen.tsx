import React from 'react';
import { ActivityIndicator, View, Text, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message = 'Loading...' }) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.centerWrap}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text
          style={[
            styles.message,
            {
              color: theme.textSecondary,
              marginTop: 14,
              marginBottom: Math.max(6, insets.bottom * 0.35),
            },
          ]}
        >
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default LoadingScreen;
