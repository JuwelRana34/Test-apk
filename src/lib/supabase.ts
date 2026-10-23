import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { NativeModules, PermissionsAndroid, Platform } from "react-native";

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL as string) || "https://placeholder.supabase.co";
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string) || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

const { FocusLock } = NativeModules;

// ============================================================================
// NOTIFICATIONS ENGINE (100% Online Expo Push + Offline Local Scheduled @ 7 PM)
// ============================================================================

export const CONTACT_REMINDER_CHANNEL = "contact-reminders-v2";
export const FOCUS_LOCK_CHANNEL = "focus-lock-alerts";
export const IN_APP_NOTICES_KEY = "@jnuits_in_app_notices";
export const EXPO_PUSH_TOKEN_KEY = "@jnuits_expo_push_token";
export const ACTIVE_USER_ID_KEY = "@jnuits_active_user_id";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface AppNoticeItem {
  id: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  type: "contact" | "lock" | "system";
  contactId?: string;
  phoneNumber?: string;
}

export interface ContactForNotification {
  id: string;
  name: string;
  phoneNumber: string;
  category: "family" | "friends" | "network";
  lastCalledAt: number;
  nextDueDate: number;
  note?: string;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function ensureNotificationChannelsAndPermissions(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      if (Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
      }

      await Notifications.setNotificationChannelAsync(
        CONTACT_REMINDER_CHANNEL,
        {
          name: "Contact Relationship Reminders",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#4F46E5",
          sound: "default",
          bypassDnd: true,
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        },
      );

      await Notifications.setNotificationChannelAsync(FOCUS_LOCK_CHANNEL, {
        name: "Focus Lock & Pass Alerts",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 150, 200],
        lightColor: "#F43F5E",
        sound: "default",
      });
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === "granted";
  } catch (error) {
    console.warn("Notification permission error:", error);
    return false;
  }
}

export async function registerExpoPushTokenOnlineOffline(): Promise<
  string | null
