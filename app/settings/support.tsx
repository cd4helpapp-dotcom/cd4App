import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import SettingsHeader from '../../ui/common/SettingsHeader';
import { useManagedAppContent } from '../../hooks/useManagedAppContent';
import { useAuthContext } from '../../context/AuthContext';
import { supabase } from '../../src/lib/supabase';

export default function SupportPage() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useManagedAppContent('support');
  const { user } = useAuthContext();
  const scrollRef = React.useRef<ScrollView>(null);

  const [name, setName] = React.useState(`${user?.firstName || ''} ${user?.lastName || ''}`.trim());
  const [email, setEmail] = React.useState(user?.email || '');
  const [phone, setPhone] = React.useState(user?.phoneNumber || '');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    setName(`${user?.firstName || ''} ${user?.lastName || ''}`.trim());
    setEmail(user?.email || '');
    setPhone(user?.phoneNumber || '');
  }, [user?.firstName, user?.lastName, user?.email, user?.phoneNumber]);

  const scrollToFocusedInput = React.useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 220, animated: true });
    }, 120);
  }, []);

  const handleSubmit = async () => {
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanPhone = phone.trim();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();

    if (!cleanName || !cleanEmail || !cleanSubject || !cleanMessage) {
      Toast.show({
        type: 'error',
        text1: 'Missing fields',
        text2: 'Name, email, subject and message are required.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: insertedTicket, error } = await supabase
        .from('support_tickets')
        .insert({
        user_id: user?.id || null,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        subject: cleanSubject,
        message: cleanMessage,
        })
        .select('id')
        .single();

      if (error) {
        Toast.show({
          type: 'error',
          text1: 'Submit failed',
          text2: error.message || 'Could not send your support request.',
        });
        return;
      }

      // Optional admin alerts for newly created support tickets.
      // Failures here should not block the user submit flow.
      try {
        const { data: settingRow } = await supabase
          .from('app_content_pages')
          .select('body')
          .eq('key', 'support_ticket_alerts')
          .maybeSingle();

        const alertsEnabled = typeof settingRow?.body === 'string'
          ? settingRow.body.trim().toLowerCase() !== 'false'
          : true;

        if (alertsEnabled) {
          const { data: admins } = await supabase
            .from('roles')
            .select('id')
            .eq('slug', 'admin');

          const adminIds = Array.isArray(admins)
            ? admins
                .map((row: any) => (typeof row?.id === 'string' ? row.id : ''))
                .filter((id: string) => Boolean(id))
            : [];

          if (adminIds.length > 0) {
            const title = 'New Support Ticket';
            const body = `${cleanName}: ${cleanSubject}`;
            const payload = adminIds.map((adminId: string) => ({
              user_id: adminId,
              type: 'system',
              title,
              body,
              data: {
                ticket_id: insertedTicket?.id || null,
                from_user_id: user?.id || null,
                email: cleanEmail,
                phone: cleanPhone || null,
                subject: cleanSubject,
              },
            }));
            await supabase.from('in_app_notifications').insert(payload);
          }
        }
      } catch {}

      setSubject('');
      setMessage('');
      Toast.show({
        type: 'success',
        text1: 'Request sent',
        text2: 'Our support team will contact you soon.',
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Submit failed',
        text2: 'Could not send your support request.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 4 : 0}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      showsVerticalScrollIndicator={false}
    >
      <SettingsHeader title={data?.title || 'Contact & Support'} onBack={() => router.back()} theme={theme} />

      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        {isLoading ? (
          <ActivityIndicator color={theme.tint} />
        ) : (
          <Text style={[styles.infoText, { color: theme.textSecondary }]}>{data?.body || ''}</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <Text style={[styles.formTitle, { color: theme.text }]}>Submit Complaint / Support Request</Text>

        <Field label="Name" value={name} onChangeText={setName} theme={theme} />
        <Field label="Email" value={email} onChangeText={setEmail} theme={theme} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Phone" value={phone} onChangeText={setPhone} theme={theme} keyboardType="phone-pad" />
        <Field label="Subject" value={subject} onChangeText={setSubject} theme={theme} onFocus={scrollToFocusedInput} />

        <Text style={[styles.label, { color: theme.textSecondary }]}>Message</Text>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Describe your issue in detail..."
          placeholderTextColor={theme.textSecondary}
          multiline
          textAlignVertical="top"
          onFocus={scrollToFocusedInput}
          style={[styles.textArea, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
        />

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: theme.buttonPrimary }, isSubmitting && { opacity: 0.7 }]}
          onPress={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={theme.buttonText} />
          ) : (
            <Text style={[styles.submitText, { color: theme.buttonText }]}>Submit</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  theme: typeof Colors.light;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onFocus?: () => void;
};

function Field({
  label,
  value,
  onChangeText,
  theme,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  onFocus,
}: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        onFocus={onFocus}
        placeholder={`Enter ${label.toLowerCase()}`}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
  },
  infoText: { fontSize: 14, lineHeight: 21 },
  formTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  fieldWrap: { marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 120,
  },
  submitButton: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 14, fontWeight: '700' },
});
