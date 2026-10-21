import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  Image,
  Modal,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { addInAppNotice } from "../../lib/supabase";
import { syncLocalDataToCloudIfOnline } from "../../lib/supabase";

interface AppItem {
  packageName: string;
  appName: string;
  icon?: string;
}

interface ScheduleItem {
  id: string;
  isEnabled: boolean;
  startTime: Date;
  endTime: Date;
  activeDays: number[];
}

interface FocusSessionState {
  active: boolean;
  startTimeMillis: number;
  endTimeMillis: number;
  lockMode: "SESSION" | "SCHEDULE";
  pomodoroEnabled: boolean;
  isBreakActive: boolean;
  cycleRemainingMillis: number;
  emergencyPasses: number;
  streakDays: number;
  totalCompleted: number;
  ytUsedMinutes: number;
  ytLimitMinutes: number;
}

interface NativeFocusLock {
  isAccessibilityServiceEnabled: () => Promise<boolean>;
  openAccessibilitySettings: () => Promise<boolean>;
  isOverlayPermissionGranted?: () => Promise<boolean>;
  openOverlaySettings?: () => Promise<boolean>;
  isDeviceAdminEnabled?: () => Promise<boolean>;
  openDeviceAdminSettings?: () => Promise<boolean>;
  checkAndRequestBatteryWhitelist?: () => Promise<boolean>;

  getInstalledApps: () => Promise<AppItem[]>;
  saveAllowedApps: (apps: string[]) => Promise<boolean>;
  saveAllowedDomains?: (domains: string[]) => Promise<boolean>;
  setYouTubeLimitMinutes?: (limitMinutes: number) => Promise<boolean>;
  openApp: (packageName: string) => Promise<boolean>;

  startQuickFocus: (
    durationMinutes: number,
    allowedPackages: string[],
    ytLimitMinutes: number,
    pomodoroEnabled: boolean,
  ) => Promise<string>;

  setAdvancedSchedules?: (
    schedulesJson: string,
    enabled: boolean,
    allowedPackages: string[],
    ytLimitMinutes: number,
  ) => Promise<string>;

  setFocusSchedule: (
    startHour: number,
    startMinute: number,
    endHour: number,
    endMinute: number,
    enabled: boolean,
    allowedPackages: string[],
    ytLimitMinutes: number,
    activeDays: number[],
    sessionEndTimeMillis: number,
  ) => Promise<string>;

  getFocusSessionState?: () => Promise<FocusSessionState>;
  useEmergencyPass?: () => Promise<boolean>;
}

const { FocusLock } = NativeModules as {
  FocusLock?: NativeFocusLock;
};

const DAYS = [
  { id: 0, label: "M" },
  { id: 1, label: "T" },
  { id: 2, label: "W" },
  { id: 3, label: "T" },
  { id: 4, label: "F" },
  { id: 5, label: "S" },
  { id: 6, label: "S" },
];

const MAX_SELECTED_APPS = 6;
const DEFAULT_ALLOWED_DOMAINS = [
  "github.com",
  "stackoverflow.com",
  "chatgpt.com",
  "docs.cloudflare.com",
  "jnu.ac.bd",
];

const getAppColor = (name: string) => {
  const colors = [
    "#38BDF8",
    "#22C55E",
    "#EF4444",
    "#F87171",
    "#34D399",
    "#FBBF24",
    "#818CF8",
  ];
  return colors[name.length % colors.length];
};

