import { useQuery } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';

export type ManagedContentKey = 'support' | 'terms' | 'privacy_policy';

export type ManagedContentPayload = {
  title: string;
  body: string;
  updatedAt?: string | null;
};

const FALLBACK_CONTENT: Record<ManagedContentKey, ManagedContentPayload> = {
  support: {
    title: 'Contact & Support',
    body:
      'For support, contact the CD4 team at support@cd4.app.\n\n' +
      'Please include:\n' +
      '- Your registered email/phone\n' +
      '- Issue summary\n' +
      '- Screenshot (if possible)\n\n' +
      'Typical response time: 24-48 hours.',
  },
  terms: {
    title: 'Terms & Service',
    body:
      'By using CD4, you agree to use the app responsibly and provide accurate information. CD4 connects users with healthcare services and provides AI-assisted health information.\n\n' +
      'AI guidance and report explanations are for informational support only. They do not replace a qualified doctor, diagnosis, prescription, or emergency care. Contact local emergency services for urgent symptoms.\n\n' +
      'You are responsible for protecting your account and for confirming medical decisions with a qualified healthcare professional. Misuse, abuse, or unauthorized access attempts may lead to account restriction.',
  },
  privacy_policy: {
    title: 'Privacy Policy',
    body:
      'CD4 collects account details such as name, email, phone number and profile information to create and secure your account. If you use health features, we may process symptoms, appointments, uploaded medical reports, prescriptions, voice input and AI conversation history to provide the requested care-support features.\n\n' +
      'We use this information to provide doctor discovery, appointment booking, report explanation, support, security, notifications and service improvement. We may use service providers such as Supabase, AI providers, payment providers and video/voice providers only as needed to provide these features. We do not sell personal or health data.\n\n' +
      'Data is protected with authenticated access controls and encrypted transport. We retain data only as long as needed for the service, legal obligations and safety. You can request access, correction or deletion by using Settings → Delete account or by contacting support@cd4.app.\n\n' +
      'For account deletion instructions, visit the public Account deletion page. For questions or complaints, contact support@cd4.app.',
  },
};

export const useManagedAppContent = (keyName: ManagedContentKey) =>
  useQuery({
    queryKey: ['managed-app-content', keyName],
    queryFn: async (): Promise<ManagedContentPayload> => {
      // Admin-updatable table expectation:
      // app_content_pages(key text primary key, title text, body text, updated_at timestamptz)
      const { data, error } = await supabase
        .from('app_content_pages')
        .select('title, body, updated_at')
        .eq('key', keyName)
        .single();

      if (error || !data) {
        return FALLBACK_CONTENT[keyName];
      }

      const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : FALLBACK_CONTENT[keyName].title;
      const body = typeof data.body === 'string' && data.body.trim() ? data.body.trim() : FALLBACK_CONTENT[keyName].body;
      const updatedAt = typeof data.updated_at === 'string' ? data.updated_at : null;

      return { title, body, updatedAt };
    },
  });