> {
  try {
    const granted = await ensureNotificationChannelsAndPermissions();
    if (!granted) return null;

    const cachedToken = await AsyncStorage.getItem(EXPO_PUSH_TOKEN_KEY);

    if (!Device.isDevice) {
      return cachedToken;
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;

    const tokenResult = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenResult?.data;
    if (token) {
      await AsyncStorage.setItem(EXPO_PUSH_TOKEN_KEY, token);
      try {
        await supabase.auth.updateUser({
          data: { expo_push_token: token },
        });
      } catch {}
      return token;
    }
    return cachedToken;
  } catch {
    return await AsyncStorage.getItem(EXPO_PUSH_TOKEN_KEY);
  }
}

export function getCategoryBanglaName(
  cat: "family" | "friends" | "network",
): string {
  switch (cat) {
    case "family":
      return "পরিবার ও ভিআইপি (Category 1)";
    case "friends":
      return "ঘনিষ্ঠ বন্ধু (Category 2)";
    case "network":
      return "পরিচিত ও নেটওয়ার্ক (Category 3)";
  }
}

export async function scheduleContactNotificationsOffline(
  contacts: ContactForNotification[],
): Promise<void> {
  try {
    const granted = await ensureNotificationChannelsAndPermissions();
    if (!granted) return;

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      if (
        item.identifier.startsWith("contact-due-") ||
        item.identifier === "daily-contact-morning" ||
        item.identifier === "daily-contact-evening"
      ) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }

    if (contacts.length === 0) return;

    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);

    const dueToday = contacts.filter(
      (c) => new Date(c.nextDueDate).setHours(0, 0, 0, 0) <= todayStart,
    );

    if (dueToday.length > 0) {
      const namesList = dueToday
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ");
      const primary = dueToday[0];
      const catLabel = getCategoryBanglaName(primary.category);

      const title =
        dueToday.length === 1
          ? `আজ ${primary.name}-এর খোঁজ নেওয়ার দিন!`
          : `আজ ${dueToday.length} জন পরিচিতের খোঁজ নেওয়ার দিন!`;

      const body =
        dueToday.length === 1
          ? `আপনার ${catLabel} লিস্টের "${primary.name}"-এর সাথে আজ যোগাযোগ করার কথা।${primary.note ? ` নোট: ${primary.note}` : ""}`
          : `আজ কথা বলার তালিকায় আছেন: ${namesList}। সম্পর্ক সতেজ রাখতে একটা কল বা মেসেজ দিন!`;

      await Notifications.scheduleNotificationAsync({
        identifier: "daily-contact-evening",
        content: {
          title,
          body,
          sound: "default",
          data: {
            screen: "/features/SmartNetworking",
            contactId: primary.id,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 19,
          minute: 0,
          channelId: CONTACT_REMINDER_CHANNEL,
        },
      });

      await addInAppNotice({
        id: `due-${todayStart}-${primary.id}`,
        title,
        message: body,
        timestamp: Date.now(),
        read: false,
        type: "contact",
        contactId: primary.id,
        phoneNumber: primary.phoneNumber,
      });
    }

    for (const contact of contacts.slice(0, 35)) {
      const triggerDate = new Date(contact.nextDueDate);
      triggerDate.setHours(19, 0, 0, 0);

      if (triggerDate.getTime() > now + 60 * 1000) {
        const catLabel = getCategoryBanglaName(contact.category);
        await Notifications.scheduleNotificationAsync({
          identifier: `contact-due-${contact.id}`,
          content: {
            title: `আজ ${contact.name}-এর সাথে কথা বলার দিন!`,
            body: `${catLabel} তালিকায় থাকা ${contact.name}-এর সাথে যোগাযোগ করে সম্পর্ক ভালো রাখুন।${contact.note ? ` (${contact.note})` : ""}`,
            sound: "default",
            data: {
              screen: "/features/SmartNetworking",
              contactId: contact.id,
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
            channelId: CONTACT_REMINDER_CHANNEL,
          },
        });
      }
    }
  } catch (error) {
    console.warn("Failed to schedule offline contact notifications:", error);
  }
}

export async function triggerInstantContactNotification(
  contactName?: string,
  categoryLabel?: string,
): Promise<boolean> {
  try {
    const granted = await ensureNotificationChannelsAndPermissions();
    if (!granted) return false;

    const name = contactName || "তানভীর আহমেদ";
    const cat = categoryLabel || "ঘনিষ্ঠ বন্ধু (Category 2)";

    const title = `আজ ${name}-এর খোঁজ নেওয়ার দিন!`;
    const body = `আপনার ${cat} লিস্টের "${name}"-এর সাথে কথা বলার সময় হয়েছে। এখনই একটি কল বা WhatsApp মেসেজ দিন!`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
        data: { screen: "/features/SmartNetworking" },
      },
      trigger: null,
    });

    await addInAppNotice({
      id: `test-${Date.now()}`,
      title,
      message: body,
      timestamp: Date.now(),
      read: false,
      type: "contact",
    });

    return true;
  } catch (error) {
    console.warn("Instant notification failed:", error);
    return false;
  }
}

export async function addInAppNotice(notice: AppNoticeItem): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(IN_APP_NOTICES_KEY);
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const list: AppNoticeItem[] = raw
      ? (JSON.parse(raw) as AppNoticeItem[]).filter((n) => n.timestamp >= cutoff)
      : [];
    const exists = list.some((n) => n.id === notice.id);
    if (exists) return;
    const updated = [notice, ...list].slice(0, 50);
    await AsyncStorage.setItem(IN_APP_NOTICES_KEY, JSON.stringify(updated));
  } catch {}
}

