import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Typography } from '../../constants/Design';
import { getNameInitials } from '../../src/utils/doctors';

// The photo when it loads, otherwise initials. A broken or expired photo URL no longer leaves an empty box.
export default function DoctorAvatar({ uri, name, size = 60, radius = 16 }: { uri?: string | null; name: string; size?: number; radius?: number }) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [uri]);
  const box = { width: size, height: size, borderRadius: radius };
  return (
    <View style={[styles.fallback, box, { backgroundColor: theme.primarySoft }]}>
      <Text style={[Typography.subheading, { color: theme.primary }]}>{getNameInitials(name)}</Text>
      {uri && !failed ? <Image source={{ uri }} style={[StyleSheet.absoluteFill, box]} onError={() => setFailed(true)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
