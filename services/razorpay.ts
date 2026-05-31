import { Platform } from 'react-native';
import { supabase } from '../src/lib/supabase';

type RazorpayOpenOptions = {
  description: string;
  amountPaise: number;
  orderId: string;
  prefill?: { name?: string; email?: string; contact?: string };
};

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayPrefill = {
  name: string;
  email: string;
  contact: string;
};

type RazorpayCheckoutPayload = {
  key: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  order_id: string;
  prefill: RazorpayPrefill;
  theme: { color: string };
};

type RazorpayCheckoutModule = {
  open?: (payload: RazorpayCheckoutPayload) => Promise<RazorpaySuccess>;
  default?: {
    open?: (payload: RazorpayCheckoutPayload) => Promise<RazorpaySuccess>;
  };
};

type RazorpayWebSuccessResponse = Partial<RazorpaySuccess>;

type RazorpayWebFailureResponse = {
  error?: {
    description?: string;
    reason?: string;
  };
};

type RazorpayWebInstance = {
  open: () => void;
  on?: (eventName: 'payment.failed', callback: (event: RazorpayWebFailureResponse) => void) => void;
};

type RazorpayWebOptions = RazorpayCheckoutPayload & {
  readonly?: {
    contact?: boolean;
    email?: boolean;
    name?: boolean;
  };
  hidden?: {
    contact?: boolean;
    email?: boolean;
  };
  handler: (response: RazorpayWebSuccessResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
};

type RazorpayWebConstructor = new (options: RazorpayWebOptions) => RazorpayWebInstance;

type RazorpayWindow = Window & {
  Razorpay?: RazorpayWebConstructor;
};

const RAZORPAY_WEB_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

let RazorpayCheckout: RazorpayCheckoutModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  RazorpayCheckout = require('react-native-razorpay') as RazorpayCheckoutModule;
} catch {
  RazorpayCheckout = null;
}

const resolveCheckoutOpen = (() => {
  let cachedOpen:
    | ((payload: RazorpayCheckoutPayload) => Promise<RazorpaySuccess>)
    | null
    | undefined;
  return () => {
    if (cachedOpen !== undefined) {
      return cachedOpen;
    }
    if (!RazorpayCheckout) {
      cachedOpen = null;
      return cachedOpen;
    }
    if (typeof RazorpayCheckout.open === 'function') {
      cachedOpen = RazorpayCheckout.open.bind(RazorpayCheckout);
      return cachedOpen;
    }
    if (typeof RazorpayCheckout.default?.open === 'function') {
      cachedOpen = RazorpayCheckout.default.open.bind(RazorpayCheckout.default);
      return cachedOpen;
    }
    cachedOpen = null;
    return cachedOpen;
  };
})();

let webSdkLoadPromise: Promise<void> | null = null;

const sanitizeName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 80);
};

const sanitizeEmail = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

const sanitizeContact = (value: unknown): string => {
  const raw =
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length > 10) {
    digits = digits.slice(-10);
  }
  return digits.length === 10 ? digits : '';
};

const resolveFallbackPrefill = async (): Promise<Partial<RazorpayPrefill>> => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) return {};

    const metadata = (authUser.user_metadata || {}) as Record<string, unknown>;
    const authName = sanitizeName(
      `${typeof metadata.first_name === 'string' ? metadata.first_name : ''} ${typeof metadata.last_name === 'string' ? metadata.last_name : ''}`.trim()
    ) || sanitizeName(
      typeof metadata.name === 'string' ? metadata.name : typeof metadata.full_name === 'string' ? metadata.full_name : ''
    );
    const authEmail = sanitizeEmail(authUser.email);
    const authContact = sanitizeContact(
      typeof metadata.phone_number === 'string'
        ? metadata.phone_number
        : typeof metadata.phoneNumber === 'string'
          ? metadata.phoneNumber
          : typeof metadata.mobile === 'string'
            ? metadata.mobile
            : typeof metadata.phone === 'string'
              ? metadata.phone
              : typeof metadata.contact === 'string'
                ? metadata.contact
                : ''
    );

    let profileName = '';
    let profileEmail = '';
    let profileContact = '';

    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('first_name,last_name,email,phone_number')
        .eq('id', authUser.id)
        .single();

      if (profileRow) {
        profileName = sanitizeName(`${profileRow.first_name || ''} ${profileRow.last_name || ''}`.trim());
        profileEmail = sanitizeEmail(profileRow.email);
        profileContact = sanitizeContact(profileRow.phone_number);
      }
    } catch {
      // Optional fallback only; ignore if profile lookup fails.
    }

    return {
      name: authName || profileName,
      email: authEmail || profileEmail,
      contact: authContact || profileContact,
    };
  } catch {
    return {};
  }
};

const resolveCheckoutPrefill = async (prefill?: RazorpayOpenOptions['prefill']): Promise<RazorpayPrefill> => {
  const directName = sanitizeName(prefill?.name || '');
  const directEmail = sanitizeEmail(prefill?.email || '');
  const directContact = sanitizeContact(prefill?.contact || '');

  if (directName && directEmail && directContact) {
    return {
      name: directName,
      email: directEmail,
      contact: directContact,
    };
  }

  const fallback = await resolveFallbackPrefill();
  return {
    name: directName || sanitizeName(fallback.name || ''),
    email: directEmail || sanitizeEmail(fallback.email || ''),
    contact: directContact || sanitizeContact(fallback.contact || ''),
  };
};

