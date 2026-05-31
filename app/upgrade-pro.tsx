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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bot, CheckCircle, Star } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { useAuthContext } from '../context/AuthContext';
import { supabase } from '../src/lib/supabase';
import { openRazorpayCheckout } from '../services/razorpay';

type BillingCycle = 'monthly' | 'yearly';

type SubscriptionSnapshot = {
  id: string;
  planCode: string;
  billingCycle: BillingCycle;
  status: string;
  expiresAt?: string | null;
  nextBillingAt?: string | null;
  paymentId?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
};

type PlanCopy = Record<
  BillingCycle,
  {
    title: string;
    price: string;
    period: string;
    subtitle: string;
    originalPrice?: string;
    savings?: string;
    billingMeta?: string;
  }
>;

const DEFAULT_PLAN_COPY: PlanCopy = {
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

const PRO_FEATURES = [
  'Up to 3x more AI chats for longer symptom follow-ups',
  'Instant priority response lane during busy hours',
  'More natural voice assistant with smoother replies',
  'Doctor-ready summary for faster appointment decisions',
  'Real-world flow coverage: triage, doctor match, booking guidance',
  'Hindi + English support for day-to-day health questions',
];

export default function UpgradeProScreen() {
  const router = useRouter();
  const { user, refetchUser } = useAuthContext();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDarkTheme = (colorScheme ?? 'light') === 'dark';
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>('yearly');
  const [planCopy, setPlanCopy] = React.useState<PlanCopy>(DEFAULT_PLAN_COPY);
  const [isStatusLoading, setIsStatusLoading] = React.useState(true);
  const [isActivating, setIsActivating] = React.useState(false);
  const [currentSubscription, setCurrentSubscription] = React.useState<SubscriptionSnapshot | null>(null);
  const activePlan = planCopy[billingCycle];

  const normalizeSubscriptionSnapshot = React.useCallback((value: any): SubscriptionSnapshot | null => {
    if (!value || typeof value !== 'object') return null;
    return {
      id: String(value.id || ''),
      planCode: String(value.planCode || value.plan_code || 'pro'),
      billingCycle: value.billingCycle === 'monthly' || value.billing_cycle === 'monthly' ? 'monthly' : 'yearly',
      status: String(value.status || 'pending'),
      expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : typeof value.expires_at === 'string' ? value.expires_at : null,
      nextBillingAt: typeof value.nextBillingAt === 'string' ? value.nextBillingAt : typeof value.next_billing_at === 'string' ? value.next_billing_at : null,
      paymentId: typeof value.paymentId === 'string' ? value.paymentId : typeof value.payment_id === 'string' ? value.payment_id : null,
      amountPaid: typeof value.amountPaid === 'number' ? value.amountPaid : typeof value.amount_paid === 'number' ? value.amount_paid : null,
      currency: typeof value.currency === 'string' ? value.currency : 'INR',
    };
  }, []);

  const isSubscriptionActive = React.useCallback((subscription: SubscriptionSnapshot | null): boolean => {
    if (!subscription) return false;
    const status = subscription.status.toLowerCase();
    if (!['active', 'trialing', 'grace'].includes(status)) return false;
    if (!subscription.expiresAt) return true;
    const expiryMs = new Date(subscription.expiresAt).getTime();
    return Number.isFinite(expiryMs) && expiryMs > Date.now();
  }, []);

  const refreshSubscriptionStatus = React.useCallback(async () => {
    if (!user?.id) {
      setCurrentSubscription(null);
      setIsStatusLoading(false);
      return;
    }

    setIsStatusLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-pro-subscription', {
        body: { action: 'status' },
      });
      if (error || data?.success === false) {
        return;
      }
      const snapshot = normalizeSubscriptionSnapshot(data?.subscription);
      setCurrentSubscription(snapshot);
    } catch (statusError) {
      console.warn('Could not load subscription status:', statusError);
    } finally {
      setIsStatusLoading(false);
    }
  }, [normalizeSubscriptionSnapshot, user?.id]);

  React.useEffect(() => {
    void refreshSubscriptionStatus();
  }, [refreshSubscriptionStatus]);

  React.useEffect(() => {
    let isActive = true;
    const loadPricing = async () => {
      try {
        const { data, error } = await supabase
          .from('app_content_pages')
          .select('body')
          .eq('key', 'subscription_pricing')
          .single();

        if (error || !data?.body) return;
        const parsed = JSON.parse(data.body);
        const monthly = parsed?.monthly;
        const yearly = parsed?.yearly;
        if (!monthly || !yearly) return;

        const nextPlanCopy: PlanCopy = {
          monthly: {
            title: typeof monthly.title === 'string' && monthly.title.trim() ? monthly.title : DEFAULT_PLAN_COPY.monthly.title,
            price: typeof monthly.price === 'string' && monthly.price.trim() ? monthly.price : DEFAULT_PLAN_COPY.monthly.price,
            period: typeof monthly.period === 'string' && monthly.period.trim() ? monthly.period : DEFAULT_PLAN_COPY.monthly.period,
            subtitle: typeof monthly.subtitle === 'string' && monthly.subtitle.trim() ? monthly.subtitle : DEFAULT_PLAN_COPY.monthly.subtitle,
            originalPrice:
              typeof monthly.originalPrice === 'string' && monthly.originalPrice.trim()
                ? monthly.originalPrice
                : DEFAULT_PLAN_COPY.monthly.originalPrice,
            savings: typeof monthly.savings === 'string' && monthly.savings.trim() ? monthly.savings : DEFAULT_PLAN_COPY.monthly.savings,
            billingMeta:
              typeof monthly.billingMeta === 'string' && monthly.billingMeta.trim()
                ? monthly.billingMeta
                : DEFAULT_PLAN_COPY.monthly.billingMeta,
          },
          yearly: {
            title: typeof yearly.title === 'string' && yearly.title.trim() ? yearly.title : DEFAULT_PLAN_COPY.yearly.title,
            price: typeof yearly.price === 'string' && yearly.price.trim() ? yearly.price : DEFAULT_PLAN_COPY.yearly.price,
            period: typeof yearly.period === 'string' && yearly.period.trim() ? yearly.period : DEFAULT_PLAN_COPY.yearly.period,
            subtitle: typeof yearly.subtitle === 'string' && yearly.subtitle.trim() ? yearly.subtitle : DEFAULT_PLAN_COPY.yearly.subtitle,
            originalPrice:
              typeof yearly.originalPrice === 'string' && yearly.originalPrice.trim()
                ? yearly.originalPrice
                : DEFAULT_PLAN_COPY.yearly.originalPrice,
            savings: typeof yearly.savings === 'string' && yearly.savings.trim() ? yearly.savings : DEFAULT_PLAN_COPY.yearly.savings,
            billingMeta:
              typeof yearly.billingMeta === 'string' && yearly.billingMeta.trim()
                ? yearly.billingMeta
                : DEFAULT_PLAN_COPY.yearly.billingMeta,
          },
        };

        if (isActive) {
          setPlanCopy(nextPlanCopy);
        }
      } catch {
        // Keep defaults when pricing payload is unavailable.
      }
    };

    void loadPricing();
    return () => {
      isActive = false;
    };
  }, []);

  const isAlreadyPro = isSubscriptionActive(currentSubscription);

  const handlePayPress = async () => {
    if (!user?.id) {
      Alert.alert('Login required', 'Please login first to continue with Pro upgrade.');
      return;
    }

    if (isAlreadyPro) {
      Alert.alert('Already Pro', 'Your Pro subscription is already active on this account.');
      return;
    }

    setIsActivating(true);
    try {
      const { data: orderData, error: orderError } = await supabase.functions.invoke('manage-pro-subscription', {
        body: {
          action: 'create_order',
          plan: 'pro',
          billingCycle,
        },
      });

      if (orderError || orderData?.success === false) {
        const reason = orderData?.message || orderError?.message || 'Could not start payment right now.';
        Alert.alert('Upgrade failed', reason);
        return;
      }

      const checkout = await openRazorpayCheckout({
        description: billingCycle === 'yearly' ? 'Pro Yearly Subscription' : 'Pro Monthly Subscription',
        amountPaise: Number(orderData?.order?.amount || 0) * 100,
        orderId: String(orderData?.order?.order_id || ''),
        prefill: {
          name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
          email: user?.email || '',
          contact: user?.phoneNumber || '',
        },
      });

      const { data, error } = await supabase.functions.invoke('manage-pro-subscription', {
        body: {
          action: 'verify_payment',
          plan: 'pro',
          billingCycle,
          orderId: orderData?.order?.order_id,
          paymentId: checkout?.razorpay_payment_id,
          signature: checkout?.razorpay_signature,
        },
      });

      if (error || data?.success === false) {
        const reason = data?.message || error?.message || 'Could not activate Pro right now.';
        Alert.alert('Upgrade failed', reason);
        return;
      }

      const snapshot = normalizeSubscriptionSnapshot(data?.subscription);
      setCurrentSubscription(snapshot);
      await refetchUser();

      Alert.alert(
        'Pro Activated',
        `Plan: ${snapshot?.billingCycle || billingCycle}\nPayment ID: ${snapshot?.paymentId || data?.payment?.payment_id || 'N/A'}`
      );
    } catch (activateError: any) {
      Alert.alert('Upgrade failed', activateError?.message || 'Could not activate Pro right now.');
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={[styles.backButton, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
            activeOpacity={0.85}
            onPress={() => router.back()}
          >
            <ArrowLeft size={18} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Upgrade to Pro</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.heroCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
          <View style={[styles.heroChip, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
            <Bot size={15} color={theme.textSecondary} />
            <Text style={[styles.heroChipText, { color: theme.textSecondary }]}>AI Pro Access</Text>
          </View>
          <Text style={[styles.heroTitle, { color: theme.text }]}>Smarter, faster and more natural AI care support</Text>
          <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
            Get more chats, faster responses, and a smoother doctor-booking workflow with Pro.
          </Text>
        </View>

        <View style={[styles.billingToggle, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
          {(['monthly', 'yearly'] as BillingCycle[]).map((cycle) => {
            const isActive = billingCycle === cycle;
            return (
              <TouchableOpacity
                key={cycle}
                activeOpacity={0.9}
                onPress={() => setBillingCycle(cycle)}
                style={[
                  styles.billingOption,
                  {
                    backgroundColor: isActive ? theme.tint : 'transparent',
                    borderColor: isActive ? theme.tint : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.billingOptionText, { color: isActive ? '#fff' : theme.text }]}>
                  {cycle === 'monthly' ? 'Monthly' : 'Yearly'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.planCard, { borderColor: theme.successBorder, backgroundColor: theme.cardBackground }]}>
          <View style={styles.planTopRow}>
            <Text style={[styles.planName, { color: theme.text }]}>{activePlan.title}</Text>
            {isAlreadyPro ? (
              <View style={[styles.bestBadge, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                <Star size={12} color={theme.tint} />
                <Text style={[styles.bestBadgeText, { color: theme.tint }]}>Active Plan</Text>
              </View>
            ) : billingCycle === 'yearly' ? (
              <View style={[styles.bestBadge, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                <Star size={12} color={theme.tint} />
                <Text style={[styles.bestBadgeText, { color: theme.tint }]}>Best Value</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.priceRow}>
            <Text style={[styles.priceText, { color: theme.text }]}>{activePlan.price}</Text>
            <Text style={[styles.periodText, { color: theme.textSecondary }]}>{activePlan.period}</Text>
          </View>
          {activePlan.originalPrice ? (
            <View style={styles.priceCompareRow}>
              <Text style={[styles.originalPriceText, { color: theme.textSecondary }]}>{activePlan.originalPrice}</Text>
              <Text style={[styles.discountTagText, { color: theme.success }]}>Discount Active</Text>
            </View>
          ) : null}
          <Text style={[styles.planSubtitle, { color: theme.textSecondary }]}>{activePlan.subtitle}</Text>
          {activePlan.billingMeta ? (
            <Text style={[styles.billingMetaText, { color: theme.textSecondary }]}>{activePlan.billingMeta}</Text>
          ) : null}
          {activePlan.savings ? (
            <Text style={[styles.savingsText, { color: theme.success }]}>{activePlan.savings}</Text>
          ) : null}
        </View>

        {isStatusLoading ? (
          <View style={[styles.subscriptionStatusCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
            <ActivityIndicator size="small" color={theme.tint} />
            <Text style={[styles.subscriptionStatusText, { color: theme.textSecondary }]}>Checking Pro status...</Text>
          </View>
        ) : isAlreadyPro ? (
          <View style={[styles.subscriptionStatusCard, { borderColor: theme.successBorder, backgroundColor: theme.successLight }]}>
            <Text style={[styles.subscriptionStatusTitle, { color: theme.tint }]}>You are a Pro member</Text>
            <Text style={[styles.subscriptionStatusText, { color: theme.textSecondary }]}>
              {`Plan: ${currentSubscription?.billingCycle || 'yearly'} • Expires: ${
                currentSubscription?.expiresAt ? new Date(currentSubscription.expiresAt).toLocaleDateString() : 'N/A'
              }`}
            </Text>
            <Text style={[styles.subscriptionStatusText, { color: theme.textSecondary }]}>
              {`Payment ID: ${currentSubscription?.paymentId || 'N/A'}`}
            </Text>
          </View>
        ) : null}

        <View style={[styles.featureCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
          <Text style={[styles.featureHeading, { color: theme.text }]}>What you get in Pro</Text>
          {PRO_FEATURES.map((feature) => (
            <View key={feature} style={styles.featureRow}>
              <CheckCircle size={16} color={theme.tint} />
              <Text style={[styles.featureText, { color: theme.textSecondary }]}>{feature}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.payButton, { backgroundColor: isAlreadyPro ? '#6AA989' : theme.tint, opacity: isActivating ? 0.8 : 1 }]}
          activeOpacity={0.88}
          onPress={() => {
            void handlePayPress();
          }}
          disabled={isActivating}
        >
          <Text style={styles.payButtonText}>
            {isActivating
              ? 'Activating...'
              : isAlreadyPro
                ? 'Pro Already Active'
                : billingCycle === 'yearly'
          ? 'Upgrade Yearly Pro'
                  : 'Upgrade Monthly Pro'}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.footerNote, { color: theme.textSecondary }]}>
          Pro activates only after successful payment confirmation.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  headerSpacer: {
    width: 36,
  },
  heroCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
  },
  heroChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    marginBottom: 10,
  },
  heroChipText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  heroTitle: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: 0.15,
  },
  heroSubtitle: {
    marginTop: 8,
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '500',
  },
  billingToggle: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  billingOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billingOptionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  planCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  planTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planName: {
    fontSize: 16,
    fontWeight: '800',
  },
  bestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  bestBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  priceRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  priceText: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
  },
  periodText: {
    fontSize: 14,
    marginBottom: 4,
    fontWeight: '600',
  },
  priceCompareRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  originalPriceText: {
    fontSize: 13,
    textDecorationLine: 'line-through',
    fontWeight: '700',
  },
  discountTagText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.25,
    textTransform: 'uppercase',
  },
  planSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
  },
  billingMetaText: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
  },
  savingsText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '800',
  },
  featureCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  featureHeading: {
    fontSize: 15,
    fontWeight: '800',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  subscriptionStatusCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  subscriptionStatusTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  subscriptionStatusText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  payButton: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14532D',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 6,
  },
  payButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  footerNote: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
});
