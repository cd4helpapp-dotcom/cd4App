import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

const normalizeParams = (params: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );

export default function OAuthRedirectFallback() {
  const router = useRouter();
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;

  useEffect(() => {
    router.replace({
      pathname: '/auth/login',
      params: normalizeParams(params),
    });
  }, [params, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
      <ActivityIndicator size="large" color="#3ECF8E" />
    </View>
  );
}
