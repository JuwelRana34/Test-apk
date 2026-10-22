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
  ImageBackground,
  KeyboardAvoidingView,
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
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  addInAppNotice,
  spendEmergencyPassWithCloudCheck,
  syncLocalDataToCloudIfOnline,
} from "../../lib/supabase";

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
  totalPassesEarned?: number;
  totalPassesUsed?: number;
  streakDays: number;
  totalCompleted: number;
  ytUsedSeconds?: number;
  ytUsedMinutes: number;
  ytLimitMinutes: number;
  lastCompletedDate?: string;
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
  openUrlInChrome?: (domainOrUrl: string) => Promise<boolean>;

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
const MAX_ALLOWED_DOMAINS = 5;
const DEFAULT_ALLOWED_DOMAINS = [
  "github.com",
  "stackoverflow.com",
  "chatgpt.com",
  "docs.cloudflare.com",
  "jnu.ac.bd",
];

const HERO_BG_URI =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1000&q=80";

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
  const insets = useSafeAreaInsets();

  const [customDuration, setCustomDuration] = useState("60");
  const [pomodoroEnabled, setPomodoroEnabled] = useState(true);
  const [ytLimitMinutes, setYtLimitMinutes] = useState(90);

  const [permState, setPermState] = useState({
    accessibility: false,
    overlay: false,
    deviceAdmin: false,
  });

  const [installedApps, setInstalledApps] = useState<AppItem[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<string[]>(
    DEFAULT_ALLOWED_DOMAINS,
  );
  const [newDomainInput, setNewDomainInput] = useState("");
  const [loadingApps, setLoadingApps] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modals for Clean Setup Architecture
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [passInfoModalVisible, setPassInfoModalVisible] = useState(false);
  const [appModalVisible, setAppModalVisible] = useState(false);
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [emergencyModalVisible, setEmergencyModalVisible] = useState(false);
  const [spendingPass, setSpendingPass] = useState(false);

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

  const [isFocusActive, setIsFocusActive] = useState(false);
  const [remainingMillis, setRemainingMillis] = useState(0);
  const [lockMode, setLockMode] = useState<"SESSION" | "SCHEDULE">("SESSION");
  const [isBreakActive, setIsBreakActive] = useState(false);
  const [cycleRemainingMillis, setCycleRemainingMillis] = useState(0);
  const [emergencyPasses, setEmergencyPasses] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [ytUsedSeconds, setYtUsedSeconds] = useState(0);

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
      setRemainingMillis(
        active ? Math.max(0, session.endTimeMillis - Date.now()) : 0,
      );
      setLockMode(session.lockMode || "SESSION");
      setIsBreakActive(!!session.isBreakActive);
      setCycleRemainingMillis(Math.max(0, session.cycleRemainingMillis || 0));
      setEmergencyPasses(session.emergencyPasses ?? 0);
      setStreakDays(session.streakDays ?? 0);
      setYtUsedSeconds(
        session.ytUsedSeconds ?? (session.ytUsedMinutes ?? 0) * 60,
      );
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
        void syncLocalDataToCloudIfOnline();
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
        if (FocusLock?.saveAllowedApps) {
          await FocusLock.saveAllowedApps(parsedApps);
        }
      }

      if (savedDomains) {
        const parsedDomains: string[] = JSON.parse(savedDomains)
          .filter(
            (d: string) =>
              !d.toLowerCase().includes("youtube.") &&
              !d.toLowerCase().includes("youtu.be"),
          )
          .slice(0, MAX_ALLOWED_DOMAINS);
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

    if (!ovl || !acc) {
      setSettingsModalVisible(true);
      Alert.alert(
        "সিস্টেম পারমিশন প্রয়োজন ⚙️",
        "লক চালু করার আগে Settings থেকে 'Display Over Other Apps' এবং 'Accessibility Service' অন করুন।",
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

  const formatYtLiveUsage = (usedSecs: number, limitMins: number) => {
    const m = Math.floor(usedSecs / 60);
    const s = usedSecs % 60;
    return `${m}m ${String(s).padStart(2, "0")}s / ${limitMins}m`;
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

  // 🌟 Anti-Cheat Emergency Unlock: Requires Online Cloud Sync so user cannot spend pass offline & Clear Data!
  const handleEmergencyUnlockConfirm = async () => {
    if (!FocusLock?.useEmergencyPass) return;
    if (emergencyPasses <= 0) {
      Alert.alert(
        "কোনো Emergency Pass নেই 🔒",
        "আপনার কাছে এখন ০টি পাস আছে। টানা ৩ দিন (কমপক্ষে ৩০ মিনিট করে) নিয়ম মেনে লক পূর্ণ করলে ১টি Emergency Pass পাবেন!",
      );
      setEmergencyModalVisible(false);
      return;
    }

    setSpendingPass(true);
    try {
      const canSpendOnline = await spendEmergencyPassWithCloudCheck();
      if (!canSpendOnline) {
        Alert.alert(
          "ইন্টারনেট সংযোগ প্রয়োজন 🌐",
          "Emergency Pass ব্যবহার করে লক আনলক করার জন্য ফোনের ইন্টারনেট (Wi-Fi বা Mobile Data) চালু করুন।",
        );
        return;
      }

      const success = await FocusLock.useEmergencyPass();
      setEmergencyModalVisible(false);
      if (success) {
        Vibration.vibrate(200);
        await refreshFocusSession();
        await syncLocalDataToCloudIfOnline();
        await addInAppNotice({
          id: `pass-used-${Date.now()}`,
          title: "🎟️ ১টি Emergency Pass ব্যবহৃত হয়েছে",
          message: `আপনি জরুরি প্রয়োজনে লক আনলক করেছেন। আপনার ১টি পাস কেটে ক্লাউডে আপডেট করা হয়েছে এবং ৩ দিনের স্ট্রিক কাউন্টার রিসেট হয়েছে।`,
          timestamp: Date.now(),
          read: false,
          type: "lock",
        });
      }
    } catch {
      Alert.alert("Error", "Emergency Pass ব্যবহার করা যায়নি।");
    } finally {
      setSpendingPass(false);
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

  // 🌟 Enforces Max 5 Sites & Strictly Forbids YouTube in Chrome!
  const addDomain = async () => {
    const clean = newDomainInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");

    if (!clean) {
      setNewDomainInput("");
      return;
    }

    if (clean.includes("youtube.") || clean.includes("youtu.be")) {
      Alert.alert(
        "YouTube যোগ করা যাবে না 🚫",
        "Chrome-এ YouTube ওয়েবসাইট যোগ করা নিষিদ্ধ! লং ভিডিও দেখতে চাইলে অ্যাপ লিস্ট থেকে সরাসরি YouTube অ্যাপ সিলেক্ট করুন।",
      );
      setNewDomainInput("");
      return;
    }

    if (allowedDomains.length >= MAX_ALLOWED_DOMAINS) {
      Alert.alert(
        "সর্বোচ্চ ৫টি ওয়েবসাইট লিমিট ✋",
        "ফোকাস ধরে রাখতে Chrome-এ সর্বোচ্চ ৫টি জরুরি ওয়েবসাইট যোগ করা যাবে। নতুন সাইট যোগ করতে আগের কোনোটি মুছে ফেলুন।",
      );
      return;
    }

    if (allowedDomains.includes(clean)) {
      setNewDomainInput("");
      return;
    }

    const updated = [...allowedDomains, clean].slice(0, MAX_ALLOWED_DOMAINS);
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

  const allowedAppObjects = installedApps.filter((app) =>
    selectedApps.includes(app.packageName),
  );

  const isChromeWhitelisted = selectedApps.some(
    (pkg) =>
      pkg === "com.android.chrome" ||
      pkg === "com.brave.browser" ||
      pkg === "com.sec.android.app.sbrowser",
  );

  // =========================================================================
  // 1. ACTIVE LOCK SCREEN DASHBOARD (With Direct Chrome Website Links & Live YT Seconds!)
  // =========================================================================
  if (isFocusActive) {
    return (
      <SafeAreaView
        className="flex-1 bg-[#070B14]"
        edges={["top", "bottom", "left", "right"]}
      >
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "space-between",
            paddingHorizontal: 18,
            paddingTop: 12,
            paddingBottom: Math.max(24, insets.bottom + 16),
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Pass & Mode Pill */}
          <View className="flex-row items-center justify-between gap-2">
            <View className="bg-slate-800/90 border border-slate-700 px-3 py-1.5 rounded-full flex-row items-center flex-shrink">
              <Ionicons
                name={
                  lockMode === "SCHEDULE"
                    ? "calendar"
                    : isBreakActive
                      ? "cafe"
                      : "shield-checkmark"
                }
                size={14}
                color={isBreakActive ? "#34D399" : "#F43F5E"}
              />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                className="text-slate-200 font-bold text-[11px] ml-1.5"
              >
                {lockMode === "SCHEDULE"
                  ? "Schedule Lock"
                  : pomodoroEnabled
                    ? "Session (25m / 5m)"
                    : "Session Lock"}
              </Text>
            </View>

            <View className="bg-amber-500/15 border border-amber-500/30 px-3 py-1.5 rounded-full flex-row items-center">
              <Ionicons name="ticket" size={14} color="#FBBF24" />
              <Text
                allowFontScaling={false}
                className="text-amber-300 font-bold text-[11px] ml-1.5"
              >
                Pass: {emergencyPasses}/5 • Streak: {streakDays}/3
              </Text>
            </View>
          </View>

          {/* Center Lock / Break Status */}
          <View className="items-center my-3">
            <View
              className={`w-18 h-18 p-4 rounded-full items-center justify-center border-2 ${
                isBreakActive
                  ? "bg-emerald-500/15 border-emerald-400"
                  : "bg-rose-500/15 border-rose-500"
              }`}
            >
              <Ionicons
                name={isBreakActive ? "cafe" : "lock-closed"}
                size={36}
                color={isBreakActive ? "#34D399" : "#F43F5E"}
              />
            </View>

            <Text
              allowFontScaling={false}
              className="text-white text-xl font-black mt-3 text-center px-2"
            >
              {isBreakActive
                ? "৫ মিনিটের ফ্রি ব্রেক চলছে! ☕"
                : "Strict Focus Lock Active 🔒"}
            </Text>

            <Text
              allowFontScaling={false}
              className={`text-4xl font-black mt-3 tracking-widest ${
                isBreakActive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {lockMode === "SESSION" && pomodoroEnabled
                ? formatCountdown(cycleRemainingMillis)
                : formatCountdown(remainingMillis)}
            </Text>

            {lockMode === "SESSION" && pomodoroEnabled && (
              <View className="bg-slate-800/80 px-3.5 py-1.5 rounded-full mt-2 border border-slate-700">
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-slate-300 text-[11px] font-bold text-center"
                >
                  {isBreakActive ? "লক শুরু হতে বাকি • " : "ব্রেক পেতে বাকি • "}
                  মোট বাকি: {formatCountdown(remainingMillis)}
                </Text>
              </View>
            )}
          </View>

          {/* Middle Section: Live YouTube Seconds Counter + Allowed Apps + Direct Chrome Links */}
          <View>
            {/* Live YouTube Usage Counter (Updates every second!) */}
            <View className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 mb-2.5 flex-row items-center justify-between">
              <View className="flex-row items-center flex-1 pr-2">
                <Ionicons name="logo-youtube" size={16} color="#EF4444" />
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-slate-300 text-xs font-bold ml-2 flex-1"
                >
                  YouTube Long Video (Shorts & PiP Off)
                </Text>
              </View>
              <Text
                allowFontScaling={false}
                className="text-indigo-400 text-xs font-black"
              >
                {formatYtLiveUsage(ytUsedSeconds, ytLimitMinutes)}
              </Text>
            </View>

            {/* Allowed Apps Grid */}
            <View className="bg-slate-900/90 border border-slate-800 rounded-3xl p-3.5">
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-[11px] font-bold uppercase tracking-wider text-center mb-3"
              >
                অনুমোদিত অ্যাপ ({allowedAppObjects.length}/{MAX_SELECTED_APPS})
              </Text>

              {allowedAppObjects.length === 0 ? (
                <Text
                  allowFontScaling={false}
                  className="text-slate-500 text-xs text-center py-2"
                >
                  কোনো অ্যাপ সিলেক্ট করা হয়নি।
                </Text>
              ) : (
                <View className="flex-row flex-wrap justify-between">
                  {allowedAppObjects.map((app) => (
                    <Pressable
                      key={app.packageName}
                      onPress={() => void FocusLock?.openApp(app.packageName)}
                      className="items-center w-[31%] mb-2.5 bg-slate-800/80 p-2.5 rounded-2xl border border-slate-700/60 active:bg-slate-700"
                    >
                      {app.icon ? (
                        <Image
                          source={{ uri: `data:image/png;base64,${app.icon}` }}
                          style={{ width: 36, height: 36, borderRadius: 9 }}
                        />
                      ) : (
                        <Ionicons
                          name="apps"
                          size={36}
                          color={getAppColor(app.appName)}
                        />
                      )}
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-white text-[10px] font-bold mt-1.5 text-center w-full"
                      >
                        {app.appName}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* 🌟 Direct Chrome Whitelisted Website Buttons (Shown when Chrome is whitelisted!) */}
            {isChromeWhitelisted && allowedDomains.length > 0 && (
              <View className="bg-slate-900/90 border border-sky-500/30 rounded-3xl p-3.5 mt-2.5">
                <View className="flex-row items-center justify-center mb-2.5">
                  <Ionicons name="globe-outline" size={14} color="#38BDF8" />
                  <Text
                    allowFontScaling={false}
                    className="text-sky-300 text-[11px] font-bold ml-1.5"
                  >
                    Chrome অনুমোদিত সাইট (ট্যাপ করলে সরাসরি ওপেন হবে)
                  </Text>
                </View>
                <View className="flex-row flex-wrap justify-center gap-2">
                  {allowedDomains.slice(0, MAX_ALLOWED_DOMAINS).map((dom) => (
                    <Pressable
                      key={dom}
                      onPress={() => {
                        if (FocusLock?.openUrlInChrome) {
                          void FocusLock.openUrlInChrome(dom);
                        } else {
                          void FocusLock?.openApp("com.android.chrome");
                        }
                      }}
                      className="bg-sky-500/15 border border-sky-500/40 px-3 py-2 rounded-xl flex-row items-center active:bg-sky-500/30"
                    >
                      <Ionicons name="open-outline" size={13} color="#38BDF8" />
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-white font-bold text-xs ml-1.5"
                      >
                        {dom}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Bottom Emergency Pass Button */}
          <Pressable
            onPress={() => setEmergencyModalVisible(true)}
            className={`mt-3 py-3.5 px-4 rounded-2xl border flex-row items-center justify-center ${
              emergencyPasses > 0
                ? "bg-amber-500/15 border-amber-500/40 active:bg-amber-500/25"
                : "bg-slate-900 border-slate-800"
            }`}
          >
            <Ionicons
              name={emergencyPasses > 0 ? "ticket-outline" : "lock-closed"}
              size={18}
              color={emergencyPasses > 0 ? "#FBBF24" : "#64748B"}
            />
            <Text
              allowFontScaling={false}
              className={`font-bold text-xs ml-2 flex-1 text-center ${
                emergencyPasses > 0 ? "text-amber-300" : "text-slate-400"
              }`}
            >
              {emergencyPasses > 0
                ? `Emergency Unlock (১টি পাস কাটবে • জমা: ${emergencyPasses}/5)`
                : `Emergency Unlock লকড (পাস: 0/5 • ৩ দিন লক পূর্ণ করে পাস পান)`}
            </Text>
          </Pressable>
        </ScrollView>

        {/* Emergency Unlock Confirmation Modal */}
        <Modal
          visible={emergencyModalVisible}
          transparent
          animationType="fade"
        >
          <View className="flex-1 bg-black/80 justify-center items-center px-5">
            <View className="bg-slate-900 w-full rounded-3xl p-5 border border-slate-700 items-center">
              <View className="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-500/40 items-center justify-center mb-3">
                <Ionicons name="warning" size={28} color="#FBBF24" />
              </View>
              <Text
                allowFontScaling={false}
                className="text-white font-black text-lg text-center mb-2"
              >
                {emergencyPasses > 0
                  ? "১টি Emergency Pass খরচ করবেন?"
                  : "কোনো Emergency Pass জমা নেই!"}
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-xs text-center leading-5 mb-5"
              >
                {emergencyPasses > 0
                  ? `এখন লক ভাঙলে আপনার জমানো ${emergencyPasses}টি পাস থেকে ১টি পাস কেটে ক্লাউডে আপডেট করা হবে (বাকি থাকবে ${emergencyPasses - 1}টি) এবং ৩ দিনের স্ট্রিক ০ হয়ে যাবে!`
                  : `আপনার পাস সংখ্যা এখন 0। টানা ৩ দিন (কমপক্ষে ৩০ মিনিট করে) নিয়ম মেনে লক পূর্ণ করলে ১টি করে পাস পাবেন (সর্বোচ্চ ৫টি)।`}
              </Text>

              <View className="flex-row gap-3 w-full">
                <Pressable
                  onPress={() => setEmergencyModalVisible(false)}
                  disabled={spendingPass}
                  className="flex-1 bg-slate-800 py-3.5 rounded-2xl items-center"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-xs"
                  >
                    ফিরে যান
                  </Text>
                </Pressable>
                {emergencyPasses > 0 && (
                  <Pressable
                    onPress={() => void handleEmergencyUnlockConfirm()}
                    disabled={spendingPass}
                    className="flex-1 bg-rose-600 py-3.5 rounded-2xl items-center justify-center"
                  >
                    {spendingPass ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text
                        allowFontScaling={false}
                        className="text-white font-bold text-xs"
                      >
                        হ্যাঁ, ১টি পাস কাটুন
                      </Text>
                    )}
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
  // 2. NEW CLEAN UNLOCK SCREEN (Top-to-Middle Hero Image + Curved Bottom Sheet)
  // =========================================================================
  const allPermsReady =
    permState.accessibility && permState.overlay && permState.deviceAdmin;
  const activeSchedulesCount = schedules.filter((s) => s.isEnabled).length;

  return (
    <View className="flex-1 bg-[#0F172A]">
      <StatusBar style="light" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: Math.max(36, insets.bottom + 20),
        }}
      >
        {/* 🌟 TOP-TO-MIDDLE: HERO BACKGROUND IMAGE + DARK OVERLAY */}
        <ImageBackground
          source={{ uri: HERO_BG_URI }}
          className="w-full"
          resizeMode="cover"
        >
          <View
            style={{ paddingTop: Math.max(16, insets.top + 8) }}
            className="bg-[#070B14]/75 px-5 pb-12"
          >
            {/* TOP BAR: Left = Pass & Streak Badge | Right = Settings Gear */}
            <View className="flex-row items-center justify-between mb-6">
              <Pressable
                onPress={() => setPassInfoModalVisible(true)}
                className="bg-slate-900/85 border border-amber-500/40 px-3.5 py-2 rounded-2xl flex-row items-center"
              >
                <Ionicons name="ticket" size={16} color="#FBBF24" />
                <Text
                  allowFontScaling={false}
                  className="text-amber-300 font-black text-xs ml-1.5"
                >
                  Pass: {emergencyPasses}/5
                </Text>
                <View className="w-[1px] h-3.5 bg-slate-700 mx-2.5" />
                <Ionicons name="flame" size={15} color="#34D399" />
                <Text
                  allowFontScaling={false}
                  className="text-emerald-300 font-black text-xs ml-1"
                >
                  {streakDays}/3d
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setSettingsModalVisible(true)}
                className="h-11 w-11 rounded-2xl bg-slate-900/85 border border-slate-700 items-center justify-center relative"
              >
                <Ionicons name="settings-outline" size={22} color="#E2E8F0" />
                {!allPermsReady && (
                  <View className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-rose-500 border border-slate-900" />
                )}
              </Pressable>
            </View>

            {/* HERO CENTER: Duration Input + Preset Chips + Glowing HOLD Button */}
            <View className="items-center">
              <Text
                allowFontScaling={false}
                className="text-indigo-300 font-bold text-xs uppercase tracking-widest mb-2"
              >
                Deep Focus Session
              </Text>

              <View className="flex-row items-baseline justify-center mb-3">
                <TextInput
                  allowFontScaling={false}
                  value={customDuration}
                  onChangeText={(text) =>
                    setCustomDuration(text.replace(/[^0-9]/g, ""))
                  }
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="60"
                  placeholderTextColor="#64748B"
                  className="text-white text-5xl font-black bg-slate-900/80 border border-slate-700/80 rounded-3xl w-36 text-center py-2"
                />
                <Text
                  allowFontScaling={false}
                  className="text-slate-300 font-black text-sm ml-2.5 tracking-widest"
                >
                  MINS
                </Text>
              </View>

              {/* Preset Duration Pills */}
              <View className="flex-row justify-center gap-2 mb-6">
                {[
                  { label: "30m", val: "30" },
                  { label: "1h", val: "60" },
                  { label: "2h", val: "120" },
                  { label: "4h", val: "240" },
                ].map((preset) => (
                  <Pressable
                    key={preset.val}
                    onPress={() => setCustomDuration(preset.val)}
                    className={`px-4 py-1.5 rounded-full border ${
                      customDuration === preset.val
                        ? "bg-indigo-600 border-indigo-400"
                        : "bg-slate-900/75 border-slate-700"
                    }`}
                  >
                    <Text
                      allowFontScaling={false}
                      className={`text-xs font-bold ${
                        customDuration === preset.val
                          ? "text-white"
                          : "text-slate-300"
                      }`}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* HOLD 1.5s TO LOCK BUTTON */}
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
                  className="items-center justify-center h-28 w-28 rounded-full border-[3px] border-indigo-400/60 bg-slate-900/90 overflow-hidden shadow-xl"
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
                    size={34}
                    color="white"
                    style={{ zIndex: 10 }}
                  />
                  <Text
                    allowFontScaling={false}
                    className="text-white font-black text-[10px] tracking-widest mt-1 z-10"
                  >
                    HOLD 1.5s
                  </Text>
                </Pressable>
              </Animated.View>

              <Text
                allowFontScaling={false}
                className="text-slate-300/80 text-[11px] font-medium mt-2.5"
              >
                ১.৫ সেকেন্ড চেপে ধরে ফোকাস লক চালু করুন
              </Text>
            </View>
          </View>
        </ImageBackground>

        {/* 🌟 MIDDLE-TO-BOTTOM: CLEAN CURVED SHEET */}
        <View className="bg-[#0F172A] rounded-t-[32px] -mt-6 px-5 pt-6">
          {/* Permission Warning Banner (only if permissions aren't ready) */}
          {!allPermsReady && (
            <Pressable
              onPress={() => setSettingsModalVisible(true)}
              className="bg-rose-500/15 border border-rose-500/40 p-3.5 rounded-2xl mb-4 flex-row items-center justify-between"
            >
              <View className="flex-row items-center flex-1 pr-2">
                <Ionicons name="alert-circle" size={20} color="#F43F5E" />
                <Text
                  allowFontScaling={false}
                  className="text-rose-200 font-bold text-xs ml-2 flex-1"
                >
                  কড়া লকের জন্য ৩টি সিস্টেম পারমিশন অন করুন
                </Text>
              </View>
              <Text
                allowFontScaling={false}
                className="text-rose-400 font-black text-xs"
              >
                Setup →
              </Text>
            </Pressable>
          )}

          {/* CARD 1: 25m Focus + 5m Break Cycle Bar */}
          <View className="bg-slate-800/90 p-4 rounded-3xl border border-slate-700/80 flex-row items-center justify-between mb-4">
            <View className="flex-row items-center flex-1 pr-3">
              <View className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 items-center justify-center mr-3">
                <Ionicons name="cafe" size={20} color="#34D399" />
              </View>
              <View className="flex-1">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  25m Lock + 5m Break Cycle
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-[11px] mt-0.5"
                >
                  প্রতি ২৫ মিনিট কড়া লকের পর ৫ মিনিট অটো ফ্রি ব্রেক
                </Text>
              </View>
            </View>
            <Switch
              value={pomodoroEnabled}
              onValueChange={setPomodoroEnabled}
              trackColor={{ false: "#334155", true: "#10B981" }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* CARD 2: Allowed Apps & Active Rules At a Glance */}
          <View className="bg-slate-800/90 p-4 rounded-3xl border border-slate-700/80 mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center">
                <Ionicons name="apps" size={16} color="#818CF8" />
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-xs ml-2"
                >
                  অনুমোদিত অ্যাপ ও রুলস ({selectedApps.length}/{MAX_SELECTED_APPS})
                </Text>
              </View>
              <Pressable
                onPress={() => setAppModalVisible(true)}
                className="bg-indigo-500/15 border border-indigo-500/30 px-3 py-1 rounded-full"
              >
                <Text
                  allowFontScaling={false}
                  className="text-indigo-300 font-bold text-[11px]"
                >
                  + অ্যাপ বাছাই
                </Text>
              </Pressable>
            </View>

            {/* Horizontal Row of Selected App Icons */}
            {allowedAppObjects.length === 0 ? (
              <Pressable
                onPress={() => setAppModalVisible(true)}
                className="bg-slate-900/70 py-3 rounded-2xl items-center border border-slate-700/60 mb-3"
              >
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-xs"
                >
                  সর্বোচ্চ ৬টি অ্যাপ সিলেক্ট করতে এখানে ট্যাপ করুন
                </Text>
              </Pressable>
            ) : (
              <View className="flex-row items-center flex-wrap gap-2.5 mb-3">
                {allowedAppObjects.map((app) => (
                  <View
                    key={app.packageName}
                    className="bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-700 flex-row items-center"
                  >
                    {app.icon ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${app.icon}` }}
                        style={{ width: 18, height: 18, borderRadius: 4 }}
                      />
                    ) : (
                      <Ionicons
                        name="apps"
                        size={16}
                        color={getAppColor(app.appName)}
                      />
                    )}
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-slate-200 font-bold text-[11px] ml-1.5 max-w-[80px]"
                    >
                      {app.appName}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Quick Summary Pills for YT & Chrome */}
            <View className="flex-row gap-2 pt-2 border-t border-slate-700/60">
              <Pressable
                onPress={() => setSettingsModalVisible(true)}
                className="flex-1 bg-slate-900/80 py-2 px-3 rounded-xl flex-row items-center justify-between border border-slate-700/60"
              >
                <View className="flex-row items-center">
                  <Ionicons name="logo-youtube" size={14} color="#EF4444" />
                  <Text
                    allowFontScaling={false}
                    className="text-slate-300 font-bold text-[11px] ml-1.5"
                  >
                    YT Limit: {ytLimitMinutes}m
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={13} color="#64748B" />
              </Pressable>

              <Pressable
                onPress={() => setSettingsModalVisible(true)}
                className="flex-1 bg-slate-900/80 py-2 px-3 rounded-xl flex-row items-center justify-between border border-slate-700/60"
              >
                <View className="flex-row items-center">
                  <Ionicons name="globe-outline" size={14} color="#38BDF8" />
                  <Text
                    allowFontScaling={false}
                    className="text-slate-300 font-bold text-[11px] ml-1.5"
                  >
                    Chrome: {allowedDomains.length}/{MAX_ALLOWED_DOMAINS} Sites
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={13} color="#64748B" />
              </Pressable>
            </View>
          </View>

          {/* CARD 3: Compact Daily Schedule Lock Card */}
          <View className="bg-slate-800/90 p-4 rounded-3xl border border-slate-700/80">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 items-center justify-center mr-2.5">
                  <Ionicons name="alarm-outline" size={18} color="#818CF8" />
                </View>
                <View className="flex-1">
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-sm"
                  >
                    Daily Schedule Lock ({activeSchedulesCount} Active)
                  </Text>
                  <Text
                    allowFontScaling={false}
                    className="text-slate-400 text-[11px]"
                  >
                    প্রতিদিন নির্দিষ্ট সময়ে অটোমেটিক একটানা লক
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => setScheduleModalVisible(true)}
                className="bg-indigo-600 px-3.5 py-2 rounded-xl"
              >
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-xs"
                >
                  Manage
                </Text>
              </Pressable>
            </View>

            {schedules.slice(0, 2).map((sched, i) => (
              <View
                key={sched.id}
                className="bg-slate-900/80 px-3.5 py-2.5 rounded-2xl border border-slate-700/60 flex-row items-center justify-between mb-2 last:mb-0"
              >
                <Pressable
                  onPress={() => setScheduleModalVisible(true)}
                  className="flex-1 pr-2"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-white font-black text-xs"
                  >
                    ⏰ {formatTime(sched.startTime)} →{" "}
                    {formatTime(sched.endTime)}
                  </Text>
                  <Text
                    allowFontScaling={false}
                    className="text-slate-400 text-[10px] mt-0.5"
                  >
                    Schedule {i + 1} • {sched.activeDays.length} days/week
                  </Text>
                </Pressable>
                <Switch
                  value={sched.isEnabled}
                  onValueChange={async (val) => {
                    const updated = schedules.map((s) =>
                      s.id === sched.id ? { ...s, isEnabled: val } : s,
                    );
                    setSchedules(updated);
                    await saveAllSchedules(updated, false);
                  }}
                  trackColor={{ false: "#334155", true: "#818CF8" }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* ===================================================================== */}
      {/* MODAL 1: TOP-LEFT PASS & STREAK INFO MODAL                            */}
      {/* ===================================================================== */}
      <Modal visible={passInfoModalVisible} transparent animationType="fade">
        <View className="flex-1 bg-black/80 justify-center items-center px-5">
          <View className="bg-slate-900 w-full rounded-3xl p-5 border border-slate-700">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center">
                <Ionicons name="ticket" size={22} color="#FBBF24" />
                <Text
                  allowFontScaling={false}
                  className="text-white font-black text-lg ml-2"
                >
                  Emergency Pass & Streak
                </Text>
              </View>
              <Pressable
                onPress={() => setPassInfoModalVisible(false)}
                className="h-8 w-8 bg-slate-800 rounded-full items-center justify-center"
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
              </Pressable>
            </View>

            <View className="bg-slate-800 p-4 rounded-2xl border border-slate-700 mb-3">
              <View className="flex-row justify-between items-center mb-2">
                <Text
                  allowFontScaling={false}
                  className="text-slate-300 font-bold text-xs"
                >
                  🎟️ বর্তমান জমানো পাস
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-amber-400 font-black text-base"
                >
                  {emergencyPasses} / 5 Pass
                </Text>
              </View>
              <View className="flex-row gap-1.5">
                {[1, 2, 3, 4, 5].map((slot) => (
                  <View
                    key={slot}
                    className={`flex-1 h-2.5 rounded-full ${
                      emergencyPasses >= slot ? "bg-amber-400" : "bg-slate-700"
                    }`}
                  />
                ))}
              </View>
            </View>

            <View className="bg-slate-800 p-4 rounded-2xl border border-slate-700 mb-4">
              <View className="flex-row justify-between items-center mb-2">
                <Text
                  allowFontScaling={false}
                  className="text-slate-300 font-bold text-xs"
                >
                  🔥 পরবর্তী পাসের স্ট্রিক অগ্রগতি
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-emerald-400 font-black text-base"
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

            <Text
              allowFontScaling={false}
              className="text-slate-400 text-xs leading-5 mb-4"
            >
              • প্রতিদিন কমপক্ষে ৩০ মিনিটের লক সফলভাবে পূর্ণ করলে ১ স্ট্রিক যোগ
              হয় (দিনে সর্বোচ্চ ১টি)।{"\n"}• টানা ৩ দিন পূর্ণ করলে পুরস্কার
              হিসেবে +1 Emergency Pass পাবেন (সর্বোচ্চ ৫টি)।{"\n"}• জরুরি
              প্রয়োজনে পাস ব্যবহার করে লক ভাঙলে ১টি পাস কাটা যাবে।
            </Text>

            <Pressable
              onPress={() => setPassInfoModalVisible(false)}
              className="bg-indigo-600 py-3 rounded-2xl items-center"
            >
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-xs"
              >
                বুঝেছি
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 2: TOP-RIGHT ⚙️ SETTINGS MODAL (Permissions, YT Quota, Chrome)  */}
      {/* ===================================================================== */}
      <Modal
        visible={settingsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 bg-black/80 justify-end"
        >
          <View
            style={{ paddingBottom: Math.max(20, insets.bottom + 12) }}
            className="bg-slate-900 w-full rounded-t-[32px] px-5 pt-5 border-t border-slate-700 max-h-[90%]"
          >
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center">
                <Ionicons name="settings" size={20} color="#818CF8" />
                <Text
                  allowFontScaling={false}
                  className="text-white font-black text-lg ml-2"
                >
                  Focus Lock Settings
                </Text>
              </View>
              <Pressable
                onPress={() => setSettingsModalVisible(false)}
                className="h-9 w-9 bg-slate-800 rounded-full items-center justify-center"
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* 1. System Permissions */}
              <Text
                allowFontScaling={false}
                className="text-slate-400 font-bold text-xs uppercase mb-2"
              >
                ১. সিস্টেম পারমিশন (3 Required)
              </Text>
              <View className="bg-slate-800 p-3.5 rounded-2xl border border-slate-700 mb-4 gap-y-2">
                <Pressable
                  onPress={() => void FocusLock?.openOverlaySettings?.()}
                  className="flex-row items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700"
                >
                  <View className="flex-row items-center flex-1 pr-2">
                    <Ionicons
                      name={
                        permState.overlay
                          ? "checkmark-circle"
                          : "layers-outline"
                      }
                      size={18}
                      color={permState.overlay ? "#34D399" : "#F87171"}
                    />
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-xs ml-2 flex-1"
                    >
                      Display Over Other Apps (0ms Pull-Back)
                    </Text>
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
                  className="flex-row items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700"
                >
                  <View className="flex-row items-center flex-1 pr-2">
                    <Ionicons
                      name={
                        permState.accessibility
                          ? "checkmark-circle"
                          : "eye-outline"
                      }
                      size={18}
                      color={permState.accessibility ? "#34D399" : "#F87171"}
                    />
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-xs ml-2 flex-1"
                    >
                      Accessibility Service (Shorts & PiP Blocker)
                    </Text>
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
                  className="flex-row items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700"
                >
                  <View className="flex-row items-center flex-1 pr-2">
                    <Ionicons
                      name={
                        permState.deviceAdmin
                          ? "checkmark-circle"
                          : "shield-outline"
                      }
                      size={18}
                      color={permState.deviceAdmin ? "#34D399" : "#FBBF24"}
                    />
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-xs ml-2 flex-1"
                    >
                      Device Administrator (Uninstall Lock)
                    </Text>
                  </View>
                  <Text
                    allowFontScaling={false}
                    className={`text-xs font-bold ${permState.deviceAdmin ? "text-emerald-400" : "text-indigo-400"}`}
                  >
                    {permState.deviceAdmin ? "Ready ✅" : "Activate →"}
                  </Text>
                </Pressable>
              </View>

              {/* 2. YouTube Long Video Daily Quota */}
              <Text
                allowFontScaling={false}
                className="text-slate-400 font-bold text-xs uppercase mb-2"
              >
                ২. YouTube লং ভিডিও লিমিট (Shorts ও PiP অটো ব্লক)
              </Text>
              <View className="bg-slate-800 p-3.5 rounded-2xl border border-slate-700 mb-4">
                <View className="flex-row gap-2">
                  {[
                    { label: "60m (1h)", val: 60 },
                    { label: "90m (1.5h)", val: 90 },
                    { label: "120m (2h)", val: 120 },
                  ].map((opt) => (
                    <Pressable
                      key={opt.val}
                      onPress={() => void updateYtQuota(opt.val)}
                      className={`flex-1 py-2.5 px-1 rounded-xl items-center justify-center border ${
                        ytLimitMinutes === opt.val
                          ? "bg-rose-500/20 border-rose-500"
                          : "bg-slate-900 border-slate-700"
                      }`}
                    >
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
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

              {/* 3. Chrome Allowed Websites (Max 5 Sites, No YouTube) */}
              <Text
                allowFontScaling={false}
                className="text-slate-400 font-bold text-xs uppercase mb-2"
              >
                ৩. Chrome অনুমোদিত ওয়েবসাইট ({allowedDomains.length}/
                {MAX_ALLOWED_DOMAINS} Max • YouTube নিষিদ্ধ)
              </Text>
              <View className="bg-slate-800 p-3.5 rounded-2xl border border-slate-700 mb-4">
                <View className="flex-row gap-2 mb-3">
                  <TextInput
                    placeholder="যেমন: github.com বা chatgpt.com"
                    placeholderTextColor="#64748B"
                    value={newDomainInput}
                    onChangeText={setNewDomainInput}
                    autoCapitalize="none"
                    className="flex-1 bg-slate-900 text-white px-3.5 py-2.5 rounded-xl border border-slate-700 text-xs"
                  />
                  <Pressable
                    onPress={() => void addDomain()}
                    className="bg-indigo-600 px-4 rounded-xl items-center justify-center"
                  >
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-xs"
                    >
                      Add
                    </Text>
                  </Pressable>
                </View>

                {allowedDomains.map((dom) => (
                  <View
                    key={dom}
                    className="flex-row items-center justify-between bg-slate-900 px-3.5 py-2.5 rounded-xl mb-1.5 border border-slate-700/70"
                  >
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-white font-medium text-xs flex-1 pr-2"
                    >
                      🌐 {dom}
                    </Text>
                    <Pressable onPress={() => void removeDomain(dom)}>
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color="#F43F5E"
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 3: DAILY SCHEDULE LOCK MANAGER MODAL                            */}
      {/* ===================================================================== */}
      <Modal
        visible={scheduleModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setScheduleModalVisible(false)}
      >
        <View className="flex-1 bg-black/80 justify-end">
          <View
            style={{ paddingBottom: Math.max(20, insets.bottom + 12) }}
            className="bg-slate-900 w-full rounded-t-[32px] px-5 pt-5 border-t border-slate-700 max-h-[88%]"
          >
            <View className="flex-row items-center justify-between mb-4">
              <Text
                allowFontScaling={false}
                className="text-white font-black text-lg"
              >
                Daily Schedule Lock ({schedules.length}/4)
              </Text>
              <View className="flex-row items-center gap-2">
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
                    className="bg-indigo-600/20 border border-indigo-500/40 px-3 py-1.5 rounded-full"
                  >
                    <Text
                      allowFontScaling={false}
                      className="text-indigo-300 font-bold text-xs"
                    >
                      + নতুন
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setScheduleModalVisible(false)}
                  className="h-9 w-9 bg-slate-800 rounded-full items-center justify-center"
                >
                  <Ionicons name="close" size={18} color="#94A3B8" />
                </Pressable>
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="mb-3">
              {schedules.map((schedule, index) => (
                <View
                  key={schedule.id}
                  className="bg-slate-800 p-4 rounded-3xl border border-slate-700 mb-3"
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-sm"
                    >
                      Schedule {index + 1}
                    </Text>
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
                      thumbColor="#FFFFFF"
                    />
                  </View>

                  <View className="bg-slate-900/70 p-3 rounded-2xl border border-slate-700/50 mb-3 flex-row items-center justify-between">
                    <Pressable
                      onPress={() => {
                        setEditingSchedule({ id: schedule.id, type: "start" });
                        setShowPicker(true);
                      }}
                      className="items-center flex-1"
                    >
                      <Text
                        allowFontScaling={false}
                        className="text-slate-500 text-[10px] font-bold uppercase"
                      >
                        শুরু হবে
                      </Text>
                      <Text
                        allowFontScaling={false}
                        className="text-indigo-400 font-black text-base mt-0.5"
                      >
                        {formatTime(schedule.startTime)}
                      </Text>
                    </Pressable>
                    <Ionicons name="arrow-forward" size={16} color="#475569" />
                    <Pressable
                      onPress={() => {
                        setEditingSchedule({ id: schedule.id, type: "end" });
                        setShowPicker(true);
                      }}
                      className="items-center flex-1"
                    >
                      <Text
                        allowFontScaling={false}
                        className="text-slate-500 text-[10px] font-bold uppercase"
                      >
                        শেষ হবে
                      </Text>
                      <Text
                        allowFontScaling={false}
                        className="text-rose-400 font-black text-base mt-0.5"
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
                          className={`w-8 h-8 rounded-full items-center justify-center border ${
                            isActive
                              ? "bg-indigo-500 border-indigo-400"
                              : "bg-slate-900 border-slate-700"
                          }`}
                        >
                          <Text
                            allowFontScaling={false}
                            className={`font-bold text-[11px] ${isActive ? "text-white" : "text-slate-500"}`}
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
                        const updated = schedules.filter(
                          (s) => s.id !== schedule.id,
                        );
                        setSchedules(updated);
                        await saveAllSchedules(updated, true);
                      }}
                      className="mt-3 pt-2 border-t border-slate-700/50 flex-row justify-center items-center"
                    >
                      <Ionicons
                        name="trash-outline"
                        size={14}
                        color="#EF4444"
                      />
                      <Text className="text-rose-500 font-bold text-xs ml-1">
                        মুছে ফেলুন
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>

            <Pressable
              onPress={() => {
                void saveAllSchedules(schedules, false);
                setScheduleModalVisible(false);
              }}
              className="bg-indigo-600 py-3.5 rounded-2xl items-center"
            >
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-sm"
              >
                Save & Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 4: APP PICKER MODAL (MAX 6 APPS)                                */}
      {/* ===================================================================== */}
      <Modal visible={appModalVisible} transparent animationType="slide">
        <View className="flex-1 bg-black/75 justify-end">
          <View
            style={{ paddingBottom: Math.max(20, insets.bottom + 12) }}
            className="bg-slate-900 w-full rounded-t-[28px] px-5 pt-5 border-t border-slate-700 max-h-[85%]"
          >
            <View className="flex-row justify-between items-center mb-3">
              <View className="flex-1 pr-2">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-lg"
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
              className="bg-slate-800 text-white px-4 py-2.5 rounded-xl mb-3 border border-slate-700 text-sm"
            />

            {loadingApps ? (
              <View className="py-10 items-center">
                <ActivityIndicator size="large" color="#818CF8" />
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} className="mb-3">
                {filteredApps.map((app) => {
                  const isChecked = selectedApps.includes(app.packageName);
                  return (
                    <Pressable
                      key={app.packageName}
                      onPress={() => toggleAppSelection(app.packageName)}
                      className={`p-3 rounded-2xl mb-2 flex-row items-center justify-between border ${
                        isChecked
                          ? "bg-indigo-500/15 border-indigo-500/50"
                          : "bg-slate-800 border-slate-700"
                      }`}
                    >
                      <View className="flex-row items-center flex-1 pr-3">
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
                        name={
                          isChecked ? "checkmark-circle" : "ellipse-outline"
                        }
                        size={22}
                        color={isChecked ? "#818CF8" : "#64748B"}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <Pressable
              onPress={() => void confirmAndSaveAllowedApps()}
              className="bg-indigo-600 py-3.5 rounded-2xl items-center justify-center"
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
    </View>
  );
}
