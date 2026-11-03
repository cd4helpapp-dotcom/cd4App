import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '../../context/AuthContext';
import { useLogout, useProfile } from '../../hooks/useAuth';
import { User, LogOut, Mail, Phone, Calendar, CheckCircle, FileText } from 'lucide-react-native';
import { usePatientHospitalVoiceIntakes } from '../../hooks/useHospital';
import { openAiReport } from '../../src/utils/reportDownload';
import { useAppTheme } from '../../hooks/useAppTheme';
import { getImageUrl } from '../../constants/Config';
import { normalizeIndianMobile } from '../../src/utils/validation';

const ProfileScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshAuth } = useAuthContext();
  const logoutMutation = useLogout();
  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = useProfile();
  const hospitalHistoryQuery = usePatientHospitalVoiceIntakes();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await logoutMutation.mutateAsync();
              router.replace('/auth/login');
            } catch (error) {
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleRefreshProfile = async () => {
    try {
      await refetchProfile();
      await refreshAuth();
    } catch (error) {
      Alert.alert('Error', 'Failed to refresh profile');
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Recently';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorText, { color: theme.danger }]}>No user data available</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}>
      <View style={[styles.header, { backgroundColor: theme.cardBackground, shadowColor: theme.shadow }]}>
        <View style={[styles.avatarContainer, { backgroundColor: theme.primarySoft }]}>
          {user.profilePicture ? <Image source={{ uri: getImageUrl(user.profilePicture) }} style={styles.avatarImage} /> : <User size={60} color={theme.primary} />}
        </View>
        <Text style={[styles.name, { color: theme.text }]}>
          {user.firstName} {user.lastName}
        </Text>
        <View style={[styles.verificationBadge, { backgroundColor: theme.successLight }]}>
          <CheckCircle size={16} color={theme.success} />
          <Text style={[styles.verificationText, { color: theme.success }]}>Verified Account</Text>
        </View>
      </View>

      <View style={[styles.infoSection, { backgroundColor: theme.cardBackground, shadowColor: theme.shadow }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Account Information</Text>

        <View style={styles.infoItem}>
          <Mail size={20} color={theme.textSecondary} />
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Email</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>{user.email}</Text>
          </View>
        </View>

        <View style={styles.infoItem}>
          <Phone size={20} color={theme.textSecondary} />
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Phone Number</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>{normalizeIndianMobile(user.phoneNumber || '') ? `+91 ${normalizeIndianMobile(user.phoneNumber || '')}` : 'Not added'}</Text>
          </View>
        </View>

        <View style={styles.infoItem}>
          <Calendar size={20} color={theme.textSecondary} />
          <View style={styles.infoContent}>
            <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Member Since</Text>
            <Text style={[styles.infoValue, { color: theme.text }]}>{formatDate(user.createdAt)}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.infoSection, { backgroundColor: theme.cardBackground, shadowColor: theme.shadow }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Hospital clinical history</Text>
        {hospitalHistoryQuery.isLoading ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : hospitalHistoryQuery.data?.length ? (
          hospitalHistoryQuery.data.map((item) => (
            <View key={item.id} style={[styles.historyItem, { borderTopColor: theme.borderColor }]}>
              <FileText size={19} color={theme.primary} />
              <View style={styles.infoContent}>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{item.title}</Text>
                <Text style={[styles.infoValue, { color: theme.text }]}>{item.aiSummary || 'Clinical history saved for doctor review.'}</Text>
                {item.pdfUrl ? (
                  <TouchableOpacity
                    style={[styles.historyReportButton, { backgroundColor: theme.primarySoft }]}
                    onPress={async () => {
                      try {
                        await openAiReport(item.pdfUrl!);
                      } catch (error: any) {
                        Alert.alert('Report unavailable', error?.message || 'Could not open the hospital report.');
                      }
                    }}
                  >
                    <Text style={[styles.historyReportButtonText, { color: theme.primary }]}>View hospital report</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))
        ) : (
          <Text style={[styles.emptyHistoryText, { color: theme.textSecondary }]}>No hospital clinical history is available yet.</Text>
        )}
      </View>

      <View style={styles.actionsSection}>
        <TouchableOpacity
          style={[styles.refreshButton, { backgroundColor: theme.cardBackground, borderColor: theme.primary }]}
          onPress={handleRefreshProfile}
          disabled={profileLoading}
        >
          {profileLoading ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Text style={[styles.refreshButtonText, { color: theme.primary }]}>Refresh Profile</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: theme.danger }]}
          onPress={handleLogout}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <LogOut size={20} color="#fff" />
              <Text style={styles.logoutButtonText}>Logout</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.textTertiary }]}>CD4 v1.0.0</Text>
        <Text style={[styles.footerText, { color: theme.textTertiary }]}>Your wellness companion</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f0fff0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fff0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  verificationText: {
    marginLeft: 6,
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
  infoSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoContent: {
    marginLeft: 16,
    flex: 1,
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  emptyHistoryText: {
    color: '#666',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  historyReportButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#E8F6F3',
  },
  historyReportButtonText: {
    color: '#2E7D32',
    fontSize: 12,
    fontWeight: '700',
  },
  actionsSection: {
    marginBottom: 20,
  },
  refreshButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  refreshButtonText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#ff4444',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerText: {
    fontSize: 14,
    color: '#999',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 16,
    color: '#ff4444',
    textAlign: 'center',
    marginTop: 50,
  },
});

export default ProfileScreen;
