import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { Crown, RefreshCw } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useAuthContext } from '../../context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import SettingsHeader from '../../ui/common/SettingsHeader';

type BillingCycle = 'monthly' | 'yearly';

type SubscriptionSnapshot = {
  id: string;
  planCode: string;
  billingCycle: BillingCycle;
  status: string;
  startedAt?: string | null;
  expiresAt?: string | null;
  nextBillingAt?: string | null;
  cancelledAt?: string | null;
  paymentId?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
};

const normalizeSubscriptionSnapshot = (value: any): SubscriptionSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const billingCycle = value.billingCycle === 'monthly' || value.billing_cycle === 'monthly' ? 'monthly' : 'yearly';
  return {
    id: String(value.id || ''),
    planCode: String(value.planCode || value.plan_code || 'pro'),
    billingCycle,
    status: String(value.status || 'pending'),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : typeof value.started_at === 'string' ? value.started_at : null,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : typeof value.expires_at === 'string' ? value.expires_at : null,
    nextBillingAt:
      typeof value.nextBillingAt === 'string'
        ? value.nextBillingAt
        : typeof value.next_billing_at === 'string'
          ? value.next_billing_at
          : null,
    cancelledAt:
      typeof value.cancelledAt === 'string'
        ? value.cancelledAt
        : typeof value.cancelled_at === 'string'
          ? value.cancelled_at
          : null,
    paymentId: typeof value.paymentId === 'string' ? value.paymentId : typeof value.payment_id === 'string' ? value.payment_id : null,
    amountPaid:
      typeof value.amountPaid === 'number'
        ? value.amountPaid
        : typeof value.amount_paid === 'number'
          ? value.amount_paid
          : null,
    currency: typeof value.currency === 'string' ? value.currency : 'INR',
  };
};