export async function getInAppNotices(): Promise<AppNoticeItem[]> {
  try {
    const raw = await AsyncStorage.getItem(IN_APP_NOTICES_KEY);
    if (raw !== null) {
      const parsed: AppNoticeItem[] = JSON.parse(raw);
      const cutoff = Date.now() - SEVEN_DAYS_MS;
      const pruned = parsed.filter((n) => n.timestamp >= cutoff);
      if (pruned.length !== parsed.length) {
        await AsyncStorage.setItem(IN_APP_NOTICES_KEY, JSON.stringify(pruned));
      }
      return pruned;
    }
  } catch {}
  const initial: AppNoticeItem[] = [
    {
      id: "welcome-1",
      title: "Focus Lock & Smart CRM Ready",
      message:
        "২৫+৫ মিনিটের সেশন লক, ৫০+১০ মিনিটের শিডিউল লক, ০-৫ ইমার্জেন্সি পাস এবং ৩-ক্যাটাগরির কন্টাক্ট রিমাইন্ডার প্রস্তুত!",
      timestamp: Date.now() - 3600 * 1000,
      read: false,
      type: "system",
    },
  ];
  try {
    await AsyncStorage.setItem(IN_APP_NOTICES_KEY, JSON.stringify(initial));
  } catch {}
  return initial;
}

