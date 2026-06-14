import React from 'react';
import { Redirect } from 'expo-router';
import { useAuthContext } from '../context/AuthContext';
import LoadingScreen from '../ui/common/LoadingScreen';
import RouteLoadingScreen from '../ui/common/RouteLoadingScreen';
import { needsPatientProfileSetup } from '../utils/profileSetup';

export default function Index() {
  const { isAuthenticated, isLoading, isProfileResolved, isProfileLoadedFromDb, user, session } = useAuthContext();

  if (isLoading) {
    return <LoadingScreen message="Initializing app..." />;
  }

  if (isAuthenticated) {
    if (!isProfileResolved) {
      return <RouteLoadingScreen />;
    }

    const metadataRole = typeof session?.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : '';
    const roleSlug = user?.role
      ? String(user.role).toLowerCase().trim()
      : String(metadataRole || 'patient').toLowerCase().trim();
    if (roleSlug === 'admin') {
      return <Redirect href="/admin/dashboard" />;
    }

    if (roleSlug === 'doctor') {
      return <Redirect href="/doctor/dashboard" />;
    }

    if (roleSlug === 'hospital') {
      return <Redirect href="/hospital/dashboard" />;
    }

    if (isProfileResolved && isProfileLoadedFromDb && user && needsPatientProfileSetup(user)) {
      return <Redirect href="/profile-setup" />;
    }

    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth/login" />;
}
