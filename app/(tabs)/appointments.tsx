import React from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  Platform,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  useColorScheme,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, MapPin, Star, X, Clock, Search, Mic } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useDoctors } from '../../hooks/useDoctor';
import { getImageUrl } from '../../constants/Config';
import { getStoredLocationCity, syncLocationCityIfPermitted } from '../../services/locationPermission';
import { getMergedSpecializationOptions } from '../../constants/DoctorOptions';
import { useMyAppointments, useAvailableSlots } from '../../hooks/useAppointment';
import { Slot, Appointment } from '../../src/types';
import { useAuthContext } from '../../context/AuthContext';
import { clearAppointmentCalendarSync, syncAppointmentWithDeviceCalendar } from '../../services/appointmentCalendar';
import { AppointmentsTabSkeleton } from '../../ui/common/TabLoadingSkeletons';
import ShimmerBlock from '../../ui/common/ShimmerSkeleton';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { getLocalizedDoctorName } from '../../src/i18n/nameLocalization';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { useDeferredFocusSync } from '../../hooks/useDeferredFocusSync';

type Doctor = {
  _id?: string;
  id?: string;
  firstName: string;
  lastName: string;
  specialization: string;
  city?: string;
  experience: string;
  fee: string;
  rating: number;
  image?: string;
};

type DoctorWithScore = {
  doctor: Doctor;
  concernScore: number;
  locationScore: number;
};

type DropdownType = 'city' | 'category' | null;
type SlotAction = 'consult' | 'book';
type FilterDropdownOption = { value: string; label: string };

type AvailabilitySlot = {
  action: SlotAction;
  date: Date;
  timeLabel: string;
  displayLabel: string;
};

const BOOKING_LIMIT_WINDOW_DAYS = 30;
const BOOKING_LIMIT_WINDOW_MS = BOOKING_LIMIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const ACTIVE_BOOKING_STATUSES: Appointment['status'][] = ['pending', 'confirmed', 'completed'];
const CALENDAR_SYNC_STATUSES: Appointment['status'][] = ['pending', 'confirmed'];
const CALENDAR_CLEAR_STATUSES: Appointment['status'][] = ['cancelled'];
const DOCTORS_PAGE_SIZE = 5;
const LOAD_MORE_SHIMMER_DELAY_MS = 320;

const normalizeText = (value: string | null | undefined): string => (value || '').trim().toLowerCase();

type IdCarrier = { id?: string | null; _id?: string | null } | null | undefined;

const getEntityId = (entity: IdCarrier): string => {
  const candidate = entity?._id || entity?.id || '';
  return typeof candidate === 'string' ? candidate.trim() : '';
};

const parseConcernParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
};

const isCityMatch = (doctorCity: string | null | undefined, selectedCity: string): boolean => {
  const doctorValue = normalizeText(doctorCity);
  const selectedValue = normalizeText(selectedCity);
  if (!doctorValue || !selectedValue) {
    return false;
  }

  return (
    doctorValue === selectedValue ||
    doctorValue.includes(selectedValue) ||
    selectedValue.includes(doctorValue)
  );
};

const getConcernKeywords = (concern: string): string[] => {
  const value = normalizeText(concern);
  if (!value) {
    return [];
  }

  if (value.includes('diab') || value.includes('sugar') || value.includes('glucose')) {
    return ['diab', 'endocr', 'physician', 'medicine', 'kayachikitsa', 'bams', 'internal'];
  }

  if (value.includes('bp') || value.includes('hyperten') || value.includes('pressure')) {
    return ['cardio', 'physician', 'medicine', 'internal', 'kayachikitsa', 'bams'];
  }

  if (value.includes('skin') || value.includes('rash') || value.includes('itch')) {
    return ['derma', 'skin', 'physician', 'bams', 'kayachikitsa'];
  }

  if (
    value.includes('eye') ||
    value.includes('vision') ||
    value.includes('cataract') ||
    value.includes('glaucoma') ||
    value.includes('ophthal')
  ) {
    return ['ophthal', 'eye', 'vision', 'optom', 'shaalak', 'shalakya'];
  }

  if (value.includes('fever') || value.includes('bukhar') || value.includes('infection')) {
    return ['physician', 'medicine', 'internal', 'infect', 'general', 'bams'];
  }

  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
};

const getConcernScore = (specialization: string, keywords: string[]): number => {
  if (!keywords.length) {
    return 0;
  }

  const normalized = normalizeText(specialization);
  return keywords.reduce((score, keyword) => {
    if (normalized.includes(keyword)) {
      return score + 1;
    }
    return score;
  }, 0);
};

const titleCase = (value: string): string =>
  value
    .split(' ')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(' ');

// Removed static SLOT_TEMPLATES and TIME_SLOT_OPTIONS — now fetched from API
const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const startOfDay = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const isSameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatRelativeDateLabel = (value: Date): string => {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(value, today)) {
    return 'Today';
  }
  if (isSameDay(value, tomorrow)) {
    return 'Tomorrow';
  }

  return value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// getAvailabilityByIndex is no longer needed — all doctors show "Book Slot" with real data

const buildCalendarDays = (monthDate: Date): Array<Date | null> => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;

  const calendarDays: Array<Date | null> = [];
  for (let i = 0; i < leadingEmptyDays; i += 1) {
    calendarDays.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    calendarDays.push(new Date(year, month, day));
  }

  const trailingEmptyDays = (7 - (calendarDays.length % 7)) % 7;
  for (let i = 0; i < trailingEmptyDays; i += 1) {
    calendarDays.push(null);
  }

  return calendarDays;
};

const formatMonthLabel = (value: Date): string =>
  value.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