export async function markAllInAppNoticesRead(): Promise<AppNoticeItem[]> {
  try {
    const list = await getInAppNotices();
    const updated = list.map((n) => ({ ...n, read: true }));
    await AsyncStorage.setItem(IN_APP_NOTICES_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export async function deleteInAppNotice(id: string): Promise<AppNoticeItem[]> {
  try {
    const list = await getInAppNotices();
    const updated = list.filter((n) => n.id !== id);
    await AsyncStorage.setItem(IN_APP_NOTICES_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export async function clearAllInAppNotices(): Promise<void> {
  try {
    await AsyncStorage.setItem(IN_APP_NOTICES_KEY, JSON.stringify([]));
  } catch {}
}

// ============================================================================
// 100% ACCOUNT-WISE ISOLATION & CLOUD BACKUP ENGINE
// ============================================================================

export const OFFLINE_SYNC_QUEUE_KEY = "@jnuits_offline_dirty_flag";
export const CACHED_USER_PROFILE_KEY = "@jnuits_cached_google_profile";

export interface CachedUserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  emergencyPasses: number;
  streakDays: number;
  lastSyncedAt: number;
}

/**
 * 🌟 Completely clears previous Gmail's local AsyncStorage and native SharedPreferences
 * so logging in with a new Gmail NEVER inherits the previous account's passes, streak, contacts, or schedules!
 */
export async function clearAllLocalAccountData(
  newUserId: string = "",
): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      "@networking_contacts",
      "@networking_stats",
      "@focus_allowed_apps",
      "@focus_allowed_domains",
      "@focus_multi_schedules",
      "@focus_yt_limit_minutes",
      "@focus_yt_study_limit_minutes",
      "@focus_yt_study_channels",
      "@focus_yt_study_videos",
      "@focus_schedule_break_enabled",
      IN_APP_NOTICES_KEY,
      CACHED_USER_PROFILE_KEY,
      OFFLINE_SYNC_QUEUE_KEY,
    ]);

    if (newUserId) {
      await AsyncStorage.setItem(ACTIVE_USER_ID_KEY, newUserId);
    } else {
      await AsyncStorage.multiRemove([ACTIVE_USER_ID_KEY, "@is_logged_in"]);
    }

    if (Platform.OS === "android" && FocusLock?.resetLocalAccountData) {
      await FocusLock.resetLocalAccountData(newUserId);
    }

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      if (
        item.identifier.startsWith("contact-due-") ||
        item.identifier === "daily-contact-morning" ||
        item.identifier === "daily-contact-evening"
      ) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
  } catch {}
}

/**
 * Anti-Cheat Online Pass Spending Check
 */
export async function spendEmergencyPassWithCloudCheck(): Promise<boolean> {
  try {
    if (Platform.OS !== "android" || !FocusLock?.getFocusSessionState) {
      return false;
    }

    const s = await FocusLock.getFocusSessionState();
    const localEarned = s.totalPassesEarned ?? s.emergencyPasses ?? 0;
    const localUsed = s.totalPassesUsed ?? 0;
    if (localEarned - localUsed <= 0) return false;

    const nextUsed = localUsed + 1;
    const nextPasses = Math.max(0, Math.min(5, localEarned - nextUsed));

    const {
      data: { user },
      error: getError,
    } = await supabase.auth.getUser();

    if (getError || !user) {
      return false;
    }

    const existingBackup = user.user_metadata?.jnuits_backup_v2 || {};
    const mergedEarned = Math.max(
      localEarned,
      existingBackup.totalPassesEarned ?? existingBackup.emergencyPasses ?? 0,
    );
    const mergedUsed = Math.max(nextUsed, (existingBackup.totalPassesUsed ?? 0) + 1);
    const finalPasses = Math.max(0, Math.min(5, mergedEarned - mergedUsed));

    const { error: updateErr } = await supabase.auth.updateUser({
      data: {
        jnuits_backup_v2: {
          ...existingBackup,
          updatedAt: Date.now(),
          totalPassesEarned: mergedEarned,
          totalPassesUsed: mergedUsed,
          emergencyPasses: finalPasses,
          streakDays: 0,
        },
      },
    });

    if (updateErr) {
      return false;
    }

    return nextPasses >= 0;
  } catch {
    return false;
  }
}

export async function syncLocalDataToCloudIfOnline(): Promise<boolean> {
  try {
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    if (!currentUser) return false;

    // 🌟 Account Switch Guard: If stored user ID differs from current logged-in Gmail, reset local state and restore ONLY this account's cloud data!
    const storedUserId = await AsyncStorage.getItem(ACTIVE_USER_ID_KEY);
    if (storedUserId && storedUserId !== currentUser.id) {
      await restoreCloudBackupAfterGoogleLogin();
      return true;
    }
    if (!storedUserId) {
      await AsyncStorage.setItem(ACTIVE_USER_ID_KEY, currentUser.id);
    }

    let [
      contactsRaw,
      statsRaw,
      allowedAppsRaw,
      allowedDomainsRaw,
      schedulesRaw,
      ytLimitRaw,
      ytStudyLimitRaw,
      studyChannelsRaw,
    ] = await Promise.all([
      AsyncStorage.getItem("@networking_contacts"),
      AsyncStorage.getItem("@networking_stats"),
      AsyncStorage.getItem("@focus_allowed_apps"),
      AsyncStorage.getItem("@focus_allowed_domains"),
      AsyncStorage.getItem("@focus_multi_schedules"),
      AsyncStorage.getItem("@focus_yt_limit_minutes"),
      AsyncStorage.getItem("@focus_yt_study_limit_minutes"),
      AsyncStorage.getItem("@focus_yt_study_channels"),
    ]);

    const todayIso = new Date().toISOString().split("T")[0];

    let nativeLockState = {
      emergencyPasses: 0,
      totalPassesEarned: 0,
      totalPassesUsed: 0,
      streakDays: 0,
      totalCompleted: 0,
      lastCompletedDate: "",
      completedHistoryJson: "{}",
      ytUsedSeconds: 0,
      ytStudyUsedSeconds: 0,
      ytUsageDate: todayIso,
    };

    if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
      try {
        const s = await FocusLock.getFocusSessionState();
        nativeLockState = {
          emergencyPasses: s.emergencyPasses ?? 0,
          totalPassesEarned: s.totalPassesEarned ?? s.emergencyPasses ?? 0,
          totalPassesUsed: s.totalPassesUsed ?? 0,
          streakDays: s.streakDays ?? 0,
          totalCompleted: s.totalCompleted ?? 0,
          lastCompletedDate: s.lastCompletedDate || "",
          completedHistoryJson: s.completedHistoryJson || "{}",
          ytUsedSeconds: s.ytUsedSeconds ?? 0,
          ytStudyUsedSeconds: s.ytStudyUsedSeconds ?? 0,
          ytUsageDate: s.ytUsageDate || todayIso,
        };
      } catch {}
    }

    await AsyncStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, "true");

    const cloudBackup = currentUser.user_metadata?.jnuits_backup_v2 || {};

    if (
      (!schedulesRaw || schedulesRaw === "[]") &&
      Array.isArray(cloudBackup.schedules) &&
      cloudBackup.schedules.length > 0
    ) {
      schedulesRaw = JSON.stringify(cloudBackup.schedules);
      await AsyncStorage.setItem("@focus_multi_schedules", schedulesRaw);
    }

    if (
      (!allowedAppsRaw || allowedAppsRaw === "[]") &&
      Array.isArray(cloudBackup.allowedApps) &&
      cloudBackup.allowedApps.length > 0
    ) {
      allowedAppsRaw = JSON.stringify(cloudBackup.allowedApps);
      await AsyncStorage.setItem("@focus_allowed_apps", allowedAppsRaw);
      if (Platform.OS === "android" && FocusLock?.saveAllowedApps) {
        await FocusLock.saveAllowedApps(cloudBackup.allowedApps);
      }
    }

    if (
      (!allowedDomainsRaw || allowedDomainsRaw === "[]") &&
      Array.isArray(cloudBackup.allowedDomains) &&
      cloudBackup.allowedDomains.length > 0
    ) {
      allowedDomainsRaw = JSON.stringify(cloudBackup.allowedDomains);
      await AsyncStorage.setItem("@focus_allowed_domains", allowedDomainsRaw);
      if (Platform.OS === "android" && FocusLock?.saveAllowedDomains) {
        await FocusLock.saveAllowedDomains(cloudBackup.allowedDomains);
      }
    }

    if (
      (!studyChannelsRaw || studyChannelsRaw === "[]") &&
      Array.isArray(cloudBackup.studyChannels) &&
      cloudBackup.studyChannels.length > 0
    ) {
      studyChannelsRaw = JSON.stringify(cloudBackup.studyChannels);
      await AsyncStorage.setItem("@focus_yt_study_channels", studyChannelsRaw);
    }

    const cloudEarned =
      cloudBackup.totalPassesEarned ?? cloudBackup.emergencyPasses ?? 0;
    const cloudUsed = cloudBackup.totalPassesUsed ?? 0;
    const cloudLastDate = cloudBackup.lastCompletedDate || "";
    const cloudStreak = cloudBackup.streakDays ?? 0;

    const mergedEarned = Math.max(nativeLockState.totalPassesEarned, cloudEarned);
    const mergedUsed = Math.max(nativeLockState.totalPassesUsed, cloudUsed);
    const mergedPasses = Math.max(0, Math.min(5, mergedEarned - mergedUsed));

    let mergedLastDate = nativeLockState.lastCompletedDate;
    let mergedStreak = nativeLockState.streakDays;
    if (cloudLastDate > mergedLastDate) {
      mergedLastDate = cloudLastDate;
      mergedStreak = cloudStreak;
    } else if (cloudLastDate === mergedLastDate && mergedLastDate !== "") {
      mergedStreak = Math.max(mergedStreak, cloudStreak);
    }

    let localHistoryObj: Record<string, number> = {};
    try {
      localHistoryObj = JSON.parse(nativeLockState.completedHistoryJson || "{}");
    } catch {}
    const cloudHistoryObj: Record<string, number> =
      cloudBackup.completedHistory || {};
    const mergedHistoryObj: Record<string, number> = { ...cloudHistoryObj };
    Object.keys(localHistoryObj).forEach((k) => {
      mergedHistoryObj[k] = Math.max(
        mergedHistoryObj[k] || 0,
        localHistoryObj[k] || 0,
      );
    });
    const mergedHistoryJson = JSON.stringify(mergedHistoryObj);

    const mergedTotalCompleted = Math.max(
      nativeLockState.totalCompleted,
      cloudBackup.totalCompleted ?? 0,
      Object.keys(mergedHistoryObj).length,
    );

    const activeDate = nativeLockState.ytUsageDate || todayIso;
    const cloudYtDate = cloudBackup.ytUsageDate || "";
    const cloudYtSecs =
      cloudYtDate === activeDate ? (cloudBackup.ytUsedSeconds ?? 0) : 0;
    const mergedYtUsedSeconds = Math.max(
      nativeLockState.ytUsedSeconds,
      cloudYtSecs,
    );

    const cloudStudySecs =
      cloudYtDate === activeDate ? (cloudBackup.ytStudyUsedSeconds ?? 0) : 0;
    const mergedYtStudyUsedSeconds = Math.max(
      nativeLockState.ytStudyUsedSeconds,
      cloudStudySecs,
    );

    if (Platform.OS === "android" && FocusLock?.syncPassAndStreakFromCloud) {
      await FocusLock.syncPassAndStreakFromCloud(
        mergedPasses,
        mergedStreak,
        mergedLastDate,
        mergedEarned,
        mergedUsed,
        mergedHistoryJson,
        mergedTotalCompleted,
        activeDate,
        mergedYtUsedSeconds,
        mergedYtStudyUsedSeconds,
      );
    }

    const cachedRaw = await AsyncStorage.getItem(CACHED_USER_PROFILE_KEY);
    if (cachedRaw) {
      const cached: CachedUserProfile = JSON.parse(cachedRaw);
      cached.emergencyPasses = mergedPasses;
      cached.streakDays = mergedStreak;
      await AsyncStorage.setItem(
        CACHED_USER_PROFILE_KEY,
        JSON.stringify(cached),
      );
    }

    const payload = {
      jnuits_backup_v2: {
        updatedAt: Date.now(),
        contacts: contactsRaw
          ? JSON.parse(contactsRaw)
          : cloudBackup.contacts || [],
        networkingStats: statsRaw
          ? JSON.parse(statsRaw)
          : cloudBackup.networkingStats || null,
        allowedApps: allowedAppsRaw
          ? JSON.parse(allowedAppsRaw)
          : cloudBackup.allowedApps || [],
        allowedDomains: allowedDomainsRaw
          ? JSON.parse(allowedDomainsRaw)
          : cloudBackup.allowedDomains || [],
        schedules: schedulesRaw
          ? JSON.parse(schedulesRaw)
          : cloudBackup.schedules || [],
        ytLimitMinutes: ytLimitRaw
          ? parseInt(ytLimitRaw, 10)
          : cloudBackup.ytLimitMinutes || 30,
        ytStudyLimitMinutes: ytStudyLimitRaw
          ? parseInt(ytStudyLimitRaw, 10)
          : cloudBackup.ytStudyLimitMinutes || 210,
        studyChannels: studyChannelsRaw
          ? JSON.parse(studyChannelsRaw)
          : cloudBackup.studyChannels || [],
        ytUsageDate: activeDate,
        ytUsedSeconds: mergedYtUsedSeconds,
        ytStudyUsedSeconds: mergedYtStudyUsedSeconds,
        emergencyPasses: mergedPasses,
        totalPassesEarned: mergedEarned,
        totalPassesUsed: mergedUsed,
        streakDays: mergedStreak,
        lastCompletedDate: mergedLastDate,
        completedHistory: mergedHistoryObj,
        totalCompleted: mergedTotalCompleted,
      },
    };

    const { data, error } = await supabase.auth.updateUser({
      data: payload,
    });

    if (!error && data?.user) {
      await AsyncStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, "false");
      const updatedProfile: CachedUserProfile = {
        id: data.user.id,
        name:
          data.user.user_metadata?.full_name ||
          data.user.user_metadata?.name ||
          "JnUITS Member",
        email: data.user.email || "",
        avatarUrl:
          data.user.user_metadata?.avatar_url ||
          data.user.user_metadata?.picture,
        emergencyPasses: mergedPasses,
        streakDays: mergedStreak,
        lastSyncedAt: Date.now(),
      };
      await AsyncStorage.setItem(
        CACHED_USER_PROFILE_KEY,
        JSON.stringify(updatedProfile),
      );
      return true;
    }

    return false;
  } catch {
    await AsyncStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, "true");
    return false;
  }
}

