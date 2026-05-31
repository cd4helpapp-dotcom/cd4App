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
      'By using CD4, you agree to use the app responsibly and provide accurate information.\n\n' +
      'CD4 guidance does not replace emergency care. In urgent situations, contact local emergency services immediately.\n\n' +
      'Misuse, abuse, or unauthorized access attempts may lead to account restriction.',
  },
  privacy_policy: {
    title: 'Privacy Policy',
    body:
      'CD4 stores personal and health-related settings to provide personalized care features.\n\n' +
      'We do not sell your personal data. Access is restricted using authenticated roles and security controls.\n\n' +
      'You may contact support to request data review, correction, or deletion where applicable.',
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

