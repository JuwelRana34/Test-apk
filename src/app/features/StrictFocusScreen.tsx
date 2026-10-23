import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as DocumentPicker from "expo-document-picker";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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

export interface StudyVideoItem {
  id: string;
  raw: string;
  title: string;
  url: string;
  addedDate: string;
}

interface FocusSessionState {
  active: boolean;
  startTimeMillis: number;
  endTimeMillis: number;
  lockMode: "SESSION" | "SCHEDULE";
  pomodoroEnabled: boolean;
  scheduleBreakEnabled?: boolean;
  isBreakActive: boolean;
  noMoreBreaks?: boolean;
  cycleRemainingMillis: number;
  emergencyPasses: number;
  totalPassesEarned?: number;
  totalPassesUsed?: number;
  streakDays: number;
  totalCompleted: number;
  ytUsedSeconds?: number;
  ytUsedMinutes: number;
  ytLimitMinutes: number;
  ytStudyUsedSeconds?: number;
  ytStudyLimitMinutes?: number;
  studyChannelsCsv?: string;
  studyVideosJson?: string;
  ytUsageDate?: string;
  lastCompletedDate?: string;
  completedHistoryJson?: string;
}

interface NativeFocusLock {
  applyDarkNavigationBar?: () => Promise<boolean>;
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
  setStudyYouTubeConfig?: (
    studyLimitMinutes: number,
    channels: string[],
    videosJson: string,
  ) => Promise<boolean>;
  openStudyYouTubeItem?: (urlOrQuery: string) => Promise<boolean>;
  setScheduleBreakEnabled?: (enabled: boolean) => Promise<boolean>;
  openApp: (packageName: string) => Promise<boolean>;
  openUrlInChrome?: (domainOrUrl: string) => Promise<boolean>;
  openPdfUri?: (uriString: string) => Promise<boolean>;

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
const MAX_STUDY_CHANNELS = 5;
const MAX_STUDY_VIDEOS = 5;
const MAX_SESSION_MINUTES = 360; // Max 6 Hours for Session Lock
const MAX_SCHEDULE_MINUTES = 900; // Max 15 Hours for Schedule Lock
const WARN_SCHEDULE_MINUTES = 600; // Warn when Schedule Lock > 10 Hours (or >= 12h)

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

const getScheduleDurationMinutes = (start: Date, end: Date): number => {
  const startMins = start.getHours() * 60 + start.getMinutes();
  const endMins = end.getHours() * 60 + end.getMinutes();
  let diff = endMins - startMins;
  if (diff <= 0) {
    diff += 24 * 60;
  }
  return diff;
};

const formatVideoDisplayLabel = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.includes("youtu.be/")) {
    const id = trimmed.split("youtu.be/")[1]?.split(/[?&]/)[0] || "Video";
    return `Class (${id.slice(0, 8)})`;
  }
  if (trimmed.includes("watch?v=")) {
    const id = trimmed.split("watch?v=")[1]?.split(/[?&]/)[0] || "Video";
    return `Class (${id.slice(0, 8)})`;
  }
  return trimmed.length > 26 ? `${trimmed.slice(0, 24)}...` : trimmed;
};