export async function restoreCloudBackupAfterGoogleLogin(): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // 🌟 100% Account-Wise Isolation: If switching Gmails or logging into a new account, wipe all previous local & native data first!
    const previousUserId = await AsyncStorage.getItem(ACTIVE_USER_ID_KEY);
    if (previousUserId !== user.id) {
      await clearAllLocalAccountData(user.id);
    }

    const backup = user.user_metadata?.jnuits_backup_v2;

    if (backup) {
      if (Array.isArray(backup.contacts) && backup.contacts.length > 0) {
        await AsyncStorage.setItem(
          "@networking_contacts",
          JSON.stringify(backup.contacts),
        );
      }

      if (backup.networkingStats) {
        await AsyncStorage.setItem(
          "@networking_stats",
          JSON.stringify(backup.networkingStats),
        );
      }

      const appsToUse: string[] = Array.isArray(backup.allowedApps)
        ? backup.allowedApps
        : [];
      if (appsToUse.length > 0) {
        await AsyncStorage.setItem(
          "@focus_allowed_apps",
          JSON.stringify(appsToUse),
        );
        if (Platform.OS === "android" && FocusLock?.saveAllowedApps) {
          await FocusLock.saveAllowedApps(appsToUse);
        }
      }

      if (
        Array.isArray(backup.allowedDomains) &&
        backup.allowedDomains.length > 0
      ) {
        await AsyncStorage.setItem(
          "@focus_allowed_domains",
          JSON.stringify(backup.allowedDomains),
        );
        if (Platform.OS === "android" && FocusLock?.saveAllowedDomains) {
          await FocusLock.saveAllowedDomains(backup.allowedDomains);
        }
      }

      const rawGeneralLim = backup.ytLimitMinutes || 30;
      const ytLimit = [15, 30, 45].includes(rawGeneralLim) ? rawGeneralLim : 30;
      await AsyncStorage.setItem("@focus_yt_limit_minutes", String(ytLimit));
      if (Platform.OS === "android" && FocusLock?.setYouTubeLimitMinutes) {
        await FocusLock.setYouTubeLimitMinutes(ytLimit);
      }

      const rawStudyLim = backup.ytStudyLimitMinutes || 210;
      const studyLimit = [90, 150, 210].includes(rawStudyLim)
        ? rawStudyLim
        : 210;
      await AsyncStorage.setItem(
        "@focus_yt_study_limit_minutes",
        String(studyLimit),
      );

      const channelsToUse: string[] = Array.isArray(backup.studyChannels)
        ? backup.studyChannels
        : [];
      if (channelsToUse.length > 0) {
        await AsyncStorage.setItem(
          "@focus_yt_study_channels",
          JSON.stringify(channelsToUse),
        );
      }
      if (Platform.OS === "android" && FocusLock?.setStudyYouTubeConfig) {
        await FocusLock.setStudyYouTubeConfig(
          studyLimit,
          channelsToUse,
          "[]",
        );
      }

      if (Array.isArray(backup.schedules) && backup.schedules.length > 0) {
        await AsyncStorage.setItem(
          "@focus_multi_schedules",
          JSON.stringify(backup.schedules),
        );

        if (Platform.OS === "android" && FocusLock?.setAdvancedSchedules) {
          const hasEnabled = backup.schedules.some((s: any) => !!s.isEnabled);
          const formatted = backup.schedules.map((s: any) => {
            const st = new Date(s.startTime);
            const et = new Date(s.endTime);
            return {
              isEnabled: !!s.isEnabled,
              startHour: st.getHours(),
              startMinute: st.getMinutes(),
              endHour: et.getHours(),
              endMinute: et.getMinutes(),
              activeDays: Array.isArray(s.activeDays)
                ? s.activeDays
                : [0, 1, 2, 3, 4, 5, 6],
            };
          });
          await FocusLock.setAdvancedSchedules(
            JSON.stringify(formatted),
            hasEnabled,
            appsToUse,
            ytLimit,
          );
        }
      }

      if (Platform.OS === "android" && FocusLock?.syncPassAndStreakFromCloud) {
        await FocusLock.syncPassAndStreakFromCloud(
          backup.emergencyPasses ?? 0,
          backup.streakDays ?? 0,
          backup.lastCompletedDate || "",
          backup.totalPassesEarned ?? backup.emergencyPasses ?? 0,
          backup.totalPassesUsed ?? 0,
          JSON.stringify(backup.completedHistory || {}),
          backup.totalCompleted ?? 0,
          backup.ytUsageDate || "",
          backup.ytUsedSeconds ?? 0,
          backup.ytStudyUsedSeconds ?? 0,
        );
      }
    }

    await syncLocalDataToCloudIfOnline();
  } catch {}
}
