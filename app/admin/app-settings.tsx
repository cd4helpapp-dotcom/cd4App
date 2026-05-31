import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RefreshCw, Save } from 'lucide-react-native';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import Colors from '../../constants/Colors';
import { supabase } from '../../src/lib/supabase';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';

type ContentKey = 'support' | 'terms' | 'privacy_policy';
type PricingCycle = 'monthly' | 'yearly';

type ContentItem = {
  key: ContentKey;
  label: string;
  title: string;
  body: string;
};

const DEFAULT_ITEMS: ContentItem[] = [
  {
    key: 'support',
    label: 'Contact & Support',
    title: 'Contact & Support',
    body:
      'For support, contact the CD4 team at support@cd4.app.\n\n' +
      'Please include your registered email and issue details.',
  },
  {
    key: 'terms',
    label: 'Terms & Service',
    title: 'Terms & Service',
    body:
      'By using CD4, you agree to these terms. CD4 guidance does not replace emergency medical care.',
  },
  {
    key: 'privacy_policy',
    label: 'Privacy Policy',
    title: 'Privacy Policy',
    body:
      'CD4 stores only necessary user and health settings for personalized experience. We do not sell user data.',
  },
];

const keyToLabel = (key: ContentKey): string => {
  if (key === 'support') return 'Contact & Support';
  if (key === 'terms') return 'Terms & Service';
  return 'Privacy Policy';
};

type PricingCycleConfig = {
  title: string;
  price: string;
  period: string;
  subtitle: string;
  originalPrice: string;
  savings: string;
  billingMeta: string;
};

type PricingConfig = Record<PricingCycle, PricingCycleConfig>;

const DEFAULT_PRICING_CONFIG: PricingConfig = {
  monthly: {
    title: 'Pro Monthly',
    price: '₹99',
    period: '/month',
    subtitle: 'Low-commitment plan for users who want monthly flexibility.',
    originalPrice: '₹129',
    savings: 'Launch offer: save ₹30 every month',
    billingMeta: 'Billed monthly • Cancel anytime',
  },
  yearly: {
    title: 'Pro Yearly',
    price: '₹999',
    period: '/year',
    subtitle: 'Best value plan for regular AI and voice consultation users.',
    originalPrice: '₹1,200',
    savings: 'Save ₹201/year • Effective ₹83/month',
    billingMeta: 'Billed yearly • Best for long-term savings',
  },
};

const toSafeString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim().length > 0 ? value : fallback;

const normalizePricingConfig = (value: unknown): PricingConfig => {
  if (!value || typeof value !== 'object') return DEFAULT_PRICING_CONFIG;
  const monthlyRaw = (value as any).monthly || {};
  const yearlyRaw = (value as any).yearly || {};
  return {
    monthly: {
      title: toSafeString(monthlyRaw.title, DEFAULT_PRICING_CONFIG.monthly.title),
      price: toSafeString(monthlyRaw.price, DEFAULT_PRICING_CONFIG.monthly.price),
      period: toSafeString(monthlyRaw.period, DEFAULT_PRICING_CONFIG.monthly.period),
      subtitle: toSafeString(monthlyRaw.subtitle, DEFAULT_PRICING_CONFIG.monthly.subtitle),
      originalPrice: toSafeString(monthlyRaw.originalPrice, DEFAULT_PRICING_CONFIG.monthly.originalPrice),
      savings: toSafeString(monthlyRaw.savings, DEFAULT_PRICING_CONFIG.monthly.savings),
      billingMeta: toSafeString(monthlyRaw.billingMeta, DEFAULT_PRICING_CONFIG.monthly.billingMeta),
    },
    yearly: {
      title: toSafeString(yearlyRaw.title, DEFAULT_PRICING_CONFIG.yearly.title),
      price: toSafeString(yearlyRaw.price, DEFAULT_PRICING_CONFIG.yearly.price),
      period: toSafeString(yearlyRaw.period, DEFAULT_PRICING_CONFIG.yearly.period),
      subtitle: toSafeString(yearlyRaw.subtitle, DEFAULT_PRICING_CONFIG.yearly.subtitle),
      originalPrice: toSafeString(yearlyRaw.originalPrice, DEFAULT_PRICING_CONFIG.yearly.originalPrice),
      savings: toSafeString(yearlyRaw.savings, DEFAULT_PRICING_CONFIG.yearly.savings),
      billingMeta: toSafeString(yearlyRaw.billingMeta, DEFAULT_PRICING_CONFIG.yearly.billingMeta),
    },
  };
};