const parseIsoMs = (value?: string | null): number | null => {
  if (!value || typeof value !== 'string') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const formatDateLabel = (value: string | null | undefined, fallback: string): string => {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return date.toLocaleDateString();
};

const formatAmount = (amount: number | null | undefined, currency: string | null | undefined, fallback: string): string => {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return fallback;
  const normalizedCurrency = (currency || 'INR').toUpperCase();
  if (normalizedCurrency === 'INR') return `₹${amount}`;
  return `${normalizedCurrency} ${amount}`;
};

export default function SubscriptionSettingsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { user, refetchUser } = useAuthContext();
  const { t } = useAppLanguage();
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [subscription, setSubscription] = React.useState<SubscriptionSnapshot | null>(null);

  const getStatusLabel = React.useCallback(
    (item: SubscriptionSnapshot | null): string => {
      if (!item) return t('settings.subscriptionFree');
      const status = String(item.status || '').toLowerCase();
      const expiryMs = parseIsoMs(item.expiresAt);
      const hasExpired = expiryMs !== null && expiryMs <= Date.now();

      if (hasExpired && (status === 'active' || status === 'trialing' || status === 'grace')) {
        return t('settings.subscriptionExpired');
      }
      if (status === 'active' || status === 'trialing') return t('settings.subscriptionActive');
      if (status === 'grace') return t('settings.subscriptionGrace');
      if (status === 'cancelled') return t('settings.subscriptionCancelled');
      if (status === 'expired') return t('settings.subscriptionExpired');
      if (status === 'pending') return t('settings.subscriptionPending');
      return t('settings.subscriptionStatusUnknown');
    },
    [t]
  );

  const loadSubscription = React.useCallback(async () => {
    if (!user?.id) {
      setSubscription(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-pro-subscription', {
        body: { action: 'status' },
      });
      if (error || data?.success === false) {
        const fallback = normalizeSubscriptionSnapshot(user.subscription);
        setSubscription(fallback);
        return;
      }
      setSubscription(normalizeSubscriptionSnapshot(data?.subscription));
    } catch (statusError) {
      console.warn('Subscription status fetch failed:', statusError);
      const fallback = normalizeSubscriptionSnapshot(user?.subscription);
      setSubscription(fallback);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, user?.subscription]);

  React.useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  const status = String(subscription?.status || '').toLowerCase();
  const isCancelScheduled = status === 'grace' && Boolean(subscription?.cancelledAt);
  const isTerminal = status === 'cancelled' || status === 'expired';
  const canCancel = Boolean(subscription?.id) && !isCancelScheduled && !isTerminal;
  const statusLabel = getStatusLabel(subscription);
  const planLabel = subscription ? t('settings.subscriptionPlanPro') : t('settings.subscriptionPlanFree');
  const expiresDateLabel = formatDateLabel(subscription?.expiresAt, t('settings.subscriptionNotAvailable'));

  const performCancel = async () => {
    setIsCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-pro-subscription', {
        body: {
          action: 'cancel',
          reason: 'cancelled_from_settings',
        },
      });

      if (error || data?.success === false) {
        Toast.show({
          type: 'error',
          text1: t('settings.subscriptionCancelFailedTitle'),
          text2: t('settings.subscriptionCancelFailedBody'),
        });
        return;
      }

      const updatedSnapshot = normalizeSubscriptionSnapshot(data?.subscription);
      setSubscription(updatedSnapshot);
      await refetchUser();
      const updatedExpiryLabel = formatDateLabel(updatedSnapshot?.expiresAt, t('settings.subscriptionNotAvailable'));

      Toast.show({
        type: 'success',
        text1: t('settings.subscriptionCancelSuccessTitle'),
        text2: data?.alreadyCancelled
          ? t('settings.subscriptionAlreadyCancelled')
          : t('settings.subscriptionCancelSuccessBody', { date: updatedExpiryLabel }),
      });
    } catch (cancelError) {
      console.warn('Subscription cancel failed:', cancelError);
      Toast.show({
        type: 'error',
        text1: t('settings.subscriptionCancelFailedTitle'),
        text2: t('settings.subscriptionCancelFailedBody'),
      });
    } finally {
      setIsCancelling(false);
      void loadSubscription();
    }
  };

  const handleCancelPress = () => {
    if (!canCancel || isCancelling) return;
    const confirmBody = subscription?.expiresAt
      ? t('settings.subscriptionCancelConfirmBody', { date: expiresDateLabel })
      : t('settings.subscriptionCancelNoExpiryBody');

    Alert.alert(t('settings.subscriptionCancelConfirmTitle'), confirmBody, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.subscriptionCancelAction'),
        style: 'destructive',
        onPress: () => {
          void performCancel();
        },
      },
    ]);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.content}>
      <SettingsHeader title={t('settings.subscriptionManageTitle')} onBack={() => router.back()} theme={theme} />

      <View style={[styles.heroCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <View style={[styles.heroIconWrap, { backgroundColor: theme.tint + '15' }]}>
          <Crown size={18} color={theme.tint} />
        </View>
        <View style={styles.heroTextWrap}>
          <Text style={[styles.heroTitle, { color: theme.text }]}>{t('settings.subscriptionManageTitle')}</Text>
          <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>{t('settings.subscriptionManageSubtitle')}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={[styles.loadingCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <ActivityIndicator size="small" color={theme.tint} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>{t('settings.subscriptionLoading')}</Text>
        </View>
      ) : (
        <View style={[styles.section, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionCurrentPlan')}</Text>
            <Text style={[styles.value, { color: theme.text }]}>{planLabel}</Text>
          </View>
          <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />

          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionStatus')}</Text>
            <Text style={[styles.value, { color: theme.tint }]}>{statusLabel}</Text>
          </View>

          {subscription ? (
            <>
              <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionBillingCycle')}</Text>
                <Text style={[styles.value, { color: theme.text }]}>
                  {subscription.billingCycle === 'monthly' ? t('settings.subscriptionMonthly') : t('settings.subscriptionYearly')}
                </Text>
              </View>

              <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionStartedAt')}</Text>
                <Text style={[styles.value, { color: theme.text }]}>
                  {formatDateLabel(subscription.startedAt, t('settings.subscriptionNotAvailable'))}
                </Text>
              </View>

              <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionExpiresAt')}</Text>
                <Text style={[styles.value, { color: theme.text }]}>{expiresDateLabel}</Text>
              </View>

              <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionNextBillingAt')}</Text>
                <Text style={[styles.value, { color: theme.text }]}>
                  {formatDateLabel(subscription.nextBillingAt, t('settings.subscriptionNotAvailable'))}
                </Text>
              </View>

              <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionPaymentId')}</Text>
                <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
                  {subscription.paymentId || t('settings.subscriptionNotAvailable')}
                </Text>
              </View>

              <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />
              <View style={styles.row}>
                <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionAmountPaid')}</Text>
                <Text style={[styles.value, { color: theme.text }]}>
                  {formatAmount(subscription.amountPaid, subscription.currency, t('settings.subscriptionNotAvailable'))}
                </Text>
              </View>

              {subscription.cancelledAt ? (
                <>
                  <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />
                  <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.textSecondary }]}>{t('settings.subscriptionCancelledAt')}</Text>
                    <Text style={[styles.value, { color: theme.text }]}>
                      {formatDateLabel(subscription.cancelledAt, t('settings.subscriptionNotAvailable'))}
                    </Text>
                  </View>
                </>
              ) : null}
            </>
          ) : null}
        </View>
      )}

      <TouchableOpacity
        style={[styles.refreshButton, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
        activeOpacity={0.85}
        onPress={() => {
          void loadSubscription();
        }}
        disabled={isLoading}
      >
        <RefreshCw size={16} color={theme.textSecondary} />
        <Text style={[styles.refreshText, { color: theme.textSecondary }]}>{t('settings.subscriptionRefreshAction')}</Text>
      </TouchableOpacity>

      {subscription ? (
        <>
          <Text style={[styles.cancelHint, { color: theme.textSecondary }]}>{t('settings.subscriptionCancelHint')}</Text>
          <TouchableOpacity
            style={[
              styles.cancelButton,
              {
                borderColor: canCancel ? '#EF4444' : theme.borderColor,
                backgroundColor: canCancel ? '#FEF2F2' : theme.cardBackground,
                opacity: isCancelling ? 0.75 : 1,
              },
            ]}
            activeOpacity={0.88}
            onPress={handleCancelPress}
            disabled={!canCancel || isCancelling}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Text style={[styles.cancelButtonText, { color: canCancel ? '#DC2626' : theme.textSecondary }]}>
                {t('settings.subscriptionCancelAction')}
              </Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={[styles.upgradeButton, { backgroundColor: theme.tint }]}
          activeOpacity={0.88}
          onPress={() => router.push('/upgrade-pro')}
        >
          <Text style={styles.upgradeButtonText}>{t('settings.subscriptionUpgradeAction')}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 15,
    padding: 5,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  heroCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  heroTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  heroSubtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  loadingCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '500',
  },
  section: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  label: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  value: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
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
  refreshText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cancelHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  cancelButton: {
    borderWidth: 1,
    borderRadius: 10,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  upgradeButton: {
    borderRadius: 10,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
});