const getCheckoutPayload = async (options: RazorpayOpenOptions): Promise<RazorpayCheckoutPayload> => {
  const key = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || '';
  if (!key.trim()) {
    throw new Error('EXPO_PUBLIC_RAZORPAY_KEY_ID is missing.');
  }

  const amountPaise = Number(options.amountPaise);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new Error('Invalid Razorpay amount. Please retry.');
  }

  const orderId = String(options.orderId || '').trim();
  if (!orderId) {
    throw new Error('Razorpay order id missing. Please retry.');
  }
  const resolvedPrefill = await resolveCheckoutPrefill(options.prefill);

  return {
    key,
    amount: Math.round(amountPaise),
    currency: 'INR',
    name: 'CD4',
    description: options.description,
    order_id: orderId,
    prefill: resolvedPrefill,
    theme: { color: '#22C55E' },
  };
};

const loadRazorpayWebSdk = async (): Promise<void> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Razorpay checkout is unavailable in this environment.');
  }

  const win = window as RazorpayWindow;
  if (typeof win.Razorpay === 'function') {
    return;
  }

  if (!webSdkLoadPromise) {
    webSdkLoadPromise = new Promise<void>((resolve, reject) => {
      const complete = () => {
        if (typeof (window as RazorpayWindow).Razorpay === 'function') {
          resolve();
          return;
        }
        reject(new Error('Razorpay SDK loaded but constructor was not found.'));
      };

      const existingScript = document.querySelector('script[data-razorpay-web-sdk="true"]') as HTMLScriptElement | null;
      if (existingScript) {
        const alreadyLoaded =
          existingScript.getAttribute('data-loaded') === 'true' ||
          (existingScript as HTMLScriptElement & { readyState?: string }).readyState === 'complete';
        if (alreadyLoaded) {
          complete();
          return;
        }
        existingScript.addEventListener('load', complete, { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Failed to load Razorpay web SDK.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = RAZORPAY_WEB_SDK_URL;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-razorpay-web-sdk', 'true');
      script.addEventListener(
        'load',
        () => {
          script.setAttribute('data-loaded', 'true');
          complete();
        },
        { once: true }
      );
      script.addEventListener('error', () => reject(new Error('Failed to load Razorpay web SDK.')), { once: true });
      (document.body || document.head).appendChild(script);
    });
  }

  try {
    await webSdkLoadPromise;
  } catch (error) {
    webSdkLoadPromise = null;
    throw error;
  }
};

const openWebCheckout = async (payload: RazorpayCheckoutPayload): Promise<RazorpaySuccess> => {
  await loadRazorpayWebSdk();
  const win = window as RazorpayWindow;
  const RazorpayConstructor = win.Razorpay;
  if (typeof RazorpayConstructor !== 'function') {
    throw new Error('Razorpay web checkout is unavailable right now. Please retry.');
  }

  return new Promise<RazorpaySuccess>((resolve, reject) => {
    let settled = false;

    const rejectOnce = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };

    const resolveOnce = (response: RazorpayWebSuccessResponse) => {
      if (settled) return;

      const paymentId = String(response?.razorpay_payment_id || '').trim();
      const orderId = String(response?.razorpay_order_id || payload.order_id || '').trim();
      const signature = String(response?.razorpay_signature || '').trim();

      if (!paymentId) {
        rejectOnce('Payment failed: missing payment id from gateway.');
        return;
      }
      if (!signature) {
        rejectOnce('Payment failed: missing signature from gateway.');
        return;
      }

      settled = true;
      resolve({
        razorpay_payment_id: paymentId,
        razorpay_order_id: orderId,
        razorpay_signature: signature,
      });
    };

    const checkout = new RazorpayConstructor({
      ...payload,
      readonly: {
        contact: Boolean(payload.prefill.contact),
        email: Boolean(payload.prefill.email),
        name: Boolean(payload.prefill.name),
      },
      hidden: {
        contact: Boolean(payload.prefill.contact),
        email: Boolean(payload.prefill.email),
      },
      handler: resolveOnce,
      modal: {
        ondismiss: () => rejectOnce('Payment was cancelled.'),
      },
    });

    checkout.on?.('payment.failed', (event) => {
      const reason = event?.error?.description || event?.error?.reason || 'Payment failed at Razorpay gateway.';
      rejectOnce(reason);
    });

    checkout.open();
  });
};

export const openRazorpayCheckout = async (options: RazorpayOpenOptions): Promise<RazorpaySuccess> => {
  const payload = await getCheckoutPayload(options);

  if (Platform.OS === 'web') {
    return openWebCheckout(payload);
  }
  if (!RazorpayCheckout) {
    throw new Error('react-native-razorpay is not installed. Please install and rebuild app.');
  }
  const checkoutOpen = resolveCheckoutOpen();
  if (!checkoutOpen) {
    throw new Error('Razorpay SDK loaded but open() is unavailable. Rebuild Android/iOS app.');
  }

  return checkoutOpen(payload);
};