export default function AdminAppSettingsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const tabSwipeHandlers = useTabSwipeNavigation('admin-settings');

  const [items, setItems] = React.useState<ContentItem[]>(DEFAULT_ITEMS);
  const [supportTicketAlertsEnabled, setSupportTicketAlertsEnabled] = React.useState(true);
  const [isSavingSupportSetting, setIsSavingSupportSetting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState<ContentKey | null>(null);
  const [pricingConfig, setPricingConfig] = React.useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const [isSavingPricing, setIsSavingPricing] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const loadContent = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('app_content_pages')
        .select('key, title, body')
        .in('key', ['support', 'terms', 'privacy_policy', 'support_ticket_alerts', 'subscription_pricing']);

      if (error || !Array.isArray(data)) {
        setItems(DEFAULT_ITEMS);
        setSupportTicketAlertsEnabled(true);
        return;
      }

      const map = new Map<string, any>();
      data.forEach((row: any) => {
        if (typeof row?.key === 'string') map.set(row.key, row);
      });

      const merged = DEFAULT_ITEMS.map((base) => {
        const row = map.get(base.key);
        return {
          ...base,
          title: typeof row?.title === 'string' && row.title.trim() ? row.title : base.title,
          body: typeof row?.body === 'string' && row.body.trim() ? row.body : base.body,
        };
      });
      setItems(merged);

      const supportAlertsRow = map.get('support_ticket_alerts');
      if (typeof supportAlertsRow?.body === 'string') {
        setSupportTicketAlertsEnabled(supportAlertsRow.body.trim().toLowerCase() !== 'false');
      } else {
        setSupportTicketAlertsEnabled(true);
      }

      const pricingRow = map.get('subscription_pricing');
      if (typeof pricingRow?.body === 'string' && pricingRow.body.trim()) {
        try {
          setPricingConfig(normalizePricingConfig(JSON.parse(pricingRow.body)));
        } catch {
          setPricingConfig(DEFAULT_PRICING_CONFIG);
        }
      } else {
        setPricingConfig(DEFAULT_PRICING_CONFIG);
      }
    } catch {
      setItems(DEFAULT_ITEMS);
      setSupportTicketAlertsEnabled(true);
      setPricingConfig(DEFAULT_PRICING_CONFIG);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadContent();
  }, [loadContent]);

  const updateItem = (key: ContentKey, field: 'title' | 'body', value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  };

  const saveItem = async (key: ContentKey) => {
    const item = items.find((row) => row.key === key);
    if (!item) return;

    const title = item.title.trim();
    const body = item.body.trim();
    if (!title || !body) {
      Alert.alert('Missing content', 'Title and body both are required.');
      return;
    }

    setIsSaving(key);
    try {
      const payload = {
        key,
        title,
        body,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('app_content_pages')
        .upsert(payload, { onConflict: 'key' });

      if (error) {
        Toast.show({
          type: 'error',
          text1: 'Save failed',
          text2: error.message || 'Could not save app content.',
        });
        return;
      }

      Toast.show({
        type: 'success',
        text1: 'Saved',
        text2: `${keyToLabel(key)} updated successfully.`,
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Save failed',
        text2: 'Could not save app content.',
      });
    } finally {
      setIsSaving(null);
    }
  };

  const saveSupportAlertsSetting = async (nextValue: boolean) => {
    setSupportTicketAlertsEnabled(nextValue);
    setIsSavingSupportSetting(true);
    try {
      const { error } = await supabase
        .from('app_content_pages')
        .upsert(
          {
            key: 'support_ticket_alerts',
            title: 'Support Ticket Alerts',
            body: nextValue ? 'true' : 'false',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
      if (error) throw error;
    } catch {
      setSupportTicketAlertsEnabled(!nextValue);
      Toast.show({
        type: 'error',
        text1: 'Update failed',
        text2: 'Could not update support alerts setting.',
      });
    } finally {
      setIsSavingSupportSetting(false);
    }
  };

  const refreshContent = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await loadContent();
    setIsRefreshing(false);
  };

  const updatePricingField = (cycle: PricingCycle, field: keyof PricingCycleConfig, value: string) => {
    setPricingConfig((prev) => ({
      ...prev,
      [cycle]: {
        ...prev[cycle],
        [field]: value,
      },
    }));
  };

  const savePricingConfig = async () => {
    setIsSavingPricing(true);
    try {
      const payload = {
        key: 'subscription_pricing',
        title: 'Subscription Pricing',
        body: JSON.stringify(pricingConfig),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('app_content_pages').upsert(payload, { onConflict: 'key' });
      if (error) throw error;
      Toast.show({
        type: 'success',
        text1: 'Saved',
        text2: 'Subscription pricing updated successfully.',
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Save failed',
        text2: error?.message || 'Could not update subscription pricing.',
      });
    } finally {
      setIsSavingPricing(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} {...tabSwipeHandlers}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>App Settings</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Manage in-app support, terms, privacy content and support alerts.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.refreshButton, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
          onPress={refreshContent}
          disabled={isRefreshing || isLoading}
        >
          <RefreshCw size={16} color={theme.textSecondary} />
          <Text style={[styles.refreshText, { color: theme.textSecondary }]}>Refresh Content</Text>
        </TouchableOpacity>

        <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={styles.settingRow}>
            <View style={styles.settingTextWrap}>
              <Text style={[styles.cardTitle, { color: theme.text, marginBottom: 2 }]}>Support Ticket Alerts</Text>
              <Text style={[styles.settingHelper, { color: theme.textSecondary }]}>
                Notify admins in-app when a new support ticket is submitted.
              </Text>
            </View>
            <Switch
              value={supportTicketAlertsEnabled}
              onValueChange={(value) => {
                void saveSupportAlertsSetting(value);
              }}
              disabled={isSavingSupportSetting}
              trackColor={{ false: theme.borderColor, true: theme.success }}
            />
          </View>

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: theme.borderColor }]}
            onPress={() => router.push('/admin/support-tickets')}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.text }]}>View Support Tickets</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={theme.tint} />
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Subscription Pricing</Text>
              <Text style={[styles.settingHelper, { color: theme.textSecondary, marginBottom: 10 }]}>
                Configure patient-side Pro plan pricing for monthly and yearly plans.
              </Text>

              {(['monthly', 'yearly'] as PricingCycle[]).map((cycle) => (
                <View key={cycle} style={[styles.pricingSection, { borderColor: theme.borderColor }]}>
                  <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{cycle === 'monthly' ? 'Monthly Plan' : 'Yearly Plan'}</Text>
                  <TextInput
                    value={pricingConfig[cycle].title}
                    onChangeText={(value) => updatePricingField(cycle, 'title', value)}
                    placeholder="Plan title"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                  />
                  <View style={styles.pricingRow}>
                    <TextInput
                      value={pricingConfig[cycle].price}
                      onChangeText={(value) => updatePricingField(cycle, 'price', value)}
                      placeholder="₹99"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, styles.pricingInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                    />
                    <TextInput
                      value={pricingConfig[cycle].period}
                      onChangeText={(value) => updatePricingField(cycle, 'period', value)}
                      placeholder="/month"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, styles.pricingInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                    />
                  </View>
                  <TextInput
                    value={pricingConfig[cycle].originalPrice}
                    onChangeText={(value) => updatePricingField(cycle, 'originalPrice', value)}
                    placeholder="Original price"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                  />
                  <TextInput
                    value={pricingConfig[cycle].subtitle}
                    onChangeText={(value) => updatePricingField(cycle, 'subtitle', value)}
                    placeholder="Subtitle"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                  />
                  <TextInput
                    value={pricingConfig[cycle].billingMeta}
                    onChangeText={(value) => updatePricingField(cycle, 'billingMeta', value)}
                    placeholder="Billing meta"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                  />
                  <TextInput
                    value={pricingConfig[cycle].savings}
                    onChangeText={(value) => updatePricingField(cycle, 'savings', value)}
                    placeholder="Savings copy"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                  />
                </View>
              ))}

              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: theme.buttonPrimary }, isSavingPricing && { opacity: 0.7 }]}
                onPress={() => {
                  void savePricingConfig();
                }}
                disabled={isSavingPricing}
              >
                {isSavingPricing ? (
                  <ActivityIndicator color={theme.buttonText} />
                ) : (
                  <View style={styles.saveRow}>
                    <Save size={16} color={theme.buttonText} />
                    <Text style={[styles.saveText, { color: theme.buttonText }]}>Save Pricing</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {items.map((item) => (
              <View key={item.key} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{item.label}</Text>

                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Title</Text>
                <TextInput
                  value={item.title}
                  onChangeText={(value) => updateItem(item.key, 'title', value)}
                  placeholder="Enter title"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                />

                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Body</Text>
                <TextInput
                  value={item.body}
                  onChangeText={(value) => updateItem(item.key, 'body', value)}
                  placeholder="Enter content body"
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  textAlignVertical="top"
                  style={[styles.textArea, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                />

                <TouchableOpacity
                  style={[styles.saveButton, { backgroundColor: theme.buttonPrimary }, isSaving === item.key && { opacity: 0.7 }]}
                  onPress={() => {
                    void saveItem(item.key);
                  }}
                  disabled={Boolean(isSaving)}
                >
                  {isSaving === item.key ? (
                    <ActivityIndicator color={theme.buttonText} />
                  ) : (
                    <View style={styles.saveRow}>
                      <Save size={16} color={theme.buttonText} />
                      <Text style={[styles.saveText, { color: theme.buttonText }]}>Save</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 30, gap: 14 },
  header: { gap: 6 },
  title: { fontSize: 26, fontWeight: '800' },
  subtitle: { fontSize: 13, lineHeight: 18 },
  refreshButton: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshText: { fontSize: 12, fontWeight: '600' },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  settingTextWrap: { flex: 1 },
  settingHelper: { fontSize: 12, lineHeight: 17 },
  secondaryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '700' },
  pricingSection: {
    marginTop: 4,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#00000022',
    borderRadius: 10,
    padding: 10,
  },
  pricingRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pricingInput: {
    flex: 1,
  },
  loaderWrap: { paddingVertical: 30, alignItems: 'center', justifyContent: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 130,
  },
  saveButton: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveText: { fontSize: 14, fontWeight: '700' },
});