const showBookingAlert = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n${message}`);
    return;
  }

  Alert.alert(title, message);
};

const inferCategoryFromConcern = (keywords: string[]): string => {
  if (keywords.some((keyword) => keyword.includes('diab') || keyword.includes('sugar') || keyword.includes('glucose'))) {
    return 'Diabetologist';
  }
  if (keywords.some((keyword) => keyword.includes('cardio') || keyword.includes('bp') || keyword.includes('hyperten') || keyword.includes('pressure'))) {
    return 'Cardiologist';
  }
  if (keywords.some((keyword) => keyword.includes('skin') || keyword.includes('rash') || keyword.includes('itch'))) {
    return 'Dermatologist';
  }
  if (keywords.some((keyword) => keyword.includes('eye') || keyword.includes('vision') || keyword.includes('ophthal'))) {
    return 'Ophthalmologist';
  }
  return 'General Physician';
};

export default function AppointmentsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { t, language } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    concern?: string | string[];
    doctorId?: string | string[];
    reportId?: string | string[];
    conversationId?: string | string[];
  }>();
  const { user } = useAuthContext();
  const concern = parseConcernParam(params.concern);
  const preselectedDoctorId = parseConcernParam(params.doctorId);
  const reportId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;

  const { data: doctorsData = [] as Doctor[], isLoading, error: doctorsError, refetch: refetchDoctors } = useDoctors();

  const [locationCity, setLocationCity] = React.useState<string | null>(null);
  const [loadingCity, setLoadingCity] = React.useState(true);
  const [selectedCity, setSelectedCity] = React.useState<string>('all');
  const [selectedCategory, setSelectedCategory] = React.useState<string>('all');
  const [doctorSearchQuery, setDoctorSearchQuery] = React.useState('');
  const [hasUserSelectedCity, setHasUserSelectedCity] = React.useState(false);
  const [openDropdown, setOpenDropdown] = React.useState<DropdownType>(null);
  const [citySearchQuery, setCitySearchQuery] = React.useState('');
  const [debouncedCitySearchQuery, setDebouncedCitySearchQuery] = React.useState('');
  const [isBookingModalVisible, setIsBookingModalVisible] = React.useState(false);
  const [bookingDoctor, setBookingDoctor] = React.useState<Doctor | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<Slot | null>(null);
  const [autoOpenedDoctorId, setAutoOpenedDoctorId] = React.useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);

  // Fetch patient's existing appointments to show booked status
  const { data: myAppointments = [], refetch: refetchApts } = useMyAppointments();
  const [isPullRefreshing, setIsPullRefreshing] = React.useState(false);
  const [isTabSwitchLoading, setIsTabSwitchLoading] = React.useState(false);
  const [visibleDoctorCount, setVisibleDoctorCount] = React.useState(DOCTORS_PAGE_SIZE);
  const [isLoadingMoreDoctors, setIsLoadingMoreDoctors] = React.useState(false);
  const tabSwipeHandlers = useTabSwipeNavigation('appointments', {
    disabled: isBookingModalVisible || openDropdown !== null,
  });
  const loadMoreThrottleRef = React.useRef(0);
  const loadMoreTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRefresh = React.useCallback(async () => {
    if (isPullRefreshing) return;
    setIsPullRefreshing(true);
    try {
      await Promise.all([refetchDoctors(), refetchApts()]);
    } finally {
      setIsPullRefreshing(false);
    }
  }, [isPullRefreshing, refetchDoctors, refetchApts]);

  const syncAppointmentsOnFocus = React.useCallback(async () => {
    await Promise.all([refetchDoctors(), refetchApts()]);
  }, [refetchDoctors, refetchApts]);
  const shouldShowAppointmentsInitialLoading = React.useCallback(
    () => doctorsData.length === 0 && myAppointments.length === 0,
    [doctorsData.length, myAppointments.length]
  );
  const showAppointmentsInitialLoading = React.useCallback(() => setIsTabSwitchLoading(true), []);
  const hideAppointmentsInitialLoading = React.useCallback(() => setIsTabSwitchLoading(false), []);

  useDeferredFocusSync({
    sync: syncAppointmentsOnFocus,
    shouldShowInitialLoading: shouldShowAppointmentsInitialLoading,
    onInitialLoadingStart: showAppointmentsInitialLoading,
    onInitialLoadingEnd: hideAppointmentsInitialLoading,
  });

  const isRefreshing = isPullRefreshing;
  const showAppointmentsSkeleton = (isTabSwitchLoading || isLoading) && !isPullRefreshing;

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCitySearchQuery(citySearchQuery);
    }, 220);
    return () => clearTimeout(timer);
  }, [citySearchQuery]);

  React.useEffect(() => {
    if (openDropdown !== 'city') {
      setCitySearchQuery('');
      setDebouncedCitySearchQuery('');
    }
  }, [openDropdown]);

  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event: any) => {
      setKeyboardHeight(Math.max(0, Number(event?.endCoordinates?.height || 0)));
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const isDarkTheme = theme.background.toLowerCase() === '#121212' || theme.cardBackground.toLowerCase() === '#1e1e1e';
  const skeletonBaseColor = isDarkTheme ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)';
  const skeletonGlowColor = isDarkTheme ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.72)';

  // Map of doctorId -> latest appointment in the last 30 days
  const recentBookingByDoctor = React.useMemo(() => {
    const map: Record<string, { appointment: Appointment; nextBookingAt: Date }> = {};
    const nowMs = Date.now();

    myAppointments.forEach((apt: any) => {
      if (!ACTIVE_BOOKING_STATUSES.includes(apt.status)) return;

      const createdAtMs = new Date(apt.createdAt).getTime();
      if (!Number.isFinite(createdAtMs)) return;
      if (nowMs - createdAtMs > BOOKING_LIMIT_WINDOW_MS) return;

      const dId = typeof apt.doctor === 'string' ? apt.doctor : (apt.doctor as any)?._id;
      if (!dId || map[dId]) return;

      map[dId] = {
        appointment: apt,
        nextBookingAt: new Date(createdAtMs + BOOKING_LIMIT_WINDOW_MS),
      };
    });

    return map;
  }, [myAppointments]);

  React.useEffect(() => {
    let isMounted = true;

    const loadCity = async () => {
      try {
        const storedCity = await getStoredLocationCity();
        if (isMounted && storedCity) {
          setLocationCity(storedCity);
        }

        const syncedCity = await syncLocationCityIfPermitted();
        if (isMounted && syncedCity) {
          setLocationCity(syncedCity);
        }
      } finally {
        if (isMounted) {
          setLoadingCity(false);
        }
      }
    };

    void loadCity();
    return () => {
      isMounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (hasUserSelectedCity) {
      return;
    }

    if (locationCity) {
      setSelectedCity(locationCity);
      return;
    }

    setSelectedCity('all');
  }, [locationCity, hasUserSelectedCity]);

  const cityOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    doctorsData.forEach((doctor) => {
      const city = doctor.city?.trim();
      if (!city) {
        return;
      }
      const key = normalizeText(city);
      if (!key || map.has(key)) {
        return;
      }
      map.set(key, city);
    });

    const list = Array.from(map.values()).sort((a, b) => a.localeCompare(b));
    if (locationCity) {
      const locKey = normalizeText(locationCity);
      if (locKey && !map.has(locKey)) {
        return [locationCity, ...list];
      }
    }
    return list;
  }, [doctorsData, locationCity]);

  const categoryOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    doctorsData.forEach((doctor) => {
      const specialization = doctor.specialization?.trim();
      if (!specialization) {
        return;
      }

      const key = normalizeText(specialization);
      if (!key || map.has(key)) {
        return;
      }
      map.set(key, titleCase(specialization));
    });

    return getMergedSpecializationOptions(Array.from(map.values()));
  }, [doctorsData]);

  const doctorNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    doctorsData.forEach((doctor) => {
      const doctorId = getEntityId(doctor);
      if (!doctorId) return;
      map[doctorId] = getLocalizedDoctorName(
        { firstName: doctor.firstName, lastName: doctor.lastName },
        language,
        { includePrefix: true, fallbackName: t('appointments.yourDoctor') }
      );
    });
    return map;
  }, [doctorsData, language, t]);

  const concernKeywords = React.useMemo(() => getConcernKeywords(concern), [concern]);

  const filteredDoctors = React.useMemo(() => {
    let candidates = doctorsData;

    const searchValue = normalizeText(doctorSearchQuery);
    const hasExplicitSearch = searchValue.length > 0;
    if (searchValue) {
      candidates = candidates.filter((doctor) => {
        const doctorName = `${doctor.firstName} ${doctor.lastName}`;
        return [doctorName, doctor.specialization, doctor.city].some((value) => normalizeText(value).includes(searchValue));
      });
    }

    // An explicit doctor search should search the full directory instead of
    // being silently limited by the user's default location.
    if (!hasExplicitSearch && selectedCity !== 'all') {
      candidates = candidates.filter((doctor) => isCityMatch(doctor.city, selectedCity));
    }

    if (selectedCategory !== 'all') {
      const categoryValue = normalizeText(selectedCategory);
      candidates = candidates.filter((doctor) =>
        normalizeText(doctor.specialization) === categoryValue
      );
    }

    const scored: DoctorWithScore[] = candidates.map((doctor) => ({
      doctor,
      concernScore: getConcernScore(doctor.specialization, concernKeywords),
      locationScore:
        selectedCity === 'all' && locationCity && isCityMatch(doctor.city, locationCity) ? 1 : 0,
    }));

    const hasConcernMatch =
      concernKeywords.length > 0 &&
      selectedCategory === 'all' &&
      !hasExplicitSearch &&
      scored.some((item) => item.concernScore > 0);

    const narrowed = hasConcernMatch
      ? scored.filter((item) => item.concernScore > 0)
      : scored;

    return narrowed
      .sort((a, b) => {
        if (b.concernScore !== a.concernScore) {
          return b.concernScore - a.concernScore;
        }
        if (b.locationScore !== a.locationScore) {
          return b.locationScore - a.locationScore;
        }
        return (b.doctor.rating || 0) - (a.doctor.rating || 0);
      })
      .map((item) => item.doctor);
  }, [doctorsData, selectedCity, selectedCategory, concernKeywords, locationCity, doctorSearchQuery]);

  const visibleDoctors = React.useMemo(
    () => filteredDoctors.slice(0, visibleDoctorCount),
    [filteredDoctors, visibleDoctorCount]
  );
  const canLoadMoreDoctors = visibleDoctorCount < filteredDoctors.length;

  React.useEffect(() => {
    if (loadMoreTimerRef.current) {
      clearTimeout(loadMoreTimerRef.current);
      loadMoreTimerRef.current = null;
    }
    setIsLoadingMoreDoctors(false);
    setVisibleDoctorCount(DOCTORS_PAGE_SIZE);
  }, [selectedCity, selectedCategory, concern]);

  React.useEffect(() => {
    setVisibleDoctorCount(DOCTORS_PAGE_SIZE);
  }, [doctorSearchQuery]);

  React.useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current) {
        clearTimeout(loadMoreTimerRef.current);
        loadMoreTimerRef.current = null;
      }
    };
  }, []);

  const loadMoreDoctors = React.useCallback(() => {
    if (!canLoadMoreDoctors || isLoadingMoreDoctors) return;

    const now = Date.now();
    if (now - loadMoreThrottleRef.current < 220) {
      return;
    }
    loadMoreThrottleRef.current = now;
    setIsLoadingMoreDoctors(true);
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleDoctorCount((current) => Math.min(current + DOCTORS_PAGE_SIZE, filteredDoctors.length));
      setIsLoadingMoreDoctors(false);
      loadMoreTimerRef.current = null;
    }, LOAD_MORE_SHIMMER_DELAY_MS);
  }, [canLoadMoreDoctors, filteredDoctors.length, isLoadingMoreDoctors]);

  const handleDoctorsScroll = React.useCallback((event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent || {};
    if (!layoutMeasurement || !contentOffset || !contentSize) return;
    if (contentSize.height <= layoutMeasurement.height + 24) return;

    const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 220;
    if (nearBottom) {
      loadMoreDoctors();
    }
  }, [loadMoreDoctors]);

  const selectedCityLabel = selectedCity === 'all' ? t('appointments.allCities') : selectedCity;
  const hasConcern = concern.trim().length > 0;
  const triageConcernLabel = hasConcern ? concern : t('appointments.generalSymptoms');
  const triageCategory = React.useMemo(() => {
    if (selectedCategory !== 'all') {
      return selectedCategory;
    }
    if (filteredDoctors.length > 0) {
      return filteredDoctors[0].specialization;
    }
    return inferCategoryFromConcern(concernKeywords);
  }, [selectedCategory, filteredDoctors, concernKeywords]);

  const handleTriagePress = () => {
    if (hasConcern) {
      router.push({ pathname: '/ai-guidance', params: { concern } });
      return;
    }
    router.push('/ai-guidance');
  };

  const toggleDropdown = (type: Exclude<DropdownType, null>) => {
    setOpenDropdown((current) => (current === type ? null : type));
  };

  const cityDropdownOptions = React.useMemo<FilterDropdownOption[]>(
    () => [
      { value: 'all', label: t('appointments.allCities') },
      ...cityOptions.map((city) => ({ value: city, label: city })),
    ],
    [cityOptions, t]
  );

  const categoryDropdownOptions = React.useMemo<FilterDropdownOption[]>(
    () => [
      { value: 'all', label: t('appointments.allSpecialists') },
      ...categoryOptions.map((category) => ({ value: category, label: category })),
    ],
    [categoryOptions, t]
  );

  const activeDropdownTitle = openDropdown === 'city' ? t('appointments.selectCity') : t('appointments.selectDepartment');
  const activeDropdownOptions =
    openDropdown === 'city' ? cityDropdownOptions : categoryDropdownOptions;
  const filteredCityDropdownOptions = React.useMemo<FilterDropdownOption[]>(() => {
    const query = normalizeText(debouncedCitySearchQuery);
    if (!query) return cityDropdownOptions;

    const allOption = cityDropdownOptions.find((option) => option.value === 'all');
    const matches = cityDropdownOptions.filter((option) => {
      if (option.value === 'all') return false;
      return normalizeText(option.label).includes(query);
    });

    return allOption ? [allOption, ...matches] : matches;
  }, [cityDropdownOptions, debouncedCitySearchQuery]);
  const visibleDropdownOptions = openDropdown === 'city' ? filteredCityDropdownOptions : activeDropdownOptions;

  const isDropdownOptionSelected = (optionValue: string): boolean => {
    if (openDropdown === 'city') {
      if (optionValue === 'all') {
        return selectedCity === 'all';
      }
      return normalizeText(selectedCity) === normalizeText(optionValue);
    }

    if (openDropdown === 'category') {
      if (optionValue === 'all') {
        return selectedCategory === 'all';
      }
      return normalizeText(selectedCategory) === normalizeText(optionValue);
    }

    return false;
  };

  const handleDropdownSelect = (optionValue: string) => {
    if (openDropdown === 'city') {
      setHasUserSelectedCity(true);
      setSelectedCity(optionValue === 'all' ? 'all' : optionValue);
      setOpenDropdown(null);
      return;
    }

    if (openDropdown === 'category') {
      setSelectedCategory(optionValue === 'all' ? 'all' : optionValue);
      setOpenDropdown(null);
    }
  };

  const bookingDoctorId = React.useMemo(() => getEntityId(bookingDoctor), [bookingDoctor]);
  const { data: availableSlots = [], isLoading: loadingSlots, error: slotsError } = useAvailableSlots(bookingDoctorId);
  const doctorsErrorMessage = doctorsError instanceof Error ? doctorsError.message : t('appointments.doctorListLoadFailed');
  const slotsErrorMessage = slotsError instanceof Error ? slotsError.message : t('appointments.couldNotLoadSlots');

  const openBookingModal = (doctor: Doctor) => {
    const doctorId = getEntityId(doctor);
    const recentBooking = doctorId ? recentBookingByDoctor[doctorId] : undefined;
    if (recentBooking) {
      const nextBookingLabel = recentBooking.nextBookingAt.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      const doctorName = getLocalizedDoctorName(
        { firstName: doctor.firstName, lastName: doctor.lastName },
        language,
        { fallbackName: t('appointments.yourDoctor') }
      );
      showBookingAlert(
        t('appointments.bookingLimitTitle'),
        t('appointments.bookingLimitBody', {
          doctorName,
          days: BOOKING_LIMIT_WINDOW_DAYS,
          nextDate: nextBookingLabel,
        })
      );
      return;
    }

    setBookingDoctor(doctor);
    setSelectedSlot(null);
    setIsBookingModalVisible(true);
  };

  const closeBookingModal = () => {
    setIsBookingModalVisible(false);
    setSelectedSlot(null);
  };

  React.useEffect(() => {
    if (!user?.id || !myAppointments.length) {
      return;
    }

    myAppointments.forEach((appointment: any) => {
      if (CALENDAR_CLEAR_STATUSES.includes(appointment.status)) {
        void clearAppointmentCalendarSync({
          syncKey: `patient:${user.id}`,
          appointmentId: appointment._id,
        });
        return;
      }

      if (!CALENDAR_SYNC_STATUSES.includes(appointment.status)) return;

      const slot = appointment?.slot as Slot | undefined;
      if (!slot?.date || !slot.startTime) {
        void clearAppointmentCalendarSync({
          syncKey: `patient:${user.id}`,
          appointmentId: appointment._id,
        });
        return;
      }

      const doctorId =
        typeof appointment.doctor === 'string'
          ? appointment.doctor
          : (appointment.doctor as any)?._id;
      const doctorName = doctorId ? doctorNameById[doctorId] || t('appointments.yourDoctor') : t('appointments.yourDoctor');

      void syncAppointmentWithDeviceCalendar({
        syncKey: `patient:${user.id}`,
        appointmentId: appointment._id,
        title: `Consultation with ${doctorName}`,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        notes: `CD4 consultation appointment with ${doctorName}.`,
        reminderMinutes: 30,
      });
    });
  }, [myAppointments, doctorNameById, user?.id]);

  React.useEffect(() => {
    if (!preselectedDoctorId || autoOpenedDoctorId === preselectedDoctorId || isLoading) {
      return;
    }

    const matchedDoctor = doctorsData.find((doctor) => getEntityId(doctor) === preselectedDoctorId);
    if (!matchedDoctor) {
      return;
    }

    openBookingModal(matchedDoctor);
    setAutoOpenedDoctorId(preselectedDoctorId);
  }, [preselectedDoctorId, autoOpenedDoctorId, isLoading, doctorsData]);

  const handleBookSlotConfirm = () => {
    if (!bookingDoctor || !selectedSlot) {
      return;
    }
    const doctorId = getEntityId(bookingDoctor);
    if (!doctorId) {
      showBookingAlert(t('appointments.bookingFailedTitle'), 'Doctor id missing.');
      return;
    }
    const slotId = getEntityId(selectedSlot as unknown as IdCarrier);
    if (!slotId) {
      showBookingAlert(t('appointments.bookingFailedTitle'), 'Slot id missing.');
      return;
    }

    const bookingDoctorName = getLocalizedDoctorName(
      { firstName: bookingDoctor.firstName, lastName: bookingDoctor.lastName },
      language,
      { includePrefix: true, fallbackName: t('appointments.yourDoctor') }
    );

    closeBookingModal();
    router.push({
      pathname: '/confirm-consultation',
      params: {
        doctorId,
        slotId,
        doctorName: bookingDoctorName,
        doctorSpecialization: bookingDoctor.specialization || '',
        doctorCity: bookingDoctor.city || '',
        doctorFee: bookingDoctor.fee || '500',
        concern: concern || '',
        slotDate: String(selectedSlot.date || ''),
        slotStartTime: String(selectedSlot.startTime || ''),
        slotEndTime: String(selectedSlot.endTime || ''),
        reportId: reportId || '',
        conversationId: conversationId || '',
      },
    });
  };

  return (
    <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{t('appointments.title')}</Text>
        <Text style={[styles.headerSubTitle, { color: theme.textSecondary }]}>
          {loadingCity
            ? t('appointments.findingLocation')
            : t('appointments.showingDoctorsNear', { city: locationCity || t('appointments.selectedCityFallback') })}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        onScrollBeginDrag={() => setOpenDropdown(null)}
        onScroll={handleDoctorsScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[theme.tint]}
            tintColor={theme.tint}
          />
        }
      >
        <View style={[styles.searchBar, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Search size={16} color={theme.textSecondary} />
          <TextInput
            value={doctorSearchQuery}
            onChangeText={setDoctorSearchQuery}
            placeholder="Search doctors, clinics..."
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            returnKeyType="search"
          />
          <TouchableOpacity style={[styles.searchVoiceButton, { backgroundColor: theme.tint }]} onPress={() => router.push('/ai-guidance')} activeOpacity={0.84}>
            <Mic size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.categoryHeader}>
          <Text style={[styles.categoryTitle, { color: theme.text }]}>Categories</Text>
          <TouchableOpacity onPress={() => setOpenDropdown('category')} style={styles.categoryArrowButton} activeOpacity={0.8} accessibilityLabel="View all departments"><ChevronRight size={20} color={theme.tint} strokeWidth={2.5} /></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          <TouchableOpacity style={[styles.categoryChip, { backgroundColor: selectedCategory === 'all' ? theme.successLight : theme.cardBackground, borderColor: theme.borderColor }]} onPress={() => setSelectedCategory('all')}>
            <View style={[styles.categoryIcon, { backgroundColor: theme.cardBackground }]}><CalendarDays size={17} color={theme.tint} /></View>
            <Text style={[styles.categoryChipText, { color: theme.text }]}>All</Text>
          </TouchableOpacity>
          {categoryOptions.slice(0, 8).map((category) => {
            const active = normalizeText(selectedCategory) === normalizeText(category);
            return <TouchableOpacity key={category} style={[styles.categoryChip, { backgroundColor: active ? theme.successLight : theme.cardBackground, borderColor: theme.borderColor }]} onPress={() => setSelectedCategory(active ? 'all' : category)}>
              <View style={[styles.categoryIcon, { backgroundColor: active ? theme.cardBackground : (isDarkTheme ? '#26384B' : '#EAF2FB') }]}><MapPin size={17} color={active ? theme.tint : theme.textSecondary} /></View>
              <Text numberOfLines={1} style={[styles.categoryChipText, { color: theme.text }]}>{category}</Text>
            </TouchableOpacity>;
          })}
        </ScrollView>

        <View style={[styles.triageCard, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
          <Text style={[styles.triageLabel, { color: theme.tint }]}>{t('appointments.triageResult')}</Text>
          <Text style={[styles.triageText, { color: theme.text }]}>
            {t('appointments.triageSummary', { concern: triageConcernLabel, category: triageCategory })}
          </Text>
          <TouchableOpacity onPress={handleTriagePress} activeOpacity={0.8}>
            <Text style={[styles.triageAction, { color: theme.text }]}>{t('appointments.viewDetailedReport')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filtersRow}>
          <View style={styles.dropdownWrap}>
            <Text style={[styles.dropdownLabel, { color: theme.textSecondary }]}>{t('appointments.city')}</Text>
            <TouchableOpacity
              style={[styles.dropdownTrigger, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
              onPress={() => toggleDropdown('city')}
              activeOpacity={0.85}
            >
              <Text numberOfLines={1} style={[styles.dropdownValue, { color: theme.text }]}>
                {selectedCityLabel}
              </Text>
              <ChevronDown size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.dropdownWrap}>
            <Text style={[styles.dropdownLabel, { color: theme.textSecondary }]}>{t('appointments.department')}</Text>
            <TouchableOpacity
              style={[styles.dropdownTrigger, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
              onPress={() => toggleDropdown('category')}
              activeOpacity={0.85}
            >
              <Text numberOfLines={1} style={[styles.dropdownValue, { color: theme.text }]}>
                {selectedCategory === 'all' ? t('appointments.allSpecialists') : selectedCategory}
              </Text>
              <ChevronDown size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.listHeader}>
          <Text style={[styles.resultTitle, { color: theme.text }]}>{t('appointments.topRecommendations')}</Text>
          <Text style={[styles.resultSubTitle, { color: theme.textSecondary }]}>
            {visibleDoctors.length}/{filteredDoctors.length}
          </Text>
        </View>

        {showAppointmentsSkeleton ? (
          <AppointmentsTabSkeleton theme={theme} />
        ) : doctorsError ? (
          <View style={styles.loaderWrap}>
            <Text style={[styles.loaderText, { color: theme.textSecondary }]}>{t('appointments.doctorListLoadFailed')}</Text>
            <Text style={[styles.loaderText, { color: theme.textSecondary }]}>{doctorsErrorMessage}</Text>
          </View>
        ) : filteredDoctors.length === 0 ? (
          <View style={styles.loaderWrap}>
            <Text style={[styles.loaderText, { color: theme.textSecondary }]}>{t('appointments.noDoctorsForFilter')}</Text>
            <Text style={[styles.loaderText, { color: theme.textSecondary }]}>{t('appointments.tryAnotherFilter')}</Text>
          </View>
        ) : (
          visibleDoctors.map((doctor) => {
            const doctorId = getEntityId(doctor);
            const recentBooking = doctorId ? recentBookingByDoctor[doctorId] : undefined;
            const bookedApt = recentBooking?.appointment;
            const isBooked = Boolean(recentBooking);
            const bookedSlot = bookedApt?.slot as Slot | undefined;
            let bookedTimeLabel = '';

            if (isBooked && bookedSlot) {
              const d = new Date(bookedSlot.date);
              const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
              bookedTimeLabel = `${dateStr}, ${bookedSlot.startTime}`;
            }

            if (isBooked && recentBooking) {
              const nextBookingLabel = recentBooking.nextBookingAt.toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              });
              bookedTimeLabel = bookedTimeLabel
                ? `${bookedTimeLabel} • ${t('appointments.rebookAfter', { date: nextBookingLabel })}`
                : t('appointments.rebookAfter', { date: nextBookingLabel });
            }

            return (
              <View key={doctorId || `${doctor.firstName}-${doctor.lastName}`} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <TouchableOpacity 
                  style={styles.cardBody}
                  onPress={() => {
                    if (!doctorId) return;
                    router.push(`/user/${doctorId}` as any);
                  }}
                  disabled={!doctorId}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri: getImageUrl(doctor.image) || 'https://i.pravatar.cc/100?img=12' }}
                    style={styles.avatar}
                  />
                  <View style={styles.cardMain}>
                    <View style={styles.cardHeaderMain}>
                      <View style={styles.ratingRow}>
                        <Star size={12} color="#F59E0B" fill="#F59E0B" />
                        <Text style={[styles.ratingLabel, { color: theme.textSecondary }]}>
                          {(doctor.rating || 0).toFixed(1)}
                        </Text>
                      </View>
                      <Text style={[styles.doctorName, { color: theme.text }]}>
                        {getLocalizedDoctorName(
                          { firstName: doctor.firstName, lastName: doctor.lastName },
                          language,
                          { includePrefix: true, fallbackName: t('appointments.yourDoctor') }
                        )}
                      </Text>
                      <Text style={[styles.specialization, { color: theme.textSecondary }]}>
                        {doctor.specialization}
                      </Text>
                      <Text style={[styles.experienceText, { color: theme.textSecondary }]}>
                        {t('appointments.experience', { years: doctor.experience })}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <View style={styles.metaItem}>
                        <MapPin size={12} color={theme.textSecondary} />
                        <Text style={[styles.metaText, { color: theme.textSecondary }]}>
                          {doctor.city || t('appointments.cityNotSet')}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={[styles.footerRow, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                  <View style={styles.nextAvailabilityBlock}>
                    <Text style={[styles.nextLabel, { color: theme.textSecondary }]}>
                      {isBooked ? t('appointments.appointmentBooked') : t('appointments.bookAppointment')}
                    </Text>
                    <Text numberOfLines={1} style={[styles.nextTime, { color: isBooked ? theme.tint : theme.text }]}>
                      {isBooked ? bookedTimeLabel : t('appointments.viewAvailableSlots')}
                    </Text>
                  </View>
                  {isBooked ? (
                    <TouchableOpacity
                      style={[
                        styles.bookButton,
                        { backgroundColor: theme.tint, borderColor: theme.tint },
                      ]}
                      onPress={() => router.push({
                        pathname: '/chat-detail',
                        params: {
                          otherId: doctorId,
                          name: getLocalizedDoctorName(
                            { firstName: doctor.firstName, lastName: doctor.lastName },
                            language,
                            { includePrefix: true, fallbackName: t('appointments.yourDoctor') }
                          )
                        }
                      })}
                      disabled={!doctorId}

                    >
                      <Text style={[styles.bookButtonText, { color: '#fff' }]}>{t('appointments.consultNow')}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.bookButton,
                        { backgroundColor: theme.successLight, borderColor: theme.successBorder },
                      ]}
                      onPress={() => {
                        if (!doctorId) return;
                        openBookingModal({ ...doctor, _id: doctorId });
                      }}
                      disabled={!doctorId}
                    >
                      <Text
                        style={[
                          styles.bookButtonText,
                          { color: theme.tint },
                        ]}
                      >
                        {t('appointments.consultNow')}
                      </Text>
                      <CalendarDays size={13} color={theme.tint} style={styles.bookButtonIcon} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}

        {!showAppointmentsSkeleton && isLoadingMoreDoctors ? (
          <View style={styles.loadMoreShimmerWrap}>
            {Array.from({ length: 2 }).map((_, index) => (
              <View
                key={`appointments-load-more-shimmer-${index}`}
                style={[styles.loadMoreShimmerCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
              >
                <View style={styles.loadMoreShimmerHeader}>
                  <ShimmerBlock height={62} width={62} borderRadius={12} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                  <View style={styles.loadMoreShimmerInfo}>
                    <ShimmerBlock height={12} width="58%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                    <View style={{ height: 8 }} />
                    <ShimmerBlock height={10} width="46%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                    <View style={{ height: 8 }} />
                    <ShimmerBlock height={10} width="34%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                  </View>
                </View>
                <View style={{ height: 10 }} />
                <ShimmerBlock height={36} width="100%" borderRadius={10} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
              </View>
            ))}
          </View>
        ) : null}

        {!showAppointmentsSkeleton && !doctorsError && filteredDoctors.length > 0 && canLoadMoreDoctors ? (
          <View style={styles.loadMoreHintWrap}>
            <Text style={[styles.loadMoreHintText, { color: theme.textSecondary }]}>
              Scroll down to load more doctors
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={openDropdown !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenDropdown(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          enabled={Platform.OS === 'ios'}
          style={[
            styles.filterModalOverlay,
            {
              paddingBottom: Platform.OS === 'android'
                ? Math.max(insets.bottom + 12, keyboardHeight > 0 ? keyboardHeight + 12 : 12)
                : insets.bottom + 12,
            },
          ]}
        >
          <Pressable style={styles.filterModalBackdrop} onPress={() => setOpenDropdown(null)} />
          <View
            style={[
              styles.filterModalSheet,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.borderColor,
                maxHeight: keyboardHeight > 0 ? '56%' : '62%',
              },
            ]}
          >
            <View style={styles.filterModalHeader}>
              <Text style={[styles.filterModalTitle, { color: theme.text }]}>{activeDropdownTitle}</Text>
              <TouchableOpacity onPress={() => setOpenDropdown(null)} style={styles.filterModalClose} activeOpacity={0.8}>
                <X size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {openDropdown === 'city' ? (
              <View style={[styles.filterSearchWrap, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                <Search size={14} color={theme.textSecondary} />
                <TextInput
                  style={[styles.filterSearchInput, { color: theme.text }]}
                  placeholder={t('appointments.selectCity')}
                  placeholderTextColor={theme.textSecondary}
                  value={citySearchQuery}
                  onChangeText={setCitySearchQuery}
                />
              </View>
            ) : null}

            <ScrollView
              style={styles.filterModalList}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {visibleDropdownOptions.map((option) => {
                const isSelected = isDropdownOptionSelected(option.value);
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.filterModalItem,
                      { borderColor: theme.borderColor },
                      isSelected && { backgroundColor: theme.successLight, borderColor: theme.successBorder },
                    ]}
                    onPress={() => handleDropdownSelect(option.value)}
                    activeOpacity={0.82}
                  >
                    <Text style={[styles.filterModalItemText, { color: isSelected ? theme.tint : theme.text }]}>
                      {option.label}
                    </Text>
                    {isSelected && <Check size={15} color={theme.tint} />}
                  </TouchableOpacity>
                );
              })}
              {openDropdown === 'city' && visibleDropdownOptions.length <= 1 && citySearchQuery.trim().length > 0 ? (
                <View style={styles.filterEmptyState}>
                  <Text style={[styles.loaderText, { color: theme.textSecondary }]}>
                    No city found for "{citySearchQuery.trim()}"
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isBookingModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeBookingModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeBookingModal} />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.borderColor,
                paddingBottom: Math.max(16, insets.bottom + 12),
              },
            ]}
          >
            <View style={[styles.modalGrabber, { backgroundColor: theme.borderColor }]} />
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTextWrap}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>{t('appointments.bookAppointment')}</Text>
                <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                  {bookingDoctor
                    ? getLocalizedDoctorName(
                        { firstName: bookingDoctor.firstName, lastName: bookingDoctor.lastName },
                        language,
                        { includePrefix: true, fallbackName: t('appointments.yourDoctor') }
                      )
                    : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={closeBookingModal} style={styles.closeButton} activeOpacity={0.8}>
                <X size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.timeTitle, { color: theme.textSecondary }]}>{t('appointments.availableSlots')}</Text>

            {loadingSlots ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={theme.tint} />
                <Text style={{ marginTop: 12, color: theme.textSecondary }}>{t('appointments.loadingAvailableSlots')}</Text>
              </View>
            ) : slotsError ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <CalendarDays size={40} color={theme.textSecondary} />
                <Text style={{ marginTop: 12, color: theme.textSecondary, fontSize: 15 }}>{t('appointments.couldNotLoadSlots')}</Text>
                <Text style={{ marginTop: 4, color: theme.textSecondary, fontSize: 12, textAlign: 'center' }}>
                  {slotsErrorMessage}
                </Text>
              </View>
            ) : availableSlots.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <CalendarDays size={40} color={theme.textSecondary} />
                <Text style={{ marginTop: 12, color: theme.textSecondary, fontSize: 15 }}>{t('appointments.noAvailableSlots')}</Text>
                <Text style={{ marginTop: 4, color: theme.textSecondary, fontSize: 12 }}>{t('appointments.noOpenSlotsYet')}</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                {availableSlots.map((slot: Slot) => {
                  const dateObj = new Date(slot.date);
                  const formattedDate = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
                  const slotId = getEntityId(slot as unknown as IdCarrier);
                  const selectedSlotId = getEntityId(selectedSlot as unknown as IdCarrier);
                  const isSelected = Boolean(slotId) && selectedSlotId === slotId;
                  return (
                    <TouchableOpacity
                      key={slotId || `${slot.date}-${slot.startTime}-${slot.endTime}`}
                      style={[
                        styles.slotItem,
                        {
                          backgroundColor: isSelected ? theme.tint + '18' : theme.background,
                          borderColor: isSelected ? theme.tint : theme.borderColor,
                        },
                      ]}
                      onPress={() => setSelectedSlot(slot)}
                      activeOpacity={0.82}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                          <Clock size={14} color={isSelected ? theme.tint : theme.textSecondary} style={{ marginRight: 6 }} />
                          <Text style={[{ fontSize: 15, fontWeight: '700' }, { color: isSelected ? theme.tint : theme.text }]}>
                            {slot.startTime} – {slot.endTime}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <CalendarDays size={12} color={theme.textSecondary} style={{ marginRight: 6 }} />
                          <Text style={{ fontSize: 13, color: theme.textSecondary }}>{formattedDate}</Text>
                        </View>
                      </View>
                      {isSelected && <Check size={18} color={theme.tint} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[
                styles.confirmButton,
                {
                  backgroundColor: theme.successLight,
                  borderColor: theme.successBorder,
                  opacity: selectedSlot ? 1 : 0.65,
                },
              ]}
              onPress={handleBookSlotConfirm}
              disabled={!selectedSlot}
              activeOpacity={0.85}
            >
              <Text style={[styles.confirmButtonText, { color: theme.tint }]}>{t('appointments.confirmAndBookSlot')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 28, fontWeight: '800' },
  headerSubTitle: { fontSize: 12, marginTop: 4 },
  content: { paddingHorizontal: 16, paddingBottom: 90 },
  searchBar: { height: 44, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 12, marginLeft: 8, paddingVertical: 0 },
  searchVoiceButton: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  categoryTitle: { fontSize: 14, fontWeight: '800' },
  categoryArrowButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  categoryRow: { gap: 8, paddingBottom: 14 },
  categoryChip: { width: 72, height: 78, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  categoryIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  categoryChipText: { fontSize: 9, fontWeight: '700', textAlign: 'center' },
  triageCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  triageLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 7,
  },
  triageText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  emphasis: { fontWeight: '700' },
  triageAction: { marginTop: 10, fontSize: 13, fontWeight: '700' },
  filtersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  dropdownWrap: {
    width: '48.5%',
    position: 'relative',
  },
  dropdownLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' },
  dropdownTrigger: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownValue: { flex: 1, fontSize: 13, fontWeight: '600', marginRight: 8 },
  dropdownMenu: {
    position: 'absolute',
    top: 66,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    zIndex: 40,
  },
  dropdownScroll: { maxHeight: 220 },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dropdownItemText: {
    fontSize: 13,
    fontWeight: '600',
  },
  listHeader: {
    marginTop: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  resultSubTitle: { fontSize: 12, fontWeight: '600' },
  loaderWrap: { paddingVertical: 30, alignItems: 'center', justifyContent: 'center' },
  loaderText: { marginTop: 8, fontSize: 13 },
  loadMoreShimmerWrap: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  loadMoreShimmerCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  loadMoreShimmerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  loadMoreShimmerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  loadMoreHintWrap: {
    paddingTop: 2,
    paddingBottom: 10,
    alignItems: 'center',
  },
  loadMoreHintText: {
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  cardBody: { flexDirection: 'row', alignItems: 'flex-start' },
  avatar: {
    width: 66,
    height: 66,
    borderRadius: 12,
    backgroundColor: '#DCE2E8',
  },
  cardMain: { flex: 1, marginLeft: 12 },
  cardHeaderMain: { flex: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  ratingLabel: { fontSize: 12, fontWeight: '700', marginLeft: 4 },
  doctorName: { fontSize: 17, fontWeight: '800' },
  specialization: { fontSize: 13, marginTop: 2, fontWeight: '600' },
  experienceText: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  metaText: { fontSize: 12, marginLeft: 4 },
  footerRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    width: '100%',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  nextAvailabilityBlock: {
    flex: 1,
    marginRight: 12,
  },
  nextLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nextTime: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  bookButton: {
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minWidth: 112,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookButtonText: { fontSize: 12, fontWeight: '800' },
  bookButtonIcon: { marginLeft: 6 },
  filterModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  filterModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,12,10,0.48)',
  },
  filterModalSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 18,
    maxHeight: '62%',
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  filterModalTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  filterModalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterModalList: {
    maxHeight: 360,
  },
  filterSearchWrap: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  filterSearchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 10,
    fontWeight: '500',
  },
  filterModalItem: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterModalItemText: {
    fontSize: 14,
    fontWeight: '700',
  },
  filterEmptyState: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,12,10,0.5)',
  },
  modalCard: {
    width: '100%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -6 },
    maxHeight: '86%',
  },
  modalGrabber: {
    width: 46,
    height: 4.5,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalHeaderTextWrap: { flex: 1, paddingRight: 8 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  modalSubtitle: { marginTop: 2, fontSize: 13, fontWeight: '600' },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthControl: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  monthArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: { fontSize: 14, fontWeight: '700' },
  dayLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  dayLabel: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    padding: 2,
  },
  dayButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledDay: { opacity: 0.38 },
  dayValue: { fontSize: 12, fontWeight: '700' },
  timeTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  timeSlotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  timeSlotChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
  },
  timeSlotText: {
    fontSize: 12,
    fontWeight: '700',
  },
  confirmButton: {
    borderRadius: 11,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  slotItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
});