export default function StrictFocusScreen() {
  // Session Lock Config
  const [customDuration, setCustomDuration] = useState("120");
  const [pomodoroEnabled, setPomodoroEnabled] = useState(true);
  const [ytLimitMinutes, setYtLimitMinutes] = useState(90);

  // Permissions State
  const [permState, setPermState] = useState({
    accessibility: false,
    overlay: false,
    deviceAdmin: false,
  });

  // Allowed Apps (Max 6) & Allowed Chrome Websites
  const [installedApps, setInstalledApps] = useState<AppItem[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<string[]>(
    DEFAULT_ALLOWED_DOMAINS,
  );
  const [newDomainInput, setNewDomainInput] = useState("");
  const [loadingApps, setLoadingApps] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [appModalVisible, setAppModalVisible] = useState(false);
  const [domainModalVisible, setDomainModalVisible] = useState(false);
  const [emergencyModalVisible, setEmergencyModalVisible] = useState(false);

  // Schedule Lock Config
  const [schedules, setSchedules] = useState<ScheduleItem[]>([
    {
      id: "1",
      isEnabled: false,
      startTime: new Date(new Date().setHours(22, 0, 0, 0)),
      endTime: new Date(new Date().setHours(6, 0, 0, 0)),
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    },
  ]);
  const [showPicker, setShowPicker] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<{
    id: string;
    type: "start" | "end";
  } | null>(null);

  // Live Session & Gamified Emergency Pass State (0 to 5 passes, 3-day streak)
  const [isFocusActive, setIsFocusActive] = useState(false);
  const [sessionEndTimeMillis, setSessionEndTimeMillis] = useState(0);
  const [remainingMillis, setRemainingMillis] = useState(0);
  const [lockMode, setLockMode] = useState<"SESSION" | "SCHEDULE">("SESSION");
  const [isBreakActive, setIsBreakActive] = useState(false);
  const [cycleRemainingMillis, setCycleRemainingMillis] = useState(0);
  const [emergencyPasses, setEmergencyPasses] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [ytUsedMinutes, setYtUsedMinutes] = useState(0);

  const fillAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const isStartingFocusRef = useRef(false);
  const isHoldPressActiveRef = useRef(false);

  const checkAllPermissions = useCallback(async () => {
    if (Platform.OS !== "android" || !FocusLock) return;
    try {
      const [acc, ovl, adm] = await Promise.all([
        FocusLock.isAccessibilityServiceEnabled(),
        FocusLock.isOverlayPermissionGranted
          ? FocusLock.isOverlayPermissionGranted()
          : Promise.resolve(true),
        FocusLock.isDeviceAdminEnabled
          ? FocusLock.isDeviceAdminEnabled()
          : Promise.resolve(false),
      ]);
      setPermState({
        accessibility: !!acc,
        overlay: !!ovl,
        deviceAdmin: !!adm,
      });
    } catch {}
  }, []);

  const refreshFocusSession = useCallback(async () => {
    if (!FocusLock?.getFocusSessionState) return;
    try {
      const session = await FocusLock.getFocusSessionState();
      const active = session.active && session.endTimeMillis > Date.now();
      setIsFocusActive(active);
      setSessionEndTimeMillis(active ? session.endTimeMillis : 0);
      setRemainingMillis(
        active ? Math.max(0, session.endTimeMillis - Date.now()) : 0,
      );
      setLockMode(session.lockMode || "SESSION");
      setIsBreakActive(!!session.isBreakActive);
      setCycleRemainingMillis(Math.max(0, session.cycleRemainingMillis || 0));
      setEmergencyPasses(session.emergencyPasses ?? 0);
      setStreakDays(session.streakDays ?? 0);
      setYtUsedMinutes(session.ytUsedMinutes ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (Platform.OS === "android" && Platform.Version >= 33) {
      void PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
    }
    void checkAllPermissions();
    void refreshFocusSession();
    void loadSettings();
    setTimeout(() => {
      void fetchInstalledApps();
    }, 150);

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void checkAllPermissions();
        void refreshFocusSession();
      }
    });

    const syncInterval = setInterval(() => {
      void refreshFocusSession();
    }, 1000);

    return () => {
      subscription.remove();
      clearInterval(syncInterval);
    };
  }, [checkAllPermissions, refreshFocusSession]);

  // Block hardware back button when strict lock is active
  useEffect(() => {
    if (!isFocusActive) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => subscription.remove();
  }, [isFocusActive]);

  const fetchInstalledApps = async () => {
    try {
      if (FocusLock?.getInstalledApps) {
        const apps = await FocusLock.getInstalledApps();
        const uniqueAppsArray = Array.from(
          new Map(apps.map((app: AppItem) => [app.packageName, app])).values(),
        ) as AppItem[];
        const sortedApps = uniqueAppsArray.sort((a, b) =>
          a.appName.localeCompare(b.appName),
        );
        setInstalledApps(sortedApps);
      }
    } catch {
    } finally {
      setLoadingApps(false);
    }
  };

  const loadSettings = async () => {
    try {
      const [savedApps, savedDomains, savedSchedules, savedYtLimit] =
        await Promise.all([
          AsyncStorage.getItem("@focus_allowed_apps"),
          AsyncStorage.getItem("@focus_allowed_domains"),
          AsyncStorage.getItem("@focus_multi_schedules"),
          AsyncStorage.getItem("@focus_yt_limit_minutes"),
        ]);

      if (savedApps) {
        const parsedApps: string[] = JSON.parse(savedApps).slice(
          0,
          MAX_SELECTED_APPS,
        );
        setSelectedApps(parsedApps);
      }

      if (savedDomains) {
        const parsedDomains: string[] = JSON.parse(savedDomains);
        setAllowedDomains(parsedDomains);
        if (FocusLock?.saveAllowedDomains) {
          await FocusLock.saveAllowedDomains(parsedDomains);
        }
      } else if (FocusLock?.saveAllowedDomains) {
        await FocusLock.saveAllowedDomains(DEFAULT_ALLOWED_DOMAINS);
      }

      if (savedYtLimit) {
        const limit = parseInt(savedYtLimit, 10) || 90;
        setYtLimitMinutes(limit);
      }

      if (savedSchedules) {
        const parsed = JSON.parse(savedSchedules);
        setSchedules(
          parsed.map((s: any) => ({
            ...s,
            startTime: new Date(s.startTime),
            endTime: new Date(s.endTime),
          })),
        );
      }
    } catch {}
  };

  const verifyRequiredPermissionsBeforeLock = async (): Promise<boolean> => {
    if (Platform.OS !== "android" || !FocusLock) return false;
    const acc = await FocusLock.isAccessibilityServiceEnabled();
    const ovl = FocusLock.isOverlayPermissionGranted
      ? await FocusLock.isOverlayPermissionGranted()
      : true;

    if (!ovl && FocusLock.openOverlaySettings) {
      Alert.alert(
        "Display Over Other Apps প্রয়োজন",
        "অন্য অ্যাপ থেকে ০ সেকেন্ডে সরাসরি লক স্ক্রিনে টেনে আনার জন্য 'Display over other apps' পারমিশনটি অন করুন।",
        [
          { text: "বাতিল", style: "cancel" },
          {
            text: "Settings ওপেন করুন",
            onPress: () => void FocusLock.openOverlaySettings?.(),
          },
        ],
      );
      return false;
    }

    if (!acc) {
      Alert.alert(
        "Accessibility Service প্রয়োজন",
        "অ্যাপ লক, Chrome ওয়েবসাইট ফিল্টার এবং YouTube Shorts ব্লক করার জন্য Accessibility পারমিশন অন করুন।",
        [
          { text: "বাতিল", style: "cancel" },
          {
            text: "Settings ওপেন করুন",
            onPress: () => void FocusLock.openAccessibilitySettings(),
          },
        ],
      );
      return false;
    }

    return true;
  };

  const formatTime = (date: Date) => {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const strMinutes = minutes < 10 ? "0" + minutes : minutes;
    return `${hours}:${strMinutes} ${ampm}`;
  };

  const formatCountdown = (millis: number) => {
    const totalSeconds = Math.max(0, Math.ceil(millis / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const saveAllSchedules = async (
    schedulesToSave = schedules,
    silent = false,
  ): Promise<void> => {
    try {
      if (!FocusLock) return;
      const hasEnabled = schedulesToSave.some((s) => s.isEnabled);

      if (hasEnabled && !(await verifyRequiredPermissionsBeforeLock())) {
        return;
      }

      await AsyncStorage.setItem(
        "@focus_multi_schedules",
        JSON.stringify(schedulesToSave),
      );
      await FocusLock.saveAllowedApps(selectedApps);
      if (FocusLock.saveAllowedDomains) {
        await FocusLock.saveAllowedDomains(allowedDomains);
      }

      const formattedSchedules = schedulesToSave.map((s) => ({
        isEnabled: s.isEnabled,
        startHour: s.startTime.getHours(),
        startMinute: s.startTime.getMinutes(),
        endHour: s.endTime.getHours(),
        endMinute: s.endTime.getMinutes(),
        activeDays: s.activeDays,
      }));

      if (FocusLock.setAdvancedSchedules) {
        await FocusLock.setAdvancedSchedules(
          JSON.stringify(formattedSchedules),
          hasEnabled,
          selectedApps,
          ytLimitMinutes,
        );
      }

      void syncLocalDataToCloudIfOnline();

      if (!silent) {
        Vibration.vibrate(100);
        Alert.alert(
          "Schedule Lock সেভ হয়েছে ⏰",
          hasEnabled
            ? "আপনার নির্ধারিত সময়ে প্রতিদিন অটোমেটিক কড়া লক চালু হয়ে যাবে।"
            : "শিডিউল সেভ হয়েছে (বর্তমানে অফ করা আছে)।",
        );
      }
    } catch {
      if (!silent) Alert.alert("Error", "Could not save schedules.");
    }
  };

  const startSessionLockNow = async () => {
    if (isStartingFocusRef.current) return;
    const parsedDuration = parseInt(customDuration, 10);
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      Alert.alert("সময় সঠিক নয়", "কত মিনিট লক করতে চান তা সঠিকভাবে লিখুন।");
      return;
    }

    isStartingFocusRef.current = true;
    try {
      if (!FocusLock) return;
      if (!(await verifyRequiredPermissionsBeforeLock())) return;

      await FocusLock.saveAllowedApps(selectedApps);
      if (FocusLock.saveAllowedDomains) {
        await FocusLock.saveAllowedDomains(allowedDomains);
      }

      await FocusLock.startQuickFocus(
        parsedDuration,
        selectedApps,
        ytLimitMinutes,
        pomodoroEnabled,
      );

      await AsyncStorage.setItem(
        "@focus_allowed_apps",
        JSON.stringify(selectedApps),
      );
      void syncLocalDataToCloudIfOnline();
      await refreshFocusSession();
    } catch {
      Alert.alert("Error", "Could not start Session Lock.");
    } finally {
      isStartingFocusRef.current = false;
    }
  };

  const handleEmergencyUnlockConfirm = async () => {
    if (!FocusLock?.useEmergencyPass) return;
    if (emergencyPasses <= 0) {
      Alert.alert(
        "কোনো Emergency Pass নেই 🔒",
        "আপনার কাছে এখন ০টি পাস আছে। টানা ৩ দিন নিয়ম মেনে লক পূর্ণ করলে ১টি Emergency Pass পাবেন!",
      );
      setEmergencyModalVisible(false);
      return;
    }

    try {
      const success = await FocusLock.useEmergencyPass();
      setEmergencyModalVisible(false);
      if (success) {
        Vibration.vibrate(200);
        await refreshFocusSession();
        await addInAppNotice({
          id: `pass-used-${Date.now()}`,
          title: "🎟️ ১টি Emergency Pass ব্যবহৃত হয়েছে",
          message: `আপনি জরুরি প্রয়োজনে লক আনলক করেছেন। আপনার ১টি পাস কেটে নেওয়া হয়েছে এবং ৩ দিনের স্ট্রিক কাউন্টার রিসেট হয়েছে।`,
          timestamp: Date.now(),
          read: false,
          type: "lock",
        });
        void syncLocalDataToCloudIfOnline();
      }
    } catch {
      Alert.alert("Error", "Emergency Pass ব্যবহার করা যায়নি।");
    }
  };

  const toggleAppSelection = (pkg: string) => {
    if (selectedApps.includes(pkg)) {
      setSelectedApps((prev) => prev.filter((p) => p !== pkg));
    } else {
      if (selectedApps.length >= MAX_SELECTED_APPS) {
        Alert.alert(
          "সর্বোচ্চ ৬টি অ্যাপ সিলেক্ট করা যাবে ✋",
          "ফোকাস ধরে রাখতে লক চলাকালীন সর্বোচ্চ ৬টি জরুরি অ্যাপ ব্যবহারের অনুমতি দেওয়া যাবে।",
        );
        return;
      }
      setSelectedApps((prev) => [...prev, pkg]);
    }
  };

  const confirmAndSaveAllowedApps = async () => {
    try {
      if (FocusLock?.saveAllowedApps) {
        await FocusLock.saveAllowedApps(selectedApps);
      }
      await AsyncStorage.setItem(
        "@focus_allowed_apps",
        JSON.stringify(selectedApps),
      );
      setAppModalVisible(false);
      setSearchQuery("");
      await saveAllSchedules(schedules, true);
    } catch {}
  };

  const addDomain = async () => {
    const clean = newDomainInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!clean || allowedDomains.includes(clean)) {
      setNewDomainInput("");
      return;
    }
    const updated = [...allowedDomains, clean];
    setAllowedDomains(updated);
    setNewDomainInput("");
    await AsyncStorage.setItem(
      "@focus_allowed_domains",
      JSON.stringify(updated),
    );
    if (FocusLock?.saveAllowedDomains) {
      await FocusLock.saveAllowedDomains(updated);
    }
    void syncLocalDataToCloudIfOnline();
  };

  const removeDomain = async (domain: string) => {
    const updated = allowedDomains.filter((d) => d !== domain);
    setAllowedDomains(updated);
    await AsyncStorage.setItem(
      "@focus_allowed_domains",
      JSON.stringify(updated),
    );
    if (FocusLock?.saveAllowedDomains) {
      await FocusLock.saveAllowedDomains(updated);
    }
    void syncLocalDataToCloudIfOnline();
  };

  const updateYtQuota = async (mins: number) => {
    setYtLimitMinutes(mins);
    await AsyncStorage.setItem("@focus_yt_limit_minutes", String(mins));
    if (FocusLock?.setYouTubeLimitMinutes) {
      await FocusLock.setYouTubeLimitMinutes(mins);
    }
    void syncLocalDataToCloudIfOnline();
  };

  const handlePressIn = () => {
    isHoldPressActiveRef.current = true;
    void (async () => {
      if (!(await verifyRequiredPermissionsBeforeLock())) return;
      if (!isHoldPressActiveRef.current) return;
      Animated.spring(scaleAnim, {
        toValue: 0.95,
        useNativeDriver: true,
      }).start();
      Animated.timing(fillAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      }).start();
    })();
  };

  const handlePressOut = () => {
    isHoldPressActiveRef.current = false;
    fillAnim.stopAnimation();
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
    Animated.timing(fillAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const filteredApps = installedApps.filter((app) =>
    app.appName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // =========================================================================
  // ACTIVE LOCK SCREEN DASHBOARD (0ms Pull-To-Lock-App Destination)
  // =========================================================================
  if (isFocusActive) {
    const allowedAppObjects = installedApps.filter((app) =>
      selectedApps.includes(app.packageName),
    );

    return (
      <SafeAreaView className="flex-1 bg-[#070B14] px-6">
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingVertical: 24,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Pass & Mode Pill */}
          <View className="flex-row items-center justify-between mb-6">
            <View className="bg-slate-800/90 border border-slate-700 px-3.5 py-2 rounded-full flex-row items-center">
              <Ionicons
                name={
                  lockMode === "SCHEDULE"
                    ? "calendar"
                    : isBreakActive
                      ? "cafe"
                      : "shield-checkmark"
                }
                size={15}
                color={isBreakActive ? "#34D399" : "#F43F5E"}
              />
              <Text
                allowFontScaling={false}
                className="text-slate-200 font-bold text-xs ml-1.5"
              >
                {lockMode === "SCHEDULE"
                  ? "Schedule Lock"
                  : pomodoroEnabled
                    ? "Session (25m / 5m)"
                    : "Session Lock"}
              </Text>
            </View>

            <View className="bg-amber-500/15 border border-amber-500/30 px-3.5 py-2 rounded-full flex-row items-center">
              <Ionicons name="ticket" size={15} color="#FBBF24" />
              <Text
                allowFontScaling={false}
                className="text-amber-300 font-bold text-xs ml-1.5"
              >
                Pass: {emergencyPasses} / 5
              </Text>
            </View>
          </View>

          {/* Center Lock / Break Status */}
          <View className="items-center my-4">
            <View
              className={`w-24 h-24 rounded-full items-center justify-center border-2 ${
                isBreakActive
                  ? "bg-emerald-500/15 border-emerald-400"
                  : "bg-rose-500/15 border-rose-500"
              }`}
            >
              <Ionicons
                name={isBreakActive ? "cafe" : "lock-closed"}
                size={46}
                color={isBreakActive ? "#34D399" : "#F43F5E"}
              />
            </View>

            <Text
              allowFontScaling={false}
              className="text-white text-2xl font-black mt-5 text-center"
            >
              {isBreakActive
                ? "৫ মিনিটের ফ্রি ব্রেক চলছে! ☕"
                : "Strict Focus Lock Active 🔒"}
            </Text>

            <Text
              allowFontScaling={false}
              className="text-slate-400 text-xs font-medium mt-1.5 text-center px-4"
            >
              {isBreakActive
                ? "ব্রেক শেষ হওয়া মাত্রই আপনাকে আবার এই লক স্ক্রিনে টেনে আনা হবে।"
                : "সিলেক্ট করা অ্যাপ ছাড়া অন্য কোথাও গেলে সাথে সাথে এখানে ফিরিয়ে আনা হবে।"}
            </Text>

            {/* Primary Countdown */}
            <Text
              allowFontScaling={false}
              className={`text-5xl font-black mt-6 tracking-widest ${
                isBreakActive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {lockMode === "SESSION" && pomodoroEnabled
                ? formatCountdown(cycleRemainingMillis)
                : formatCountdown(remainingMillis)}
            </Text>

            {lockMode === "SESSION" && pomodoroEnabled && (
              <View className="bg-slate-800/80 px-4 py-1.5 rounded-full mt-2 border border-slate-700">
                <Text
                  allowFontScaling={false}
                  className="text-slate-300 text-xs font-bold"
                >
                  {isBreakActive
                    ? "পরবর্তী ২৫ মি. লক শুরু হতে বাকি • "
                    : "৫ মি. ব্রেক পেতে বাকি • "}
                  মোট সেশন বাকি: {formatCountdown(remainingMillis)}
                </Text>
              </View>
            )}
          </View>

          {/* YouTube Quota Bar */}
          <View className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 my-3 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Ionicons name="logo-youtube" size={18} color="#EF4444" />
              <Text
                allowFontScaling={false}
                className="text-slate-300 text-xs font-bold ml-2"
              >
                YouTube Long Video (Shorts Blocked)
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              className="text-indigo-400 text-xs font-black"
            >
              {ytUsedMinutes}m / {ytLimitMinutes}m
            </Text>
          </View>

          {/* 5-6 Allowed Apps Minimalist Grid */}
          <View className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 mt-3">
            <Text
              allowFontScaling={false}
              className="text-slate-400 text-xs font-bold uppercase tracking-wider text-center mb-4"
            >
              অনুমোদিত অ্যাপ ({allowedAppObjects.length}/{MAX_SELECTED_APPS})
            </Text>

            {allowedAppObjects.length === 0 ? (
              <Text
                allowFontScaling={false}
                className="text-slate-500 text-xs text-center py-3"
              >
                কোনো অ্যাপ সিলেক্ট করা হয়নি।
              </Text>
            ) : (
              <View className="flex-row flex-wrap justify-center">
                {allowedAppObjects.map((app) => (
                  <Pressable
                    key={app.packageName}
                    onPress={() => void FocusLock?.openApp(app.packageName)}
                    className="items-center w-[28%] mx-1.5 mb-4 bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 active:bg-slate-700"
                  >
                    {app.icon ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${app.icon}` }}
                        style={{ width: 42, height: 42, borderRadius: 10 }}
                      />
                    ) : (
                      <Ionicons
                        name="apps"
                        size={42}
                        color={getAppColor(app.appName)}
                      />
                    )}
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-white text-[11px] font-bold mt-2 text-center"
                    >
                      {app.appName}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Earned Emergency Pass Unlock Button */}
          <Pressable
            onPress={() => setEmergencyModalVisible(true)}
            className={`mt-6 py-4 px-5 rounded-2xl border flex-row items-center justify-center ${
              emergencyPasses > 0
                ? "bg-amber-500/15 border-amber-500/40 active:bg-amber-500/25"
                : "bg-slate-900 border-slate-800 opacity-60"
            }`}
          >
            <Ionicons
              name={emergencyPasses > 0 ? "ticket-outline" : "lock-closed"}
              size={18}
              color={emergencyPasses > 0 ? "#FBBF24" : "#64748B"}
            />
            <Text
              allowFontScaling={false}
              className={`font-bold text-xs ml-2 ${
                emergencyPasses > 0 ? "text-amber-300" : "text-slate-500"
              }`}
            >
              {emergencyPasses > 0
                ? `Emergency Unlock (১টি পাস কাটবে • জমা আছে: ${emergencyPasses}/5)`
                : `Emergency Unlock লকড (পাস: 0/5 • ৩ দিন পূর্ণ করে পাস পান)`}
            </Text>
          </Pressable>
        </ScrollView>

        {/* Emergency Unlock Confirmation Modal */}
        <Modal
          visible={emergencyModalVisible}
          transparent
          animationType="fade"
        >
          <View className="flex-1 bg-black/80 justify-center items-center px-6">
            <View className="bg-slate-900 w-full rounded-3xl p-6 border border-slate-700 items-center">
              <View className="w-16 h-16 rounded-full bg-amber-500/20 border border-amber-500/40 items-center justify-center mb-4">
                <Ionicons name="warning" size={32} color="#FBBF24" />
              </View>
              <Text
                allowFontScaling={false}
                className="text-white font-black text-xl text-center mb-2"
              >
                {emergencyPasses > 0
                  ? "১টি Emergency Pass খরচ করবেন?"
                  : "কোনো Emergency Pass জমা নেই!"}
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-xs text-center leading-5 mb-6"
              >
                {emergencyPasses > 0
                  ? `এখন লক ভাঙলে আপনার জমানো ${emergencyPasses}টি পাস থেকে ১টি পাস কেটে নেওয়া হবে (বাকি থাকবে ${emergencyPasses - 1}টি) এবং আপনার চলমান ৩ দিনের স্ট্রিক আবার ০ হয়ে যাবে!`
                  : `আপনার পাস সংখ্যা এখন 0। টানা ৩ দিন নিয়ম মেনে লক পূর্ণ করলে ১টি করে পাস পাবেন (সর্বোচ্চ ৫টি)।`}
              </Text>

              <View className="flex-row gap-3 w-full">
                <Pressable
                  onPress={() => setEmergencyModalVisible(false)}
                  className="flex-1 bg-slate-800 py-3.5 rounded-2xl items-center"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-sm"
                  >
                    ফিরে যান
                  </Text>
                </Pressable>
                {emergencyPasses > 0 && (
                  <Pressable
                    onPress={() => void handleEmergencyUnlockConfirm()}
                    className="flex-1 bg-rose-600 py-3.5 rounded-2xl items-center"
                  >
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-sm"
                    >
                      হ্যাঁ, ১টি পাস কাটুন
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // =========================================================================
  // SETUP & CONFIGURATION SCREEN
  // =========================================================================
  const allPermsReady =
    permState.accessibility && permState.overlay && permState.deviceAdmin;

  return (
    <SafeAreaView
      className="flex-1 bg-[#0F172A]"
      edges={["top", "left", "right"]}
    >
      <StatusBar style="light" />

      {/* HEADER */}
      <View className="px-6 pt-3 pb-3 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="w-10 h-10 bg-indigo-500/20 rounded-2xl items-center justify-center mr-3 border border-indigo-500/30">
            <Ionicons name="shield-checkmark" size={22} color="#818CF8" />
          </View>
          <View>
            <Text
              allowFontScaling={false}
              className="text-2xl font-black text-white tracking-tight"
            >
              Strict Focus Lock
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-400 text-xs font-medium"
            >
              Schedule Lock • 25m/5m Session • Shorts & URL Filter
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {/* 🎟️ GAMIFIED EMERGENCY PASS & 3-DAY STREAK CARD */}
        <View className="bg-slate-800/90 p-4 rounded-3xl border border-slate-700 mb-5">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center">
              <View className="w-9 h-9 rounded-xl bg-amber-500/20 items-center justify-center mr-3">
                <Ionicons name="ticket" size={20} color="#FBBF24" />
              </View>
              <View>
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  Emergency Unlock Passes
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-[11px]"
                >
                  টানা ৩ দিন লক পূর্ণ করলে +1 Pass (সর্বোচ্চ ৫টি)
                </Text>
              </View>
            </View>
            <View className="bg-amber-500/20 px-3 py-1.5 rounded-xl border border-amber-500/40">
              <Text
                allowFontScaling={false}
                className="text-amber-300 font-black text-base"
              >
                {emergencyPasses} / 5
              </Text>
            </View>
          </View>

          {/* 3-Day Progress Bar */}
          <View className="bg-slate-900 p-3 rounded-2xl border border-slate-700/60">
            <View className="flex-row justify-between items-center mb-2">
              <Text
                allowFontScaling={false}
                className="text-slate-300 text-xs font-bold"
              >
                🔥 পরবর্তী পাসের অগ্রগতি (৩ দিনের স্ট্রিক)
              </Text>
              <Text
                allowFontScaling={false}
                className="text-indigo-400 text-xs font-black"
              >
                {streakDays} / 3 দিন
              </Text>
            </View>
            <View className="flex-row gap-2">
              {[1, 2, 3].map((dayNum) => (
                <View
                  key={dayNum}
                  className={`flex-1 h-2.5 rounded-full ${
                    streakDays >= dayNum ? "bg-emerald-400" : "bg-slate-700"
                  }`}
                />
              ))}
            </View>
          </View>
        </View>

        {/* 🛡️ 3 ANDROID PERMISSIONS SETUP CARD */}
        {!allPermsReady && (
          <View className="bg-slate-800 p-4 rounded-3xl border border-rose-500/40 mb-5">
            <Text
              allowFontScaling={false}
              className="text-white font-bold text-sm mb-1"
            >
              ⚙️ কড়া লকের জন্য ৩টি সিস্টেম পারমিশন অন করুন
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-400 text-xs mb-3"
            >
              হোম বাটন চাপলে ০ সেকেন্ডে লক স্ক্রিনে টেনে আনতে এবং আনইনস্টল বন্ধ
              রাখতে নিচের সুইচগুলো অন করুন:
            </Text>

            <Pressable
              onPress={() => void FocusLock?.openOverlaySettings?.()}
              className="flex-row items-center justify-between bg-slate-900 p-3 rounded-2xl mb-2 border border-slate-700"
            >
              <View className="flex-row items-center flex-1 pr-2">
                <Ionicons
                  name={
                    permState.overlay ? "checkmark-circle" : "layers-outline"
                  }
                  size={20}
                  color={permState.overlay ? "#34D399" : "#F87171"}
                />
                <View className="ml-2.5 flex-1">
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-xs"
                  >
                    1. Display Over Other Apps (0ms Pull-Back)
                  </Text>
                  <Text
                    allowFontScaling={false}
                    className="text-slate-400 text-[10px]"
                  >
                    অন্য অ্যাপে গেলে দেরি না করে সাথে সাথে লক অ্যাপে টেনে আনে
                  </Text>
                </View>
              </View>
              <Text
                allowFontScaling={false}
                className={`text-xs font-bold ${permState.overlay ? "text-emerald-400" : "text-indigo-400"}`}
              >
                {permState.overlay ? "Ready ✅" : "Allow →"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void FocusLock?.openAccessibilitySettings()}
              className="flex-row items-center justify-between bg-slate-900 p-3 rounded-2xl mb-2 border border-slate-700"
            >
              <View className="flex-row items-center flex-1 pr-2">
                <Ionicons
                  name={
                    permState.accessibility
                      ? "checkmark-circle"
                      : "eye-outline"
                  }
                  size={20}
                  color={permState.accessibility ? "#34D399" : "#F87171"}
                />
                <View className="ml-2.5 flex-1">
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-xs"
                  >
                    2. Accessibility Service (Shorts & Chrome Filter)
                  </Text>
                  <Text
                    allowFontScaling={false}
                    className="text-slate-400 text-[10px]"
                  >
                    YouTube Shorts এবং অননুমোদিত অ্যাপ/ওয়েবসাইট শনাক্ত করে
                  </Text>
                </View>
              </View>
              <Text
                allowFontScaling={false}
                className={`text-xs font-bold ${permState.accessibility ? "text-emerald-400" : "text-indigo-400"}`}
              >
                {permState.accessibility ? "Ready ✅" : "Allow →"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void FocusLock?.openDeviceAdminSettings?.()}
              className="flex-row items-center justify-between bg-slate-900 p-3 rounded-2xl border border-slate-700"
            >
              <View className="flex-row items-center flex-1 pr-2">
                <Ionicons
                  name={
                    permState.deviceAdmin
                      ? "checkmark-circle"
                      : "shield-outline"
                  }
                  size={20}
                  color={permState.deviceAdmin ? "#34D399" : "#FBBF24"}
                />
                <View className="ml-2.5 flex-1">
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-xs"
                  >
                    3. Device Administrator (Uninstall Protection)
                  </Text>
                  <Text
                    allowFontScaling={false}
                    className="text-slate-400 text-[10px]"
                  >
                    লক চলাকালীন কেউ অ্যাপ Uninstall করতে পারবে না
                  </Text>
                </View>
              </View>
              <Text
                allowFontScaling={false}
                className={`text-xs font-bold ${permState.deviceAdmin ? "text-emerald-400" : "text-indigo-400"}`}
              >
                {permState.deviceAdmin ? "Ready ✅" : "Activate →"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* SECTION 1: SESSION LOCK (WITH 25M FOCUS + 5M BREAK POMODORO CYCLE) */}
        <View className="bg-slate-800 p-5 rounded-[32px] border border-slate-700 mb-6">
          <Text
            allowFontScaling={false}
            className="text-white font-bold text-xl mb-1 text-center"
          >
            Session Lock (One-Time)
          </Text>
          <Text
            allowFontScaling={false}
            className="text-slate-400 text-xs text-center mb-5"
          >
            মোট লকের সময় দিন (প্রতি ২৫ মিনিট পর ৫ মিনিট ফ্রি ব্রেক পাবেন)
          </Text>

          <View className="flex-row items-center justify-center mb-4">
            <TextInput
              allowFontScaling={false}
              value={customDuration}
              onChangeText={(text) =>
                setCustomDuration(text.replace(/[^0-9]/g, ""))
              }
              keyboardType="number-pad"
              maxLength={3}
              placeholder="120"
              placeholderTextColor="#475569"
              className="text-white text-4xl font-black bg-slate-900 border border-slate-700 rounded-2xl w-32 text-center py-2.5"
            />
            <Text
              allowFontScaling={false}
              className="text-slate-400 font-bold text-sm ml-3 tracking-widest"
            >
              MINS
            </Text>
          </View>

          {/* Quick Duration Chips */}
          <View className="flex-row justify-center gap-2 mb-5">
            {[
              { label: "1 Hour", val: "60" },
              { label: "2 Hours", val: "120" },
              { label: "4 Hours", val: "240" },
            ].map((preset) => (
              <Pressable
                key={preset.val}
                onPress={() => setCustomDuration(preset.val)}
                className={`px-3.5 py-1.5 rounded-full border ${
                  customDuration === preset.val
                    ? "bg-indigo-500/20 border-indigo-400"
                    : "bg-slate-900 border-slate-700"
                }`}
              >
                <Text
                  allowFontScaling={false}
                  className={`text-xs font-bold ${
                    customDuration === preset.val
                      ? "text-indigo-300"
                      : "text-slate-400"
                  }`}
                >
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* 25m + 5m Toggle */}
          <View className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-700/70 flex-row items-center justify-between mb-6">
            <View className="flex-1 pr-3">
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-xs"
              >
                ☕ ২৫ মিনিট লক + ৫ মিনিট ব্রেক সাইকেল
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-[11px] mt-0.5"
              >
                প্রতি ২৫ মিনিট কড়া লকের পর ৫ মিনিট ফ্রি অ্যাক্সেস ও অটো-লক
              </Text>
            </View>
            <Switch
              value={pomodoroEnabled}
              onValueChange={setPomodoroEnabled}
              trackColor={{ false: "#334155", true: "#10B981" }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* HOLD BUTTON */}
          <View className="items-center justify-center">
            <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
              <Pressable
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                onLongPress={() => {
                  Vibration.vibrate(100);
                  void startSessionLockNow();
                  handlePressOut();
                }}
                delayLongPress={1500}
                className="items-center justify-center h-28 w-28 rounded-full border-[3px] border-slate-700 bg-slate-900 overflow-hidden"
              >
                <Animated.View
                  className="absolute w-full h-full rounded-full bg-rose-500"
                  style={{
                    transform: [
                      {
                        scale: fillAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 1.2],
                        }),
                      },
                    ],
                    opacity: fillAnim.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.3, 0.8, 1],
                    }),
                  }}
                />
                <Ionicons
                  name="lock-closed"
                  size={36}
                  color="white"
                  style={{ zIndex: 10 }}
                />
                <Text
                  allowFontScaling={false}
                  className="text-white/80 font-bold text-[10px] tracking-widest mt-1 z-10"
                >
                  HOLD 1.5s
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        </View>

        {/* SECTION 2: WHITELISTED APPS (MAX 6 APPS) */}
        <View className="flex-row justify-between items-center mb-3 px-2">
          <Text
            allowFontScaling={false}
            className="text-slate-400 font-bold uppercase text-xs tracking-wider"
          >
            Selected Apps ({selectedApps.length}/{MAX_SELECTED_APPS})
          </Text>
          <Pressable onPress={() => setAppModalVisible(true)}>
            <Text
              allowFontScaling={false}
              className="text-indigo-400 font-bold text-xs bg-indigo-500/10 px-3 py-1.5 rounded-full"
            >
              + সিলেক্ট করুন (Max 6)
            </Text>
          </Pressable>
        </View>

        <View className="bg-slate-800 p-4 rounded-[24px] border border-slate-700 mb-6">
          {selectedApps.length === 0 ? (
            <Text
              allowFontScaling={false}
              className="text-slate-500 text-center py-2 text-xs"
            >
              লক চলাকালীন ব্যবহারের জন্য সর্বোচ্চ ৬টি অ্যাপ সিলেক্ট করুন।
            </Text>
          ) : loadingApps ? (
            <View className="py-4 items-center justify-center">
              <ActivityIndicator size="small" color="#818CF8" />
            </View>
          ) : (
            installedApps
              .filter((a) => selectedApps.includes(a.packageName))
              .map((app) => (
                <View
                  key={app.packageName}
                  className="flex-row items-center py-2.5 border-b border-slate-700/50 last:border-b-0"
                >
                  {app.icon ? (
                    <Image
                      source={{ uri: `data:image/png;base64,${app.icon}` }}
                      style={{ width: 24, height: 24, borderRadius: 5 }}
                    />
                  ) : (
                    <Ionicons
                      name="apps"
                      size={24}
                      color={getAppColor(app.appName)}
                    />
                  )}
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold ml-3 flex-1 text-sm"
                  >
                    {app.appName}
                  </Text>
                  <Pressable onPress={() => toggleAppSelection(app.packageName)}>
                    <Ionicons name="close-circle" size={18} color="#94A3B8" />
                  </Pressable>
                </View>
              ))
          )}
        </View>

        {/* SECTION 3: CHROME WEBSITES & YOUTUBE LONG VIDEO QUOTA */}
        <View className="bg-slate-800 p-5 rounded-[28px] border border-slate-700 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center">
              <Ionicons name="globe-outline" size={20} color="#38BDF8" />
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-sm ml-2"
              >
                Chrome অনুমোদিত ওয়েবসাইট ({allowedDomains.length})
              </Text>
            </View>
            <Pressable
              onPress={() => setDomainModalVisible(true)}
              className="bg-sky-500/15 px-3 py-1 rounded-full border border-sky-500/30"
            >
              <Text
                allowFontScaling={false}
                className="text-sky-400 font-bold text-xs"
              >
                এডিট করুন
              </Text>
            </Pressable>
          </View>
          <Text
            allowFontScaling={false}
            className="text-slate-400 text-xs mb-4"
          >
            অনুমোদিত ডোমেইন: {allowedDomains.join(", ")}
          </Text>

          <View className="border-t border-slate-700 pt-4">
            <View className="flex-row items-center mb-2">
              <Ionicons name="logo-youtube" size={20} color="#EF4444" />
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-sm ml-2"
              >
                YouTube লং ভিডিও লিমিট (Shorts ১০০% ব্লক)
              </Text>
            </View>
            <View className="flex-row gap-2 mt-2">
              {[
                { label: "1 Hour (60m)", val: 60 },
                { label: "1.5 Hours (90m)", val: 90 },
                { label: "2 Hours (120m)", val: 120 },
              ].map((opt) => (
                <Pressable
                  key={opt.val}
                  onPress={() => void updateYtQuota(opt.val)}
                  className={`flex-1 py-2.5 rounded-xl items-center border ${
                    ytLimitMinutes === opt.val
                      ? "bg-rose-500/20 border-rose-500"
                      : "bg-slate-900 border-slate-700"
                  }`}
                >
                  <Text
                    allowFontScaling={false}
                    className={`text-xs font-bold ${
                      ytLimitMinutes === opt.val
                        ? "text-rose-400"
                        : "text-slate-400"
                    }`}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* SECTION 4: DAILY RECURRING SCHEDULE LOCK */}
        <View className="flex-row justify-between items-center mb-3 px-2">
          <Text
            allowFontScaling={false}
            className="text-slate-400 font-bold uppercase text-xs tracking-wider"
          >
            Daily Schedule Lock ({schedules.length}/4)
          </Text>
          {schedules.length < 4 && (
            <Pressable
              onPress={async () => {
                const newSched: ScheduleItem = {
                  id: Date.now().toString(),
                  isEnabled: false,
                  startTime: new Date(new Date().setHours(10, 0, 0, 0)),
                  endTime: new Date(new Date().setHours(14, 0, 0, 0)),
                  activeDays: [0, 1, 2, 3, 4, 5, 6],
                };
                const updated = [...schedules, newSched];
                setSchedules(updated);
                await saveAllSchedules(updated, true);
              }}
            >
              <Text
                allowFontScaling={false}
                className="text-indigo-400 font-bold text-xs bg-indigo-500/10 px-3 py-1.5 rounded-full"
              >
                + নতুন শিডিউল
              </Text>
            </Pressable>
          )}
        </View>

        {schedules.map((schedule, index) => (
          <View
            key={schedule.id}
            className="bg-slate-800 p-5 rounded-[32px] border border-slate-700 mb-4"
          >
            <View className="flex-row items-center justify-between mb-5">
              <View className="flex-1 pr-4">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-lg mb-0.5"
                >
                  Schedule Lock {index + 1}
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-xs"
                >
                  প্রতিদিন নির্ধারিত সময়ে অটোমেটিক একটানা কড়া লক
                </Text>
              </View>
              <Switch
                value={schedule.isEnabled}
                onValueChange={async (val) => {
                  const updated = schedules.map((s) =>
                    s.id === schedule.id ? { ...s, isEnabled: val } : s,
                  );
                  setSchedules(updated);
                  await saveAllSchedules(updated, false);
                }}
                trackColor={{ false: "#334155", true: "#818CF8" }}
                thumbColor={schedule.isEnabled ? "#FFFFFF" : "#94A3B8"}
              />
            </View>

            <View className="bg-slate-900/60 p-4 rounded-[24px] border border-slate-700/50 mb-4 flex-row items-center justify-between">
              <Pressable
                onPress={() => {
                  setEditingSchedule({ id: schedule.id, type: "start" });
                  setShowPicker(true);
                }}
                className="items-center flex-1"
              >
                <Text
                  allowFontScaling={false}
                  className="text-slate-500 text-xs mb-0.5 font-bold uppercase"
                >
                  শুরু হবে
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-indigo-400 font-black text-xl"
                >
                  {formatTime(schedule.startTime)}
                </Text>
              </Pressable>
              <Ionicons name="arrow-forward" size={20} color="#475569" />
              <Pressable
                onPress={() => {
                  setEditingSchedule({ id: schedule.id, type: "end" });
                  setShowPicker(true);
                }}
                className="items-center flex-1"
              >
                <Text
                  allowFontScaling={false}
                  className="text-slate-500 text-xs mb-0.5 font-bold uppercase"
                >
                  শেষ হবে
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-rose-400 font-black text-xl"
                >
                  {formatTime(schedule.endTime)}
                </Text>
              </Pressable>
            </View>

            <View className="flex-row justify-between">
              {DAYS.map((day) => {
                const isActive = schedule.activeDays.includes(day.id);
                return (
                  <Pressable
                    key={day.id}
                    onPress={async () => {
                      const updated = schedules.map((s) => {
                        if (s.id !== schedule.id) return s;
                        const newDays = s.activeDays.includes(day.id)
                          ? s.activeDays.filter((d) => d !== day.id)
                          : [...s.activeDays, day.id];
                        return { ...s, activeDays: newDays };
                      });
                      setSchedules(updated);
                      await saveAllSchedules(updated, true);
                    }}
                    className={`w-9 h-9 rounded-full items-center justify-center border ${
                      isActive
                        ? "bg-indigo-500 border-indigo-400"
                        : "bg-slate-900 border-slate-700"
                    }`}
                  >
                    <Text
                      allowFontScaling={false}
                      className={`font-bold text-xs ${isActive ? "text-white" : "text-slate-500"}`}
                    >
                      {day.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {schedules.length > 1 && (
              <Pressable
                onPress={async () => {
                  const updated = schedules.filter((s) => s.id !== schedule.id);
                  setSchedules(updated);
                  await saveAllSchedules(updated, true);
                }}
                className="mt-4 py-2 flex-row justify-center items-center"
              >
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                <Text className="text-rose-500 font-bold text-xs ml-1">
                  মুছে ফেলুন
                </Text>
              </Pressable>
            )}
          </View>
        ))}

        <Pressable
          onPress={() => void saveAllSchedules(schedules, false)}
          className="bg-indigo-600 py-4 rounded-[16px] items-center justify-center active:bg-indigo-700 mb-6"
        >
          <Text
            allowFontScaling={false}
            className="text-white font-bold text-sm"
          >
            Save All Schedules
          </Text>
        </Pressable>
      </ScrollView>

      {/* APP PICKER MODAL (MAX 6 APPS) */}
      <Modal visible={appModalVisible} transparent animationType="slide">
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-slate-900 w-full rounded-t-[32px] p-6 border-t border-slate-700 max-h-[85%]">
            <View className="flex-row justify-between items-center mb-4">
              <View>
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-xl"
                >
                  Select Allowed Apps ({selectedApps.length}/{MAX_SELECTED_APPS})
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-xs mt-0.5"
                >
                  লক চলাকালীন সর্বোচ্চ ৬টি অ্যাপ ব্যবহার করা যাবে
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setAppModalVisible(false);
                  setSearchQuery("");
                }}
                className="h-9 w-9 bg-slate-800 rounded-full items-center justify-center"
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
              </Pressable>
            </View>

            <TextInput
              placeholder="অ্যাপ খুঁজুন..."
              placeholderTextColor="#64748B"
              value={searchQuery}
              onChangeText={setSearchQuery}
              className="bg-slate-800 text-white px-4 py-3 rounded-xl mb-4 border border-slate-700"
            />

            <ScrollView showsVerticalScrollIndicator={false} className="mb-4">
              {filteredApps.map((app) => {
                const isChecked = selectedApps.includes(app.packageName);
                return (
                  <Pressable
                    key={app.packageName}
                    onPress={() => toggleAppSelection(app.packageName)}
                    className={`p-3.5 rounded-2xl mb-2 flex-row items-center justify-between border ${
                      isChecked
                        ? "bg-indigo-500/15 border-indigo-500/50"
                        : "bg-slate-800 border-slate-700"
                    }`}
                  >
                    <View className="flex-row items-center flex-1 pr-4">
                      {app.icon ? (
                        <Image
                          source={{ uri: `data:image/png;base64,${app.icon}` }}
                          style={{ width: 26, height: 26, borderRadius: 6 }}
                        />
                      ) : (
                        <Ionicons
                          name="apps"
                          size={26}
                          color={getAppColor(app.appName)}
                        />
                      )}
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-white font-bold ml-3 text-sm flex-1"
                      >
                        {app.appName}
                      </Text>
                    </View>
                    <Ionicons
                      name={isChecked ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={isChecked ? "#818CF8" : "#64748B"}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => void confirmAndSaveAllowedApps()}
              className="bg-indigo-600 py-3.5 rounded-2xl items-center justify-center mb-4"
            >
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-sm"
              >
                Save & Close ({selectedApps.length}/{MAX_SELECTED_APPS})
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* CHROME ALLOWED DOMAINS MODAL */}
      <Modal visible={domainModalVisible} transparent animationType="slide">
        <View className="flex-1 bg-black/75 justify-end">
          <View className="bg-slate-900 w-full rounded-t-[32px] p-6 border-t border-slate-700 max-h-[80%]">
            <View className="flex-row justify-between items-center mb-4">
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-lg"
              >
                Chrome অনুমোদিত ওয়েবসাইট লিস্ট
              </Text>
              <Pressable
                onPress={() => setDomainModalVisible(false)}
                className="h-9 w-9 bg-slate-800 rounded-full items-center justify-center"
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
              </Pressable>
            </View>

            <View className="flex-row gap-2 mb-4">
              <TextInput
                placeholder="যেমন: leetcode.com বা docs.google.com"
                placeholderTextColor="#64748B"
                value={newDomainInput}
                onChangeText={setNewDomainInput}
                autoCapitalize="none"
                className="flex-1 bg-slate-800 text-white px-4 py-3 rounded-xl border border-slate-700"
              />
              <Pressable
                onPress={() => void addDomain()}
                className="bg-indigo-600 px-5 rounded-xl items-center justify-center"
              >
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  Add
                </Text>
              </Pressable>
            </View>

            <ScrollView className="mb-4">
              {allowedDomains.map((dom) => (
                <View
                  key={dom}
                  className="flex-row items-center justify-between bg-slate-800 px-4 py-3 rounded-xl mb-2 border border-slate-700"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-white font-medium text-sm"
                  >
                    🌐 {dom}
                  </Text>
                  <Pressable onPress={() => void removeDomain(dom)}>
                    <Ionicons name="trash-outline" size={18} color="#F43F5E" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {showPicker && editingSchedule && (
        <DateTimePicker
          value={
            editingSchedule.type === "start"
              ? schedules.find((s) => s.id === editingSchedule.id)?.startTime ||
                new Date()
              : schedules.find((s) => s.id === editingSchedule.id)?.endTime ||
                new Date()
          }
          mode="time"
          is24Hour={false}
          display="default"
          onChange={async (_event, date) => {
            if (Platform.OS === "android") setShowPicker(false);
            if (date && editingSchedule) {
              const updated = schedules.map((s) =>
                s.id === editingSchedule.id
                  ? {
                      ...s,
                      [editingSchedule.type === "start"
                        ? "startTime"
                        : "endTime"]: date,
                    }
                  : s,
              );
              setSchedules(updated);
              await saveAllSchedules(updated, true);
            }
            setEditingSchedule(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}
