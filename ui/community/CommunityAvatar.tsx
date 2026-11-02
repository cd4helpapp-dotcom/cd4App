import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../hooks/useAppTheme';

// A photo, or the person's initial when there is none or it fails to load. Names are never sent to an outside avatar service.
function CommunityAvatar({ name, uri, size = 40 }: { name?: string | null; uri?: string | null; size?: number }) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = React.useState(false);
  const photo = typeof uri === 'string' ? uri.trim() : '';
  React.useEffect(() => setFailed(false), [photo]);

  const box = { width: size, height: size, borderRadius: size / 2 };
  if (photo && !failed) {
    return <Image source={{ uri: photo }} onError={() => setFailed(true)} style={[box, { backgroundColor: theme.surfaceMuted }]} />;
  }
  return (
    <View style={[box, styles.initialWrap, { backgroundColor: theme.primarySoft }]}>
      <Text style={[styles.initial, { color: theme.primary, fontSize: Math.round(size * 0.42) }]}>
        {(name || '').trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

export default React.memo(CommunityAvatar);

const styles = StyleSheet.create({
  initialWrap: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '700' },
});
