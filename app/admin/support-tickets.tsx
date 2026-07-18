import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Colors from '../../constants/Colors';
import SettingsHeader from '../../ui/common/SettingsHeader';
import { supabase } from '../../src/lib/supabase';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type SupportTicket = {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  status: TicketStatus;
  created_at: string;
};

const STATUS_FLOW: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

const nextStatus = (status: TicketStatus): TicketStatus => {
  const index = STATUS_FLOW.indexOf(status);
  if (index < 0 || index === STATUS_FLOW.length - 1) return 'closed';
  return STATUS_FLOW[index + 1];
};

export default function AdminSupportTicketsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const [tickets, setTickets] = React.useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);

  const loadTickets = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id, name, email, phone, subject, message, status, created_at')
        .order('created_at', { ascending: false })
        .limit(150);
      if (error) throw error;
      setTickets(Array.isArray(data) ? (data as SupportTicket[]) : []);
    } catch (error: any) {
      setTickets([]);
      setLoadError(error?.message || 'Could not load support tickets.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const advanceStatus = async (ticket: SupportTicket) => {
    const target = nextStatus(ticket.status);
    setUpdatingId(ticket.id);
    try {
      const payload: any = {
        status: target,
        updated_at: new Date().toISOString(),
      };
      if (target === 'resolved' || target === 'closed') {
        payload.resolved_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from('support_tickets')
        .update(payload)
        .eq('id', ticket.id);
      if (error) throw error;

      setTickets((prev) =>
        prev.map((row) => (row.id === ticket.id ? { ...row, status: target } : row))
      );
      Toast.show({ type: 'success', text1: 'Ticket updated', text2: `Status: ${target}` });
    } catch {
      Toast.show({ type: 'error', text1: 'Update failed', text2: 'Could not update ticket status.' });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SettingsHeader title="Support Tickets" onBack={() => router.back()} theme={theme} />

        {isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={theme.tint} />
          </View>
        ) : loadError ? (
          <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.emptyText, { color: theme.error }]}>{loadError}</Text>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.buttonPrimary }]} onPress={() => void loadTickets()}>
              <Text style={[styles.actionButtonText, { color: theme.buttonText }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : tickets.length === 0 ? (
          <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No support tickets yet.</Text>
          </View>
        ) : (
          tickets.map((ticket) => (
            <View key={ticket.id} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              <View style={styles.rowBetween}>
                <Text style={[styles.subject, { color: theme.text }]} numberOfLines={2}>
                  {ticket.subject}
                </Text>
                <View style={[styles.badge, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                  <Text style={[styles.badgeText, { color: theme.success }]}>{ticket.status}</Text>
                </View>
              </View>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>{ticket.name} • {ticket.email}</Text>
              {!!ticket.phone && <Text style={[styles.meta, { color: theme.textSecondary }]}>{ticket.phone}</Text>}
              <Text style={[styles.message, { color: theme.text }]}>{ticket.message}</Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {new Date(ticket.created_at).toLocaleString()}
              </Text>

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: theme.buttonPrimary }, updatingId === ticket.id && { opacity: 0.7 }]}
                onPress={() => {
                  void advanceStatus(ticket);
                }}
                disabled={updatingId === ticket.id || ticket.status === 'closed'}
              >
                {updatingId === ticket.id ? (
                  <ActivityIndicator color={theme.buttonText} />
                ) : (
                  <Text style={[styles.actionButtonText, { color: theme.buttonText }]}>
                    {ticket.status === 'closed' ? 'Closed' : `Mark ${nextStatus(ticket.status)}`}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  loader: { paddingVertical: 40, alignItems: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  subject: { fontSize: 15, fontWeight: '700', flex: 1 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 4 },
  message: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  actionButton: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: { fontSize: 13, fontWeight: '700' },
  emptyText: { fontSize: 14 },
});