export default function StrictFocusScreen() {
  const insets = useSafeAreaInsets();

  const [customDuration, setCustomDuration] = useState("60");
  const [pomodoroEnabled, setPomodoroEnabled] = useState(true);
  const [scheduleBreakEnabled, setScheduleBreakEnabledState] = useState(true);

  // Dual YouTube Quota State: General YT (15m / 30m / 45m) + Study YT (90m / 150m / 210m)
  const [ytLimitMinutes, setYtLimitMinutes] = useState(30);
  const [ytStudyLimitMinutes, setYtStudyLimitMinutes] = useState(210);
  const [studyTab, setStudyTab] = useState<"channels" | "videos">("channels");
  const [studyChannels, setStudyChannels] = useState<string[]>([]);
  const [studyVideos, setStudyVideos] = useState<StudyVideoItem[]>([]);
  const [newStudyInput, setNewStudyInput] = useState("");

  const [keyboardHeight, setKeyboardHeight] = useState(0);

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
  const [scheduleSavedModal, setScheduleSavedModal] = useState<{
    visible: boolean;
    hasEnabled: boolean;
    activeCount: number;
  }>({ visible: false, hasEnabled: false, activeCount: 0 });

  // Universal Modern Custom Popup Modal (Replaces ALL default Alert.alert!)
  const [uiModal, setUiModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    color: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
  }>({
    visible: false,
    title: "",
    message: "",
    icon: "shield-alert-outline",
    color: "#818CF8",
  });

  const showModernNotice = (
    title: string,
    message: string,
    icon: keyof typeof MaterialCommunityIcons.glyphMap = "information-outline",
    color = "#818CF8",
  ) => {
    setUiModal({
      visible: true,
      title,
      message,
      icon,
      color,
    });
  };

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
  const [noMoreBreaks, setNoMoreBreaks] = useState(false);
  const [cycleRemainingMillis, setCycleRemainingMillis] = useState(0);
  const [emergencyPasses, setEmergencyPasses] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [ytUsedSeconds, setYtUsedSeconds] = useState(0);
  const [ytStudyUsedSeconds, setYtStudyUsedSeconds] = useState(0);

  const fillAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const isStartingFocusRef = useRef(false);
  const isHoldPressActiveRef = useRef(false);
  const wasActiveSessionRef = useRef(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
      const totalRem = active
        ? Math.max(0, session.endTimeMillis - Date.now())
        : 0;

      if (wasActiveSessionRef.current && !active) {
        wasActiveSessionRef.current = false;
        void syncLocalDataToCloudIfOnline();
      } else if (active) {
        wasActiveSessionRef.current = true;
      }

      setIsFocusActive(active);
      setRemainingMillis(totalRem);
      setLockMode(session.lockMode || "SESSION");
      if (typeof session.scheduleBreakEnabled === "boolean") {
        setScheduleBreakEnabledState(session.scheduleBreakEnabled);
      }
      setIsBreakActive(!!session.isBreakActive);
      setNoMoreBreaks(!!session.noMoreBreaks);
      setCycleRemainingMillis(
        Math.min(totalRem, Math.max(0, session.cycleRemainingMillis || 0)),
      );
      setEmergencyPasses(session.emergencyPasses ?? 0);
      setStreakDays(session.streakDays ?? 0);
      setYtUsedSeconds(
        session.ytUsedSeconds ?? (session.ytUsedMinutes ?? 0) * 60,
      );
      setYtStudyUsedSeconds(session.ytStudyUsedSeconds ?? 0);
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
    void (async () => {
      await loadSettings();
      await syncLocalDataToCloudIfOnline();
      await loadSettings();
    })();
    setTimeout(() => {
      void fetchInstalledApps();
    }, 150);

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void checkAllPermissions();
        void refreshFocusSession();
        void (async () => {
          await syncLocalDataToCloudIfOnline();
          await loadSettings();
        })();
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

  const syncStudyConfigToNative = async (
    sLimit: number,
    channels: string[],
    videos: StudyVideoItem[],
  ) => {
    if (Platform.OS === "android" && FocusLock?.setStudyYouTubeConfig) {
      try {
        await FocusLock.setStudyYouTubeConfig(
          sLimit,
          channels,
          JSON.stringify(videos),
        );
      } catch {}
    }
  };

  const loadSettings = async () => {
    try {
      const todayIso = new Date().toISOString().split("T")[0];
      const [
        savedApps,
        savedDomains,
        savedSchedules,
        savedYtLimit,
        savedSchedBreak,
        savedStudyLimit,
        savedStudyChannels,
        savedStudyVideos,
      ] = await Promise.all([
        AsyncStorage.getItem("@focus_allowed_apps"),
        AsyncStorage.getItem("@focus_allowed_domains"),
        AsyncStorage.getItem("@focus_multi_schedules"),
        AsyncStorage.getItem("@focus_yt_limit_minutes"),
        AsyncStorage.getItem("@focus_schedule_break_enabled"),
        AsyncStorage.getItem("@focus_yt_study_limit_minutes"),
        AsyncStorage.getItem("@focus_yt_study_channels"),
        AsyncStorage.getItem("@focus_yt_study_videos"),
      ]);

      let parsedApps: string[] = [];
      if (savedApps) {
        parsedApps = JSON.parse(savedApps).slice(0, MAX_SELECTED_APPS);
        setSelectedApps(parsedApps);
        if (FocusLock?.saveAllowedApps) {
          await FocusLock.saveAllowedApps(parsedApps);
        }
      } else {
        setSelectedApps([]);
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
      } else {
        setAllowedDomains(DEFAULT_ALLOWED_DOMAINS);
        if (FocusLock?.saveAllowedDomains) {
          await FocusLock.saveAllowedDomains(DEFAULT_ALLOWED_DOMAINS);
        }
      }

      let currentYtLimit = 30;
      if (savedYtLimit) {
        const rawLim = parseInt(savedYtLimit, 10) || 30;
        currentYtLimit = [15, 30, 45].includes(rawLim) ? rawLim : 30;
      }
      setYtLimitMinutes(currentYtLimit);
      if (FocusLock?.setYouTubeLimitMinutes) {
        await FocusLock.setYouTubeLimitMinutes(currentYtLimit);
      }

      let currentStudyLimit = 210;
      if (savedStudyLimit) {
        const rawSLim = parseInt(savedStudyLimit, 10) || 210;
        currentStudyLimit = [90, 150, 210].includes(rawSLim) ? rawSLim : 210;
      }
      setYtStudyLimitMinutes(currentStudyLimit);

      let parsedChannels: string[] = [];
      if (savedStudyChannels) {
        parsedChannels = JSON.parse(savedStudyChannels).slice(
          0,
          MAX_STUDY_CHANNELS,
        );
      }
      setStudyChannels(parsedChannels);

      // Auto-clear yesterday's class videos at midnight!
      let parsedVideos: StudyVideoItem[] = [];
      if (savedStudyVideos) {
        const rawVids: StudyVideoItem[] = JSON.parse(savedStudyVideos);
        parsedVideos = rawVids
          .filter((v) => v.addedDate === todayIso)
          .slice(0, MAX_STUDY_VIDEOS);
        if (parsedVideos.length !== rawVids.length) {
          await AsyncStorage.setItem(
            "@focus_yt_study_videos",
            JSON.stringify(parsedVideos),
          );
        }
      }
      setStudyVideos(parsedVideos);

      await syncStudyConfigToNative(
        currentStudyLimit,
        parsedChannels,
        parsedVideos,
      );

      if (savedSchedBreak !== null) {
        const enabled = savedSchedBreak === "true";
        setScheduleBreakEnabledState(enabled);
        if (FocusLock?.setScheduleBreakEnabled) {
          await FocusLock.setScheduleBreakEnabled(enabled);
        }
      }

      if (savedSchedules) {
        const parsed = JSON.parse(savedSchedules);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hydrated: ScheduleItem[] = parsed.map((s: any) => ({
            ...s,
            startTime: new Date(s.startTime),
            endTime: new Date(s.endTime),
          }));
          setSchedules(hydrated);

          if (FocusLock?.setAdvancedSchedules) {
            const hasEnabled = hydrated.some((s) => s.isEnabled);
            const formatted = hydrated.map((s) => ({
              isEnabled: s.isEnabled,
              startHour: s.startTime.getHours(),
              startMinute: s.startTime.getMinutes(),
              endHour: s.endTime.getHours(),
              endMinute: s.endTime.getMinutes(),
              activeDays: s.activeDays,
            }));
            await FocusLock.setAdvancedSchedules(
              JSON.stringify(formatted),
              hasEnabled,
              parsedApps,
              currentYtLimit,
            );
          }
        }
      }
    } catch {}
  };

  const toggleScheduleBreak = async (val: boolean) => {
    setScheduleBreakEnabledState(val);
    await AsyncStorage.setItem(
      "@focus_schedule_break_enabled",
      val ? "true" : "false",
    );
    if (FocusLock?.setScheduleBreakEnabled) {
      await FocusLock.setScheduleBreakEnabled(val);
    }
  };

  // Pick & Open Study PDF directly from Lock Screen (Only .pdf files allowed!)
  const handlePickAndReadStudyPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const fileName = (asset.name || "").toLowerCase();
      const mime = (asset.mimeType || "").toLowerCase();

      if (!fileName.endsWith(".pdf") && mime !== "application/pdf") {
        showModernNotice(
          "শুধুমাত্র PDF ফাইল অনুমোদিত",
          "লক চলাকালীন শুধুমাত্র পড়াশোনার .pdf ফাইল ওপেন করা যাবে।",
          "file-alert-outline",
          "#F43F5E",
        );
        return;
      }

      if (Platform.OS === "android" && FocusLock?.openPdfUri) {
        await FocusLock.openPdfUri(asset.uri);
      } else {
        await Linking.openURL(asset.uri);
      }
    } catch {
      showModernNotice(
        "PDF ওপেন করা যায়নি",
        "ফোনে News Plus বা Google Drive PDF Viewer ইনস্টল করা আছে কি না চেক করুন।",
        "file-pdf-box",
        "#F43F5E",
      );
    }
  };

  const verifyRequiredPermissionsBeforeLock = async (): Promise<boolean> => {
    if (Platform.OS !== "android" || !FocusLock) return false;
    const acc = await FocusLock.isAccessibilityServiceEnabled();
    const ovl = FocusLock.isOverlayPermissionGranted
      ? await FocusLock.isOverlayPermissionGranted()
      : true;

    if (!ovl || !acc) {
      setSettingsModalVisible(true);
      showModernNotice(
        "সিস্টেম পারমিশন প্রয়োজন",
        "লক চালু করার আগে Settings থেকে প্রয়োজনীয় সিস্টেম পারমিশনগুলো অন করুন।",
        "shield-alert-outline",
        "#F43F5E",
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

  const formatYtCompact = (usedSecs: number, limitMins: number) => {
    const m = Math.floor(usedSecs / 60);
    const s = usedSecs % 60;
    return `${m}m ${String(s).padStart(2, "0")}s / ${limitMins}m`;
  };

  // Core Schedule Saver (with Max 15h Hard Cap + 10h/12h Smart Warning Confirmation Modal!)
  const commitSchedulesToStorageAndNative = async (
    schedulesToSave: ScheduleItem[],
    silent: boolean,
  ) => {
    if (!FocusLock) return;
    const enabledCount = schedulesToSave.filter((s) => s.isEnabled).length;
    const hasEnabled = enabledCount > 0;

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
      setScheduleSavedModal({
        visible: true,
        hasEnabled,
        activeCount: enabledCount,
      });
    }
  };

  const saveAllSchedules = async (
    schedulesToSave = schedules,
    silent = false,
    skipLongDurationWarning = false,
  ): Promise<void> => {
    try {
      if (!FocusLock) return;

      let longestLongSchedHours: string | null = null;

      // 1. Check Hard Cap: Max 15 Hours (900 minutes)
      for (let i = 0; i < schedulesToSave.length; i++) {
        const s = schedulesToSave[i];
        const durMins = getScheduleDurationMinutes(s.startTime, s.endTime);
        if (durMins > MAX_SCHEDULE_MINUTES) {
          showModernNotice(
            "সর্বোচ্চ ১৫ ঘণ্টার সীমা (Max 15h)",
            `Schedule ${i + 1}-এর সময়কাল ${(durMins / 60).toFixed(1)} ঘণ্টা দেওয়া হয়েছে। নিরাপত্তার জন্য Schedule Lock একটানা সর্বোচ্চ ১৫ ঘণ্টার (৯০০ মিনিট) বেশি সেট করা যাবে না।`,
            "clock-alert-outline",
            "#F43F5E",
          );
          return;
        }
        // 2. Check Warning Threshold: > 10 Hours (600m) / >= 12 Hours (720m)
        if (durMins > WARN_SCHEDULE_MINUTES && s.isEnabled) {
          longestLongSchedHours = (durMins / 60).toFixed(1);
        }
      }

      if (longestLongSchedHours && !skipLongDurationWarning && !silent) {
        setUiModal({
          visible: true,
          title: "দীর্ঘ শিডিউল লকের সতর্কতা!",
          message: `আপনি ${longestLongSchedHours} ঘণ্টার একটি দীর্ঘ Schedule Lock চালু করেছেন (১০/১২ ঘণ্টার বেশি)। এই সময়ে ফোন কড়া লকে থাকবে (৫০ মিনিট লক + ১০ মিনিট ব্রেক)। আপনি কি নিশ্চিতভাবে এটি সেভ করতে চান?`,
          icon: "alert-decagram-outline",
          color: "#FBBF24",
          cancelText: "সময় কমান",
          confirmText: "হ্যাঁ, নিশ্চিত করুন",
          onConfirm: () => {
            void commitSchedulesToStorageAndNative(schedulesToSave, false);
          },
        });
        return;
      }

      await commitSchedulesToStorageAndNative(schedulesToSave, silent);
    } catch {
      if (!silent) {
        showModernNotice(
          "সেভ করা যায়নি",
          "শিডিউল সেভ করতে সমস্যা হয়েছে, আবার চেষ্টা করুন।",
          "alert-circle-outline",
          "#F43F5E",
        );
      }
    }
  };

  const startSessionLockNow = async () => {
    if (isStartingFocusRef.current) return;
    const parsedDuration = parseInt(customDuration, 10);
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      showModernNotice(
        "সময় সঠিক নয়",
        "কত মিনিট লক করতে চান তা সঠিকভাবে লিখুন।",
        "timer-alert-outline",
        "#F43F5E",
      );
      return;
    }

    // Enforce Max 6 Hours (360 minutes) for Session Lock!
    if (parsedDuration > MAX_SESSION_MINUTES) {
      setCustomDuration(String(MAX_SESSION_MINUTES));
      showModernNotice(
        "সর্বোচ্চ ৬ ঘণ্টার সীমা (Session Limit)",
        "নিরাপত্তার জন্য Session Lock একটানা সর্বোচ্চ ৬ ঘণ্টা (৩৬০ মিনিট) পর্যন্ত দেওয়া যাবে। সময় ৩৬০ মিনিটে সেট করা হয়েছে।",
        "clock-alert-outline",
        "#FBBF24",
      );
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
      showModernNotice(
        "লক চালু করা যায়নি",
        "সিস্টেম পারমিশনগুলো ঠিকমতো অন আছে কি না চেক করুন।",
        "alert-circle-outline",
        "#F43F5E",
      );
    } finally {
      isStartingFocusRef.current = false;
    }
  };

  const handleEmergencyUnlockConfirm = async () => {
    if (!FocusLock?.useEmergencyPass) return;
    if (emergencyPasses <= 0) {
      setEmergencyModalVisible(false);
      showModernNotice(
        "কোনো Emergency Pass নেই",
        "আপনার কাছে এখন ০টি পাস আছে। টানা ৩ দিন (কমপক্ষে ৩০ মিনিট করে) নিয়ম মেনে লক পূর্ণ করলে ১টি Emergency Pass পাবেন!",
        "ticket-confirmation-outline",
        "#FBBF24",
      );
      return;
    }

    setSpendingPass(true);
    try {
      const canSpendOnline = await spendEmergencyPassWithCloudCheck();
      if (!canSpendOnline) {
        setEmergencyModalVisible(false);
        showModernNotice(
          "ইন্টারনেট সংযোগ প্রয়োজন",
          "Emergency Pass ব্যবহার করে লক আনলক করার জন্য ফোনের ইন্টারনেট (Wi-Fi বা Mobile Data) চালু করুন।",
          "wifi-off",
          "#F43F5E",
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
          title: "১টি Emergency Pass ব্যবহৃত হয়েছে",
          message: `আপনি জরুরি প্রয়োজনে লক আনলক করেছেন। আপনার ১টি পাস কেটে ক্লাউডে আপডেট করা হয়েছে এবং ৩ দিনের স্ট্রিক কাউন্টার রিসেট হয়েছে।`,
          timestamp: Date.now(),
          read: false,
          type: "lock",
        });
      }
    } catch {
      setEmergencyModalVisible(false);
      showModernNotice(
        "আনলক করা যায়নি",
        "Emergency Pass ব্যবহার করতে সমস্যা হয়েছে।",
        "alert-circle-outline",
        "#F43F5E",
      );
    } finally {
      setSpendingPass(false);
    }
  };

  const toggleAppSelection = (pkg: string) => {
    if (selectedApps.includes(pkg)) {
      setSelectedApps((prev) => prev.filter((p) => p !== pkg));
    } else {
      if (selectedApps.length >= MAX_SELECTED_APPS) {
        showModernNotice(
          "সর্বোচ্চ ৬টি অ্যাপ সিলেক্ট করা যাবে",
          "ফোকাস ধরে রাখতে লক চলাকালীন সর্বোচ্চ ৬টি জরুরি অ্যাপ ব্যবহারের অনুমতি দেওয়া যাবে।",
          "apps",
          "#FBBF24",
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

    if (!clean) {
      setNewDomainInput("");
      return;
    }

    if (clean.includes("youtube.") || clean.includes("youtu.be")) {
      setNewDomainInput("");
      showModernNotice(
        "Chrome-এ YouTube নিষিদ্ধ",
        "Chrome-এ YouTube ওয়েবসাইট যোগ করা যাবে না! ক্লাসের বা লং ভিডিও দেখতে নিচের YouTube Study Mode ব্যবহার করুন।",
        "youtube",
        "#F43F5E",
      );
      return;
    }

    if (allowedDomains.length >= MAX_ALLOWED_DOMAINS) {
      showModernNotice(
        "সর্বোচ্চ ৫টি ওয়েবসাইট লিমিট",
        "ফোকাস ধরে রাখতে Chrome-এ সর্বোচ্চ ৫টি জরুরি ওয়েবসাইট যোগ করা যাবে। নতুন সাইট যোগ করতে আগের কোনোটি মুছে ফেলুন।",
        "web",
        "#FBBF24",
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

  // 🌟 Study YouTube Mode Handlers (Study Limit + Permanent Channels + Daily Auto-Clearing Class Videos)
  const updateStudyYtQuota = async (mins: number) => {
    setYtStudyLimitMinutes(mins);
    await AsyncStorage.setItem("@focus_yt_study_limit_minutes", String(mins));
    await syncStudyConfigToNative(mins, studyChannels, studyVideos);
    void syncLocalDataToCloudIfOnline();
  };

  const addStudyItem = async () => {
    const clean = newStudyInput.trim();
    if (!clean) return;

    if (studyTab === "channels") {
      if (studyChannels.length >= MAX_STUDY_CHANNELS) {
        showModernNotice(
          "সর্বোচ্চ ৫টি স্টাডি চ্যানেল",
          "স্থায়ীভাবে সর্বোচ্চ ৫টি ক্লাসের চ্যানেল যুক্ত করা যাবে। নতুন চ্যানেল যোগ করতে আগের কোনোটি মুছে ফেলুন।",
          "school-outline",
          "#FBBF24",
        );
        return;
      }
      const chName = clean
        .replace(/^https?:\/\/(www\.)?youtube\.com\/@?/i, "")
        .replace(/\/.*$/, "")
        .trim();
      if (!chName || studyChannels.some((c) => c.toLowerCase() === chName.toLowerCase())) {
        setNewStudyInput("");
        return;
      }
      const updated = [...studyChannels, chName];
      setStudyChannels(updated);
      setNewStudyInput("");
      await AsyncStorage.setItem(
        "@focus_yt_study_channels",
        JSON.stringify(updated),
      );
      await syncStudyConfigToNative(ytStudyLimitMinutes, updated, studyVideos);
      void syncLocalDataToCloudIfOnline();
    } else {
      if (studyVideos.length >= MAX_STUDY_VIDEOS) {
        showModernNotice(
          "সর্বোচ্চ ৫টি ক্লাস ভিডিও",
          "আজকের ক্লাসের জন্য সর্বোচ্চ ৫টি ভিডিও লিঙ্ক বা নাম যোগ করা যাবে।",
          "play-box-multiple-outline",
          "#FBBF24",
        );
        return;
      }
      const todayIso = new Date().toISOString().split("T")[0];
      const isUrl =
        clean.startsWith("http://") ||
        clean.startsWith("https://") ||
        clean.includes("youtu.be/") ||
        clean.includes("youtube.com/");
      const newVid: StudyVideoItem = {
        id: Date.now().toString(),
        raw: clean,
        title: formatVideoDisplayLabel(clean),
        url: isUrl
          ? clean.startsWith("http")
            ? clean
            : `https://${clean}`
          : `https://www.youtube.com/results?search_query=${encodeURIComponent(clean)}`,
        addedDate: todayIso,
      };
      const updated = [...studyVideos, newVid];
      setStudyVideos(updated);
      setNewStudyInput("");
      await AsyncStorage.setItem(
        "@focus_yt_study_videos",
        JSON.stringify(updated),
      );
      await syncStudyConfigToNative(
        ytStudyLimitMinutes,
        studyChannels,
        updated,
      );
    }
  };

  const removeStudyChannel = async (ch: string) => {
    const updated = studyChannels.filter((c) => c !== ch);
    setStudyChannels(updated);
    await AsyncStorage.setItem(
      "@focus_yt_study_channels",
      JSON.stringify(updated),
    );
    await syncStudyConfigToNative(ytStudyLimitMinutes, updated, studyVideos);
    void syncLocalDataToCloudIfOnline();
  };

  const removeStudyVideo = async (id: string) => {
    const updated = studyVideos.filter((v) => v.id !== id);
    setStudyVideos(updated);
    await AsyncStorage.setItem(
      "@focus_yt_study_videos",
      JSON.stringify(updated),
    );
    await syncStudyConfigToNative(ytStudyLimitMinutes, studyChannels, updated);
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

  const isCycleModeActive =
    (lockMode === "SESSION" && pomodoroEnabled) ||
    (lockMode === "SCHEDULE" && scheduleBreakEnabled);

  const studyHoursText = (ytStudyLimitMinutes / 60)
    .toFixed(1)
    .replace(".0", "");

  // =========================================================================
  // 1. ACTIVE LOCK SCREEN DASHBOARD (With Dual YouTube Quota + Direct Class Launcher!)
  // =========================================================================
  if (isFocusActive) {
    const hasStudyItems = studyVideos.length > 0 || studyChannels.length > 0;

    return (
      <SafeAreaView
        className="flex-1 bg-[#070B14]"
        edges={["top", "bottom", "left", "right"]}
      >
        <StatusBar style="light" backgroundColor="#070B14" />
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
            <View className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full flex-row items-center flex-shrink">
              <MaterialCommunityIcons
                name={
                  isBreakActive
                    ? "coffee"
                    : lockMode === "SCHEDULE"
                      ? "calendar-clock"
                      : "shield-lock"
                }
                size={15}
                color={isBreakActive ? "#34D399" : "#F43F5E"}
              />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                className="text-slate-200 font-bold text-[11px] ml-1.5"
              >
                {lockMode === "SCHEDULE"
                  ? scheduleBreakEnabled
                    ? "Schedule (50m / 10m)"
                    : "Schedule Lock"
                  : pomodoroEnabled
                    ? "Session (25m / 5m)"
                    : "Session Lock"}
              </Text>
            </View>

            <View className="bg-amber-500/15 border border-amber-500/30 px-3 py-1.5 rounded-full flex-row items-center">
              <MaterialCommunityIcons
                name="ticket-confirmation"
                size={14}
                color="#FBBF24"
              />
              <Text
                allowFontScaling={false}
                className="text-amber-300 font-bold text-[11px] ml-1.5"
              >
                Pass: {emergencyPasses}/5
              </Text>
              <View className="w-[1px] h-3 bg-amber-500/30 mx-2" />
              <MaterialCommunityIcons name="fire" size={14} color="#34D399" />
              <Text
                allowFontScaling={false}
                className="text-emerald-300 font-bold text-[11px] ml-1"
              >
                {streakDays}/3d
              </Text>
            </View>
          </View>

          {/* Center Lock / Break Status */}
          <View className="items-center my-2">
            <View
              className={`p-4 rounded-full items-center justify-center border-2 ${
                isBreakActive
                  ? "bg-emerald-500/15 border-emerald-400"
                  : "bg-rose-500/15 border-rose-500"
              }`}
            >
              <MaterialCommunityIcons
                name={isBreakActive ? "coffee-outline" : "shield-lock"}
                size={34}
                color={isBreakActive ? "#34D399" : "#F43F5E"}
              />
            </View>

            <Text
              allowFontScaling={false}
              className="text-white text-xl font-black mt-2 text-center px-2"
            >
              {isBreakActive
                ? lockMode === "SCHEDULE"
                  ? "১০ মিনিটের ফ্রি ব্রেক চলছে!"
                  : "৫ মিনিটের ফ্রি ব্রেক চলছে!"
                : "Strict Focus Lock Active"}
            </Text>

            {isBreakActive && (
              <Text
                allowFontScaling={false}
                className="text-amber-300/90 text-[11px] font-bold mt-1 text-center"
              >
                ব্রেকের মধ্যেও Reels ও YouTube Shorts সম্পূর্ণ ব্লকড আছে
              </Text>
            )}

            <Text
              allowFontScaling={false}
              className={`text-4xl font-black mt-2 tracking-widest ${
                isBreakActive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {isCycleModeActive && !noMoreBreaks
                ? formatCountdown(cycleRemainingMillis)
                : formatCountdown(remainingMillis)}
            </Text>

            {isCycleModeActive && (
              <View className="bg-slate-900 px-3.5 py-1.5 rounded-full mt-2 border border-slate-800">
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-slate-300 text-[11px] font-bold text-center"
                >
                  {isBreakActive
                    ? `লক শুরু হতে বাকি • মোট বাকি: ${formatCountdown(remainingMillis)}`
                    : noMoreBreaks
                      ? `লক শেষ হতে বাকি (আর কোনো ব্রেক নেই)`
                      : `ব্রেক পেতে বাকি • মোট বাকি: ${formatCountdown(remainingMillis)}`}
                </Text>
              </View>
            )}
          </View>

          {/* Middle Section: Read Study PDF Button + Dual YouTube Card + Allowed Apps + Chrome Links */}
          <View>
            {/* Read Study PDF Button */}
            <Pressable
              onPress={() => void handlePickAndReadStudyPdf()}
              className="bg-sky-500/15 border border-sky-500/40 rounded-2xl p-3 mb-2.5 flex-row items-center justify-between active:bg-sky-500/25"
            >
              <View className="flex-row items-center flex-1 pr-2">
                <View className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/30 items-center justify-center">
                  <MaterialCommunityIcons
                    name="file-pdf-box"
                    size={22}
                    color="#38BDF8"
                  />
                </View>
                <View className="ml-2.5 flex-1">
                  <Text
                    allowFontScaling={false}
                    className="text-white text-xs font-black"
                  >
                    Read Study PDF (Only .pdf)
                  </Text>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    className="text-sky-200/80 text-[10px] mt-0.5"
                  >
                    News Plus বা Drive PDF ভিউয়ারে পড়ুন (ভিডিও অটো ব্লকড)
                  </Text>
                </View>
              </View>
              <View className="bg-sky-500 px-3 py-1.5 rounded-xl flex-row items-center">
                <Feather name="book-open" size={12} color="#FFFFFF" />
                <Text
                  allowFontScaling={false}
                  className="text-white font-black text-[11px] ml-1.5"
                >
                  Open PDF
                </Text>
              </View>
            </Pressable>

            {/* 🌟 Dual YouTube Live Usage Card (General YT + Study Class YT + 1-Tap Class Launcher!) */}
            <View className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 mb-2.5">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 flex-row items-center pr-2">
                  <Ionicons name="logo-youtube" size={15} color="#EF4444" />
                  <View className="ml-2 flex-1">
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-slate-400 text-[10px] font-bold"
                    >
                      General YT
                    </Text>
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-rose-400 text-xs font-black"
                    >
                      {formatYtCompact(ytUsedSeconds, ytLimitMinutes)}
                    </Text>
                  </View>
                </View>

                <View className="w-[1px] h-7 bg-slate-800 mx-2" />

                <View className="flex-1 flex-row items-center pl-1">
                  <MaterialCommunityIcons
                    name="school"
                    size={16}
                    color="#34D399"
                  />
                  <View className="ml-2 flex-1">
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-slate-400 text-[10px] font-bold"
                    >
                      Study Class YT
                    </Text>
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-emerald-400 text-xs font-black"
                    >
                      {formatYtCompact(ytStudyUsedSeconds, ytStudyLimitMinutes)}
                    </Text>
                  </View>
                </View>
              </View>

              {hasStudyItems && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="mt-2.5 pt-2 border-t border-slate-800"
                  contentContainerStyle={{ gap: 8 }}
                >
                  {studyVideos.map((vid) => (
                    <Pressable
                      key={vid.id}
                      onPress={() => {
                        if (FocusLock?.openStudyYouTubeItem) {
                          void FocusLock.openStudyYouTubeItem(vid.url);
                        }
                      }}
                      className="bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl flex-row items-center active:bg-emerald-500/30"
                    >
                      <Feather name="play-circle" size={12} color="#34D399" />
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-emerald-300 font-bold text-[11px] ml-1.5"
                      >
                        {vid.title}
                      </Text>
                    </Pressable>
                  ))}

                  {studyChannels.map((ch) => (
                    <Pressable
                      key={ch}
                      onPress={() => {
                        if (FocusLock?.openStudyYouTubeItem) {
                          void FocusLock.openStudyYouTubeItem(ch);
                        }
                      }}
                      className="bg-indigo-500/15 border border-indigo-500/40 px-2.5 py-1.5 rounded-xl flex-row items-center active:bg-indigo-500/30"
                    >
                      <MaterialCommunityIcons
                        name="school-outline"
                        size={13}
                        color="#818CF8"
                      />
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-indigo-200 font-bold text-[11px] ml-1.5"
                      >
                        {ch}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
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
                          style={{ width: 34, height: 34, borderRadius: 9 }}
                        />
                      ) : (
                        <MaterialCommunityIcons
                          name="application"
                          size={34}
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

            {/* Direct Chrome Whitelisted Website Buttons */}
            {isChromeWhitelisted && allowedDomains.length > 0 && (
              <View className="bg-slate-900/90 border border-sky-500/30 rounded-3xl p-3.5 mt-2.5">
                <View className="flex-row items-center justify-center mb-2.5">
                  <MaterialCommunityIcons
                    name="web"
                    size={15}
                    color="#38BDF8"
                  />
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
                      <Feather name="external-link" size={12} color="#38BDF8" />
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
            <MaterialCommunityIcons
              name={
                emergencyPasses > 0 ? "ticket-confirmation" : "lock-outline"
              }
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
            <View className="bg-[#131C31] w-full rounded-3xl p-6 border border-slate-700 items-center">
              <View className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/40 items-center justify-center mb-4">
                <MaterialCommunityIcons
                  name="alert-octagon"
                  size={32}
                  color="#FBBF24"
                />
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
                className="text-slate-300 text-xs text-center leading-5 mb-5"
              >
                {emergencyPasses > 0
                  ? `এখন লক ভাঙলে আপনার জমানো ${emergencyPasses}টি পাস থেকে ১টি পাস কেটে ক্লাউডে আপডেট করা হবে (বাকি থাকবে ${emergencyPasses - 1}টি) এবং ৩ দিনের স্ট্রিক ০ হয়ে যাবে!`
                  : `আপনার পাস সংখ্যা এখন 0। টানা ৩ দিন (কমপক্ষে ৩০ মিনিট করে) নিয়ম মেনে লক পূর্ণ করলে ১টি করে পাস পাবেন (সর্বোচ্চ ৫টি)।`}
              </Text>

              <View className="flex-row gap-3 w-full">
                <Pressable
                  onPress={() => setEmergencyModalVisible(false)}
                  disabled={spendingPass}
                  className="flex-1 bg-slate-800 py-3.5 rounded-2xl items-center border border-slate-700"
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

        {/* Universal Modern Custom Notice Modal */}
        <Modal
          visible={uiModal.visible}
          transparent
          animationType="fade"
          onRequestClose={() =>
            setUiModal((prev) => ({ ...prev, visible: false }))
          }
        >
          <View className="flex-1 bg-black/80 justify-center items-center px-6">
            <View className="bg-[#131C31] w-full rounded-3xl p-6 border border-slate-700 items-center">
              <View
                style={{
                  backgroundColor: `${uiModal.color}20`,
                  borderColor: `${uiModal.color}50`,
                }}
                className="w-16 h-16 rounded-2xl items-center justify-center mb-4 border"
              >
                <MaterialCommunityIcons
                  name={uiModal.icon}
                  size={34}
                  color={uiModal.color}
                />
              </View>
              <Text
                allowFontScaling={false}
                className="text-white font-black text-lg text-center mb-2"
              >
                {uiModal.title}
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-300 text-xs text-center leading-5 mb-5"
              >
                {uiModal.message}
              </Text>
              <Pressable
                onPress={() =>
                  setUiModal((prev) => ({ ...prev, visible: false }))
                }
                className="w-full bg-indigo-600 py-3.5 rounded-2xl items-center"
              >
                <Text
                  allowFontScaling={false}
                  className="text-white font-black text-xs uppercase tracking-wider"
                >
                  ঠিক আছে
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // =========================================================================
  // 2. CLEAN UNLOCK SCREEN (Auto-Hides Granted Permissions + Max 6h/15h Limits)
  // =========================================================================
  const allPermsReady =
    permState.accessibility && permState.overlay && permState.deviceAdmin;
  const missingPermsCount =
    (permState.overlay ? 0 : 1) +
    (permState.accessibility ? 0 : 1) +
    (permState.deviceAdmin ? 0 : 1);
  const activeSchedulesCount = schedules.filter((s) => s.isEnabled).length;

  return (
    <View className="flex-1 bg-[#0B1120]">
      <StatusBar style="light" backgroundColor="#070B14" />

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: Math.max(36, insets.bottom + 20),
        }}
      >
        {/* TOP-TO-MIDDLE: HERO BACKGROUND IMAGE + DARK OVERLAY */}
        <ImageBackground
          source={{ uri: HERO_BG_URI }}
          className="w-full"
          resizeMode="cover"
        >
          <View
            style={{ paddingTop: Math.max(16, insets.top + 8) }}
            className="bg-[#070B14]/80 px-5 pb-12"
          >
            {/* TOP BAR: Left = Pass & Streak Badge | Right = Settings Gear */}
            <View className="flex-row items-center justify-between mb-6">
              <Pressable
                onPress={() => setPassInfoModalVisible(true)}
                className="bg-slate-900/90 border border-amber-500/40 px-3.5 py-2 rounded-2xl flex-row items-center"
              >
                <MaterialCommunityIcons
                  name="ticket-confirmation"
                  size={16}
                  color="#FBBF24"
                />
                <Text
                  allowFontScaling={false}
                  className="text-amber-300 font-black text-xs ml-1.5"
                >
                  Pass: {emergencyPasses}/5
                </Text>
                <View className="w-[1px] h-3.5 bg-slate-700 mx-2.5" />
                <MaterialCommunityIcons name="fire" size={16} color="#34D399" />
                <Text
                  allowFontScaling={false}
                  className="text-emerald-300 font-black text-xs ml-1"
                >
                  {streakDays}/3d
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setSettingsModalVisible(true)}
                className="h-11 w-11 rounded-2xl bg-slate-900/90 border border-slate-700 items-center justify-center relative"
              >
                <Ionicons name="settings-outline" size={22} color="#E2E8F0" />
                {!allPermsReady && (
                  <View className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-rose-500 border border-slate-900" />
                )}
              </Pressable>
            </View>

            {/* HERO CENTER: Duration Input (Max 360m / 6h) + Preset Chips + Glowing HOLD Button */}
            <View className="items-center">
              <Text
                allowFontScaling={false}
                className="text-indigo-300 font-bold text-xs uppercase tracking-widest mb-2"
              >
                Deep Focus Session (Max 6h)
              </Text>

              <View className="flex-row items-baseline justify-center mb-3">
                <TextInput
                  allowFontScaling={false}
                  value={customDuration}
                  onChangeText={(text) => {
                    const digits = text.replace(/[^0-9]/g, "");
                    if (!digits) {
                      setCustomDuration("");
                      return;
                    }
                    const num = parseInt(digits, 10);
                    if (num > MAX_SESSION_MINUTES) {
                      setCustomDuration(String(MAX_SESSION_MINUTES));
                    } else {
                      setCustomDuration(digits);
                    }
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="60"
                  placeholderTextColor="#64748B"
                  className="text-white text-5xl font-black bg-slate-900/85 border border-slate-700/80 rounded-3xl w-36 text-center py-2"
                />
                <Text
                  allowFontScaling={false}
                  className="text-slate-300 font-black text-sm ml-2.5 tracking-widest"
                >
                  MINS
                </Text>
              </View>

              {/* Preset Duration Pills (Up to 6h = 360m) */}
              <View className="flex-row justify-center gap-2 mb-6">
                {[
                  { label: "30m", val: "30" },
                  { label: "1h", val: "60" },
                  { label: "2h", val: "120" },
                  { label: "4h", val: "240" },
                  { label: "6h Max", val: "360" },
                ].map((preset) => (
                  <Pressable
                    key={preset.val}
                    onPress={() => setCustomDuration(preset.val)}
                    className={`px-3.5 py-1.5 rounded-full border ${
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
                  <MaterialCommunityIcons
                    name="shield-lock"
                    size={36}
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

        {/* MIDDLE-TO-BOTTOM: CLEAN CURVED SHEET */}
        <View className="bg-[#0B1120] rounded-t-[32px] -mt-6 px-5 pt-6">
          {/* AUTO-HIDE SYSTEM PERMISSIONS BANNER */}
          {!allPermsReady && (
            <Pressable
              onPress={() => setSettingsModalVisible(true)}
              className="bg-rose-500/15 border border-rose-500/40 p-3.5 rounded-2xl mb-4 flex-row items-center justify-between"
            >
              <View className="flex-row items-center flex-1 pr-2">
                <MaterialCommunityIcons
                  name="shield-alert-outline"
                  size={20}
                  color="#F43F5E"
                />
                <Text
                  allowFontScaling={false}
                  className="text-rose-200 font-bold text-xs ml-2 flex-1"
                >
                  বাকি থাকা {missingPermsCount}টি সিস্টেম পারমিশন অন করুন (অন
                  করলেই অটো হাইড হবে)
                </Text>
              </View>
              <Text
                allowFontScaling={false}
                className="text-rose-400 font-black text-xs"
              >
                Allow →
              </Text>
            </Pressable>
          )}

          {/* CARD 1: Session 25m Lock + 5m Break Cycle Bar */}
          <View className="bg-[#131C31] p-4 rounded-3xl border border-slate-800 flex-row items-center justify-between mb-4">
            <View className="flex-row items-center flex-1 pr-3">
              <View className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 items-center justify-center mr-3">
                <MaterialCommunityIcons
                  name="coffee-outline"
                  size={20}
                  color="#34D399"
                />
              </View>
              <View className="flex-1">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  Session: 25m Lock + 5m Break
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-[11px] mt-0.5"
                >
                  প্রতি ২৫ মিনিট পর ৫ মিনিট ব্রেক (Reels/Shorts ব্লক থাকবে)
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

          {/* CARD 2: Allowed Apps & Active Rules + Study PDF Launcher (KEPT EXACTLY AS USER LIKED!) */}
          <View className="bg-[#131C31] p-4 rounded-3xl border border-slate-800 mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center">
                <MaterialCommunityIcons
                  name="apps"
                  size={18}
                  color="#818CF8"
                />
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
                className="bg-[#0B1120] py-3 rounded-2xl items-center border border-slate-800 mb-3"
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
                    className="bg-[#0B1120] px-2.5 py-1.5 rounded-xl border border-slate-800 flex-row items-center"
                  >
                    {app.icon ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${app.icon}` }}
                        style={{ width: 18, height: 18, borderRadius: 4 }}
                      />
                    ) : (
                      <MaterialCommunityIcons
                        name="application"
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

            {/* Quick Summary Pills for YT (30m + 3.5h), Chrome & PDF */}
            <View className="flex-row gap-2 pt-2 border-t border-slate-800">
              <Pressable
                onPress={() => setSettingsModalVisible(true)}
                className="flex-1 bg-[#0B1120] py-2 px-2.5 rounded-xl flex-row items-center justify-between border border-slate-800"
              >
                <View className="flex-row items-center">
                  <Ionicons name="logo-youtube" size={14} color="#EF4444" />
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    className="text-slate-300 font-bold text-[11px] ml-1.5"
                  >
                    YT: {ytLimitMinutes}m + {studyHoursText}h
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={12} color="#64748B" />
              </Pressable>

              <Pressable
                onPress={() => setSettingsModalVisible(true)}
                className="flex-1 bg-[#0B1120] py-2 px-2.5 rounded-xl flex-row items-center justify-between border border-slate-800"
              >
                <View className="flex-row items-center">
                  <MaterialCommunityIcons
                    name="web"
                    size={14}
                    color="#38BDF8"
                  />
                  <Text
                    allowFontScaling={false}
                    className="text-slate-300 font-bold text-[11px] ml-1.5"
                  >
                    Sites: {allowedDomains.length}/{MAX_ALLOWED_DOMAINS}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={12} color="#64748B" />
              </Pressable>

              <Pressable
                onPress={() => void handlePickAndReadStudyPdf()}
                className="bg-sky-500/15 py-2 px-2.5 rounded-xl flex-row items-center border border-sky-500/30"
              >
                <MaterialCommunityIcons
                  name="file-pdf-box"
                  size={15}
                  color="#38BDF8"
                />
                <Text
                  allowFontScaling={false}
                  className="text-sky-300 font-bold text-[11px] ml-1"
                >
                  PDF
                </Text>
              </Pressable>
            </View>
          </View>

          {/* CARD 3: Daily Schedule Lock Card (KEPT EXACTLY AS USER LIKED, updated label to Max 15h!) */}
          <View className="bg-[#131C31] p-4 rounded-3xl border border-slate-800">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 items-center justify-center mr-2.5">
                  <MaterialCommunityIcons
                    name="calendar-clock"
                    size={19}
                    color="#818CF8"
                  />
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
                    সর্বোচ্চ ১৫ ঘণ্টা সীমা • 50m Lock + 10m Break সাপোর্ট
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

            {/* Schedule 50m + 10m Break Toggle inside Card */}
            <View className="bg-[#0B1120] px-3.5 py-2.5 rounded-2xl border border-slate-800 flex-row items-center justify-between mb-2.5">
              <View className="flex-row items-center flex-1 pr-2">
                <MaterialCommunityIcons
                  name="timer-sand"
                  size={16}
                  color="#34D399"
                />
                <Text
                  allowFontScaling={false}
                  className="text-slate-200 font-bold text-xs ml-2 flex-1"
                >
                  Schedule: 50m Lock + 10m Break
                </Text>
              </View>
              <Switch
                value={scheduleBreakEnabled}
                onValueChange={(v) => void toggleScheduleBreak(v)}
                trackColor={{ false: "#334155", true: "#10B981" }}
                thumbColor="#FFFFFF"
              />
            </View>

            {schedules.slice(0, 2).map((sched, i) => {
              const durHours = (
                getScheduleDurationMinutes(sched.startTime, sched.endTime) / 60
              ).toFixed(1);
              return (
                <View
                  key={sched.id}
                  className="bg-[#0B1120] px-3.5 py-2.5 rounded-2xl border border-slate-800 flex-row items-center justify-between mb-2 last:mb-0"
                >
                  <Pressable
                    onPress={() => setScheduleModalVisible(true)}
                    className="flex-1 pr-2"
                  >
                    <View className="flex-row items-center">
                      <Feather name="clock" size={12} color="#818CF8" />
                      <Text
                        allowFontScaling={false}
                        className="text-white font-black text-xs ml-1.5"
                      >
                        {formatTime(sched.startTime)} →{" "}
                        {formatTime(sched.endTime)}
                      </Text>
                    </View>
                    <Text
                      allowFontScaling={false}
                      className="text-slate-400 text-[10px] mt-0.5"
                    >
                      Schedule {i + 1} ({durHours}h / Max 15h) •{" "}
                      {sched.activeDays.length}d/wk
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
              );
            })}
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
                <MaterialCommunityIcons
                  name="ticket-confirmation"
                  size={22}
                  color="#FBBF24"
                />
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
                <View className="flex-row items-center">
                  <MaterialCommunityIcons
                    name="ticket-confirmation-outline"
                    size={16}
                    color="#FBBF24"
                  />
                  <Text
                    allowFontScaling={false}
                    className="text-slate-300 font-bold text-xs ml-1.5"
                  >
                    বর্তমান জমানো পাস (Account-Wise)
                  </Text>
                </View>
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
                <View className="flex-row items-center">
                  <MaterialCommunityIcons
                    name="fire"
                    size={16}
                    color="#34D399"
                  />
                  <Text
                    allowFontScaling={false}
                    className="text-slate-300 font-bold text-xs ml-1.5"
                  >
                    পরবর্তী পাসের স্ট্রিক অগ্রগতি
                  </Text>
                </View>
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
              হিসেবে +1 Emergency Pass পাবেন (সর্বোচ্চ ৫টি)।{"\n"}• প্রতিটি
              Gmail অ্যাকাউন্টের পাস ও স্ট্রিক সম্পূর্ণ আলাদাভাবে ক্লাউডে সেভ থাকে।
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
      {/* MODAL 2: TOP-RIGHT SETTINGS MODAL (Dual YT Quota + Study Channels/Videos + Chrome) */}
      {/* ===================================================================== */}
      <Modal
        visible={settingsModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1 bg-black/80 justify-end"
        >
          <View
            style={{
              paddingBottom:
                keyboardHeight > 0
                  ? keyboardHeight + 16
                  : Math.max(20, insets.bottom + 12),
            }}
            className="bg-slate-900 w-full rounded-t-[32px] px-5 pt-5 border-t border-slate-700 max-h-[92%]"
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

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* 1. System Permissions (Auto-hides once all 3 are granted!) */}
              {!allPermsReady && (
                <>
                  <Text
                    allowFontScaling={false}
                    className="text-rose-400 font-bold text-xs uppercase mb-2"
                  >
                    সিস্টেম পারমিশন বাকি আছে ({missingPermsCount}টি)
                  </Text>
                  <View className="bg-slate-800 p-3.5 rounded-2xl border border-rose-500/30 mb-4 gap-y-2">
                    {!permState.overlay && (
                      <Pressable
                        onPress={() => void FocusLock?.openOverlaySettings?.()}
                        className="flex-row items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700"
                      >
                        <View className="flex-row items-center flex-1 pr-2">
                          <Ionicons
                            name="layers-outline"
                            size={18}
                            color="#F87171"
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
                          className="text-xs font-bold text-indigo-400"
                        >
                          Allow →
                        </Text>
                      </Pressable>
                    )}

                    {!permState.accessibility && (
                      <Pressable
                        onPress={() =>
                          void FocusLock?.openAccessibilitySettings()
                        }
                        className="flex-row items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700"
                      >
                        <View className="flex-row items-center flex-1 pr-2">
                          <Ionicons
                            name="eye-outline"
                            size={18}
                            color="#F87171"
                          />
                          <Text
                            allowFontScaling={false}
                            className="text-white font-bold text-xs ml-2 flex-1"
                          >
                            Accessibility Service (Reels & Shorts Blocker)
                          </Text>
                        </View>
                        <Text
                          allowFontScaling={false}
                          className="text-xs font-bold text-indigo-400"
                        >
                          Allow →
                        </Text>
                      </Pressable>
                    )}

                    {!permState.deviceAdmin && (
                      <Pressable
                        onPress={() =>
                          void FocusLock?.openDeviceAdminSettings?.()
                        }
                        className="flex-row items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700"
                      >
                        <View className="flex-row items-center flex-1 pr-2">
                          <Ionicons
                            name="shield-outline"
                            size={18}
                            color="#FBBF24"
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
                          className="text-xs font-bold text-indigo-400"
                        >
                          Activate →
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </>
              )}

              {/* 🌟 2. General YouTube Daily Limit (15m / 30m / 45m Max) */}
              <Text
                allowFontScaling={false}
                className="text-slate-400 font-bold text-xs uppercase mb-2"
              >
                ১. সাধারণ YouTube ডেইলি লিমিট (General YT • Max 45m)
              </Text>
              <View className="bg-slate-800 p-3.5 rounded-2xl border border-slate-700 mb-4">
                <View className="flex-row gap-2">
                  {[
                    { label: "15m", val: 15 },
                    { label: "30m (Default)", val: 30 },
                    { label: "45m (Max)", val: 45 },
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

              {/* 🌟 3. YouTube Study Channel & Video System (1.5h / 2.5h / 3.5h Max) */}
              <View className="flex-row items-center justify-between mb-2">
                <Text
                  allowFontScaling={false}
                  className="text-emerald-400 font-bold text-xs uppercase"
                >
                  ২. YouTube Study Mode (ক্লাস ও লেকচার লিমিট)
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 font-bold text-[10px]"
                >
                  Max 3.5h/day
                </Text>
              </View>

              <View className="bg-slate-800 p-3.5 rounded-2xl border border-emerald-500/30 mb-4">
                {/* Study Time Limit Pills: 1.5h / 2.5h / 3.5h */}
                <View className="flex-row gap-2 mb-3">
                  {[
                    { label: "1.5h (90m)", val: 90 },
                    { label: "2.5h (150m)", val: 150 },
                    { label: "3.5h (210m)", val: 210 },
                  ].map((opt) => (
                    <Pressable
                      key={opt.val}
                      onPress={() => void updateStudyYtQuota(opt.val)}
                      className={`flex-1 py-2 px-1 rounded-xl items-center justify-center border ${
                        ytStudyLimitMinutes === opt.val
                          ? "bg-emerald-500/20 border-emerald-400"
                          : "bg-slate-900 border-slate-700"
                      }`}
                    >
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className={`text-xs font-bold ${
                          ytStudyLimitMinutes === opt.val
                            ? "text-emerald-300"
                            : "text-slate-400"
                        }`}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* 2-Tab Switcher: Study Channels (স্থায়ী) vs Today's Videos (আজকের) */}
                <View className="flex-row bg-slate-900 p-1 rounded-xl border border-slate-700 mb-3">
                  <Pressable
                    onPress={() => setStudyTab("channels")}
                    className={`flex-1 py-2 px-2 rounded-lg flex-row items-center justify-center ${
                      studyTab === "channels" ? "bg-indigo-600" : ""
                    }`}
                  >
                    <MaterialCommunityIcons
                      name="school-outline"
                      size={14}
                      color={studyTab === "channels" ? "#FFFFFF" : "#94A3B8"}
                    />
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className={`font-bold text-[11px] ml-1.5 ${
                        studyTab === "channels"
                          ? "text-white"
                          : "text-slate-400"
                      }`}
                    >
                      Study Channels ({studyChannels.length}/5)
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setStudyTab("videos")}
                    className={`flex-1 py-2 px-2 rounded-lg flex-row items-center justify-center ${
                      studyTab === "videos" ? "bg-emerald-600" : ""
                    }`}
                  >
                    <Feather
                      name="play-circle"
                      size={13}
                      color={studyTab === "videos" ? "#FFFFFF" : "#94A3B8"}
                    />
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className={`font-bold text-[11px] ml-1.5 ${
                        studyTab === "videos" ? "text-white" : "text-slate-400"
                      }`}
                    >
                      Today&apos;s Videos ({studyVideos.length}/5)
                    </Text>
                  </Pressable>
                </View>

                {/* Input Row */}
                <View className="flex-row gap-2 mb-2.5">
                  <TextInput
                    placeholder={
                      studyTab === "channels"
                        ? "চ্যানেলের নাম (যেমন: Phitron, Apna College)..."
                        : "ক্লাস ভিডিওর Link বা Title পেস্ট করুন..."
                    }
                    placeholderTextColor="#64748B"
                    value={newStudyInput}
                    onChangeText={setNewStudyInput}
                    returnKeyType="done"
                    onSubmitEditing={() => void addStudyItem()}
                    className="flex-1 bg-slate-900 text-white px-3.5 py-2.5 rounded-xl border border-slate-700 text-xs"
                  />
                  <Pressable
                    onPress={() => void addStudyItem()}
                    className={`px-4 rounded-xl items-center justify-center ${
                      studyTab === "channels"
                        ? "bg-indigo-600"
                        : "bg-emerald-600"
                    }`}
                  >
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-xs"
                    >
                      + Add
                    </Text>
                  </Pressable>
                </View>

                {/* List of Study Channels or Today's Videos */}
                {studyTab === "channels" ? (
                  studyChannels.length === 0 ? (
                    <Text
                      allowFontScaling={false}
                      className="text-slate-400 text-[11px] text-center py-2"
                    >
                      কোনো চ্যানেল যোগ করা হয়নি (চ্যানেল নাম স্থায়ীভাবে সেভ থাকবে)
                    </Text>
                  ) : (
                    studyChannels.map((ch) => (
                      <View
                        key={ch}
                        className="flex-row items-center justify-between bg-slate-900 px-3.5 py-2.5 rounded-xl mb-1.5 border border-slate-700/70"
                      >
                        <View className="flex-row items-center flex-1 pr-2">
                          <MaterialCommunityIcons
                            name="school"
                            size={15}
                            color="#818CF8"
                          />
                          <Text
                            allowFontScaling={false}
                            numberOfLines={1}
                            className="text-white font-bold text-xs ml-2 flex-1"
                          >
                            {ch}
                          </Text>
                          <View className="bg-indigo-500/15 px-2 py-0.5 rounded-md mr-2">
                            <Text
                              allowFontScaling={false}
                              className="text-indigo-300 text-[9px] font-bold"
                            >
                              স্থায়ী
                            </Text>
                          </View>
                        </View>
                        <Pressable onPress={() => void removeStudyChannel(ch)}>
                          <Feather name="trash-2" size={14} color="#F43F5E" />
                        </Pressable>
                      </View>
                    ))
                  )
                ) : studyVideos.length === 0 ? (
                  <Text
                    allowFontScaling={false}
                    className="text-slate-400 text-[11px] text-center py-2"
                  >
                    আজকের কোনো ক্লাস ভিডিও নেই (রাত ১২টার পর অটো ক্লিয়ার হয়)
                  </Text>
                ) : (
                  studyVideos.map((vid) => (
                    <View
                      key={vid.id}
                      className="flex-row items-center justify-between bg-slate-900 px-3.5 py-2.5 rounded-xl mb-1.5 border border-slate-700/70"
                    >
                      <View className="flex-row items-center flex-1 pr-2">
                        <Feather
                          name="play-circle"
                          size={14}
                          color="#34D399"
                        />
                        <Text
                          allowFontScaling={false}
                          numberOfLines={1}
                          className="text-white font-bold text-xs ml-2 flex-1"
                        >
                          {vid.title}
                        </Text>
                        <View className="bg-emerald-500/15 px-2 py-0.5 rounded-md mr-2">
                          <Text
                            allowFontScaling={false}
                            className="text-emerald-300 text-[9px] font-bold"
                          >
                            আজ রাত ১২টা
                          </Text>
                        </View>
                      </View>
                      <Pressable onPress={() => void removeStudyVideo(vid.id)}>
                        <Feather name="trash-2" size={14} color="#F43F5E" />
                      </Pressable>
                    </View>
                  ))
                )}
              </View>

              {/* 4. Chrome Allowed Websites (Max 5 Sites, No YouTube) */}
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
                    returnKeyType="done"
                    onSubmitEditing={() => void addDomain()}
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
                    <View className="flex-row items-center flex-1 pr-2">
                      <MaterialCommunityIcons
                        name="web"
                        size={15}
                        color="#38BDF8"
                      />
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-white font-medium text-xs ml-2 flex-1"
                      >
                        {dom}
                      </Text>
                    </View>
                    <Pressable onPress={() => void removeDomain(dom)}>
                      <Feather name="trash-2" size={15} color="#F43F5E" />
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 3: DAILY SCHEDULE LOCK MANAGER MODAL (Max 15h + 10h/12h Warning) */}
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
            {/* Balanced Header */}
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-1 pr-3">
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-white font-black text-lg"
                >
                  Daily Schedule Lock ({schedules.length}/4)
                </Text>
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-slate-400 text-[11px] mt-0.5"
                >
                  সর্বোচ্চ ১৫ ঘণ্টা সীমা (১০/১২ ঘণ্টার ওপরে সতর্কতা দেখাবে)
                </Text>
              </View>

              <View className="flex-row items-center gap-2.5 flex-shrink-0 mr-1">
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
                    className="bg-indigo-600/25 border border-indigo-500/50 px-3.5 py-2 rounded-xl flex-row items-center"
                  >
                    <Feather name="plus" size={13} color="#A5B4FC" />
                    <Text
                      allowFontScaling={false}
                      className="text-indigo-200 font-bold text-xs ml-1"
                    >
                      নতুন
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setScheduleModalVisible(false)}
                  className="h-9 w-9 bg-slate-800 rounded-full items-center justify-center border border-slate-700"
                >
                  <Ionicons name="close" size={18} color="#94A3B8" />
                </Pressable>
              </View>
            </View>

            {/* 50m Focus + 10m Break Toggle inside Modal */}
            <View className="bg-slate-800 p-3.5 rounded-2xl border border-slate-700 flex-row items-center justify-between mb-3">
              <View className="flex-row items-center flex-1 pr-2">
                <MaterialCommunityIcons
                  name="coffee-outline"
                  size={18}
                  color="#34D399"
                />
                <View className="ml-2.5 flex-1">
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-xs"
                  >
                    50m Lock + 10m Break Cycle
                  </Text>
                  <Text
                    allowFontScaling={false}
                    className="text-slate-400 text-[10px]"
                  >
                    শিডিউল লকে প্রতি ৫০ মিনিট পর ১০ মিনিট ফ্রি ব্রেক (Reels ব্লকড)
                  </Text>
                </View>
              </View>
              <Switch
                value={scheduleBreakEnabled}
                onValueChange={(v) => void toggleScheduleBreak(v)}
                trackColor={{ false: "#334155", true: "#10B981" }}
                thumbColor="#FFFFFF"
              />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="mb-3">
              {schedules.map((schedule, index) => {
                const durMins = getScheduleDurationMinutes(
                  schedule.startTime,
                  schedule.endTime,
                );
                const isOverMax = durMins > MAX_SCHEDULE_MINUTES;
                const isLongWarn =
                  durMins > WARN_SCHEDULE_MINUTES &&
                  durMins <= MAX_SCHEDULE_MINUTES;
                return (
                  <View
                    key={schedule.id}
                    className={`bg-slate-800 p-4 rounded-3xl border mb-3 ${
                      isOverMax
                        ? "border-rose-500"
                        : isLongWarn
                          ? "border-amber-500/60"
                          : "border-slate-700"
                    }`}
                  >
                    <View className="flex-row items-center justify-between mb-3">
                      <View>
                        <Text
                          allowFontScaling={false}
                          className="text-white font-bold text-sm"
                        >
                          Schedule {index + 1}
                        </Text>
                        <Text
                          allowFontScaling={false}
                          className={`text-[10px] font-bold ${
                            isOverMax
                              ? "text-rose-400"
                              : isLongWarn
                                ? "text-amber-400"
                                : "text-emerald-400"
                          }`}
                        >
                          সময়কাল: {(durMins / 60).toFixed(1)} ঘণ্টা{" "}
                          {isLongWarn ? "(১০+ ঘণ্টা দীর্ঘ লক)" : "(Max 15h)"}
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
                        thumbColor="#FFFFFF"
                      />
                    </View>

                    <View className="bg-slate-900/70 p-3 rounded-2xl border border-slate-700/50 mb-3 flex-row items-center justify-between">
                      <Pressable
                        onPress={() => {
                          setEditingSchedule({
                            id: schedule.id,
                            type: "start",
                          });
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
                      <Ionicons
                        name="arrow-forward"
                        size={16}
                        color="#475569"
                      />
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
                        <Feather name="trash-2" size={13} color="#EF4444" />
                        <Text className="text-rose-500 font-bold text-xs ml-1.5">
                          মুছে ফেলুন
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => {
                setScheduleModalVisible(false);
                void saveAllSchedules(schedules, false);
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
      {/* MODAL 5: MODERN CUSTOM SCHEDULE SAVED POPUP MODAL                     */}
      {/* ===================================================================== */}
      <Modal
        visible={scheduleSavedModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setScheduleSavedModal((prev) => ({ ...prev, visible: false }))
        }
      >
        <View className="flex-1 bg-black/80 justify-center items-center px-6">
          <View className="bg-[#131C31] w-full rounded-3xl p-6 border border-indigo-500/40 items-center shadow-2xl">
            <View
              className={`w-16 h-16 rounded-2xl items-center justify-center mb-4 border ${
                scheduleSavedModal.hasEnabled
                  ? "bg-emerald-500/20 border-emerald-400/50"
                  : "bg-indigo-500/20 border-indigo-400/50"
              }`}
            >
              <MaterialCommunityIcons
                name={
                  scheduleSavedModal.hasEnabled
                    ? "calendar-check"
                    : "calendar-clock"
                }
                size={34}
                color={scheduleSavedModal.hasEnabled ? "#34D399" : "#818CF8"}
              />
            </View>

            <Text
              allowFontScaling={false}
              className="text-white font-black text-lg text-center mb-1.5"
            >
              {scheduleSavedModal.hasEnabled
                ? "Schedule Lock অ্যাক্টিভেট হয়েছে!"
                : "Schedule ড্রাফট সেভ হয়েছে"}
            </Text>

            <Text
              allowFontScaling={false}
              className="text-slate-300 text-xs text-center leading-5 mb-4"
            >
              {scheduleSavedModal.hasEnabled
                ? `আপনার ${scheduleSavedModal.activeCount}টি শিডিউল সচল করা হয়েছে। নির্ধারিত সময়ে প্রতিদিন অটোমেটিক কড়া লক (সর্বোচ্চ ১৫ ঘণ্টা) চালু হয়ে যাবে এবং ক্লাউডে ব্যাকআপ রাখা হয়েছে।`
                : "আপনার শিডিউল ক্লাউডে সেভ হয়েছে (বর্তমানে সুইচ অফ করা আছে)।"}
            </Text>

            <View className="w-full bg-[#0B1120] p-3 rounded-2xl border border-slate-800 flex-row items-center justify-between mb-5">
              <View className="flex-row items-center">
                <MaterialCommunityIcons
                  name="coffee-outline"
                  size={16}
                  color="#34D399"
                />
                <Text
                  allowFontScaling={false}
                  className="text-slate-300 font-bold text-xs ml-2"
                >
                  ব্রেক মোড:
                </Text>
              </View>
              <Text
                allowFontScaling={false}
                className="text-emerald-400 font-black text-xs"
              >
                {scheduleBreakEnabled
                  ? "50m Lock + 10m Break ON"
                  : "একটানা লক (No Break)"}
              </Text>
            </View>

            <Pressable
              onPress={() =>
                setScheduleSavedModal((prev) => ({ ...prev, visible: false }))
              }
              className="w-full bg-indigo-600 py-3.5 rounded-2xl items-center active:bg-indigo-700"
            >
              <Text
                allowFontScaling={false}
                className="text-white font-black text-xs tracking-wider uppercase"
              >
                Awesome • ঠিক আছে
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 4: APP PICKER MODAL (MAX 6 APPS + Keyboard-Safe!)               */}
      {/* ===================================================================== */}
      <Modal visible={appModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1 bg-black/75 justify-end"
        >
          <View
            style={{
              paddingBottom:
                keyboardHeight > 0
                  ? keyboardHeight + 14
                  : Math.max(20, insets.bottom + 12),
            }}
            className="bg-slate-900 w-full rounded-t-[28px] px-5 pt-5 border-t border-slate-700 max-h-[88%]"
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
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                className="mb-3"
              >
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
                          <MaterialCommunityIcons
                            name="application"
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
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================== */}
      {/* UNIVERSAL MODERN CUSTOM ALERT / WARNING MODAL (Replaces Alert.alert!) */}
      {/* ===================================================================== */}
      <Modal
        visible={uiModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setUiModal((prev) => ({ ...prev, visible: false }))
        }
      >
        <View className="flex-1 bg-black/80 justify-center items-center px-6">
          <View className="bg-[#131C31] w-full rounded-3xl p-6 border border-slate-700 items-center shadow-2xl">
            <View
              style={{
                backgroundColor: `${uiModal.color}20`,
                borderColor: `${uiModal.color}50`,
              }}
              className="w-16 h-16 rounded-2xl items-center justify-center mb-4 border"
            >
              <MaterialCommunityIcons
                name={uiModal.icon}
                size={34}
                color={uiModal.color}
              />
            </View>
            <Text
              allowFontScaling={false}
              className="text-white font-black text-lg text-center mb-2"
            >
              {uiModal.title}
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-300 text-xs text-center leading-5 mb-5"
            >
              {uiModal.message}
            </Text>

            {uiModal.onConfirm ? (
              <View className="flex-row gap-3 w-full">
                <Pressable
                  onPress={() =>
                    setUiModal((prev) => ({ ...prev, visible: false }))
                  }
                  className="flex-1 bg-slate-800 py-3.5 rounded-2xl items-center border border-slate-700"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-slate-200 font-bold text-xs"
                  >
                    {uiModal.cancelText || "বাতিল"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const fn = uiModal.onConfirm;
                    setUiModal((prev) => ({ ...prev, visible: false }));
                    if (fn) fn();
                  }}
                  className="flex-1 bg-indigo-600 py-3.5 rounded-2xl items-center active:bg-indigo-700"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-white font-black text-xs"
                  >
                    {uiModal.confirmText || "নিশ্চিত করুন"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() =>
                  setUiModal((prev) => ({ ...prev, visible: false }))
                }
                className="w-full bg-indigo-600 py-3.5 rounded-2xl items-center active:bg-indigo-700"
              >
                <Text
                  allowFontScaling={false}
                  className="text-white font-black text-xs uppercase tracking-wider"
                >
                  ঠিক আছে
                </Text>
              </Pressable>
            )}
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
              const target = schedules.find((s) => s.id === editingSchedule.id);
              if (target) {
                const nextStart =
                  editingSchedule.type === "start" ? date : target.startTime;
                const nextEnd =
                  editingSchedule.type === "end" ? date : target.endTime;
                const durMins = getScheduleDurationMinutes(nextStart, nextEnd);
                if (durMins > MAX_SCHEDULE_MINUTES) {
                  showModernNotice(
                    "সর্বোচ্চ ১৫ ঘণ্টার সীমা (Max 15h)",
                    `আপনি ${(durMins / 60).toFixed(1)} ঘণ্টার ব্যবধান দিয়েছেন। নিরাপত্তার জন্য Schedule Lock একটানা সর্বোচ্চ ১৫ ঘণ্টার (৯০০ মিনিট) বেশি সেট করা যাবে না।`,
                    "clock-alert-outline",
                    "#F43F5E",
                  );
                  setEditingSchedule(null);
                  return;
                }
                if (durMins > WARN_SCHEDULE_MINUTES) {
                  showModernNotice(
                    "দীর্ঘ শিডিউল লকের সতর্কতা (১০+ ঘণ্টা)",
                    `আপনি ${(durMins / 60).toFixed(1)} ঘণ্টার একটি দীর্ঘ শিডিউল সেট করেছেন (১০/১২ ঘণ্টার বেশি)। এই পুরো সময় ফোন কড়া লকে থাকবে।`,
                    "alert-decagram-outline",
                    "#FBBF24",
                  );
                }
              }

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
