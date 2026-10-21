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
// NOTIFICATIONS ENGINE (100% Online Expo Push + Offline Local Scheduled)
// ============================================================================

export const CONTACT_REMINDER_CHANNEL = "contact-reminders-v2";
export const FOCUS_LOCK_CHANNEL = "focus-lock-alerts";
export const IN_APP_NOTICES_KEY = "@jnuits_in_app_notices";
export const EXPO_PUSH_TOKEN_KEY = "@jnuits_expo_push_token";

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
          ? `📞 আজ ${primary.name}-এর খোঁজ নেওয়ার দিন!`
          : `📞 আজ ${dueToday.length} জন পরিচিতের খোঁজ নেওয়ার দিন!`;

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
            title: `🔔 আজ ${contact.name}-এর সাথে কথা বলার দিন!`,
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

    const title = `📞 আজ ${name}-এর খোঁজ নেওয়ার দিন!`;
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
    const list: AppNoticeItem[] = raw ? JSON.parse(raw) : [];
    const exists = list.some((n) => n.id === notice.id);
    if (exists) return;
    const updated = [notice, ...list].slice(0, 50);
    await AsyncStorage.setItem(IN_APP_NOTICES_KEY, JSON.stringify(updated));
  } catch {}
}

export async function getInAppNotices(): Promise<AppNoticeItem[]> {
  try {
    const raw = await AsyncStorage.getItem(IN_APP_NOTICES_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return [
    {
      id: "welcome-1",
      title: "Focus Lock & Smart CRM Ready 🛡️",
      message:
        "২৫+৫ মিনিটের সেশন লক, ০-৫ ইমার্জেন্সি পাস এবং ৩-ক্যাটাগরির কন্টাক্ট রিমাইন্ডার এখন অফলাইন ও অনলাইনে প্রস্তুত!",
      timestamp: Date.now() - 3600 * 1000,
      read: false,
      type: "system",
    },
  ];
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

// ============================================================================
// OFFLINE-FIRST SYNC & GOOGLE PROFILE BACKUP ENGINE
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

export async function syncLocalDataToCloudIfOnline(): Promise<boolean> {
  try {
    const [
      contactsRaw,
      statsRaw,
      allowedAppsRaw,
      allowedDomainsRaw,
      schedulesRaw,
      ytLimitRaw,
    ] = await Promise.all([
      AsyncStorage.getItem("@networking_contacts"),
      AsyncStorage.getItem("@networking_stats"),
      AsyncStorage.getItem("@focus_allowed_apps"),
      AsyncStorage.getItem("@focus_allowed_domains"),
      AsyncStorage.getItem("@focus_multi_schedules"),
      AsyncStorage.getItem("@focus_yt_limit_minutes"),
    ]);

    let nativeLockState = {
      emergencyPasses: 0,
      streakDays: 0,
      totalCompleted: 0,
    };

    if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
      try {
        const s = await FocusLock.getFocusSessionState();
        nativeLockState = {
          emergencyPasses: s.emergencyPasses ?? 0,
          streakDays: s.streakDays ?? 0,
          totalCompleted: s.totalCompleted ?? 0,
        };
      } catch {}
    }

    const payload = {
      jnuits_backup_v2: {
        updatedAt: Date.now(),
        contacts: contactsRaw ? JSON.parse(contactsRaw) : [],
        networkingStats: statsRaw ? JSON.parse(statsRaw) : null,
        allowedApps: allowedAppsRaw ? JSON.parse(allowedAppsRaw) : [],
        allowedDomains: allowedDomainsRaw ? JSON.parse(allowedDomainsRaw) : [],
        schedules: schedulesRaw ? JSON.parse(schedulesRaw) : [],
        ytLimitMinutes: ytLimitRaw ? parseInt(ytLimitRaw, 10) : 90,
        emergencyPasses: nativeLockState.emergencyPasses,
        streakDays: nativeLockState.streakDays,
        totalCompleted: nativeLockState.totalCompleted,
      },
    };

    const cachedRaw = await AsyncStorage.getItem(CACHED_USER_PROFILE_KEY);
    if (cachedRaw) {
      const cached: CachedUserProfile = JSON.parse(cachedRaw);
      cached.emergencyPasses = nativeLockState.emergencyPasses;
      cached.streakDays = nativeLockState.streakDays;
      await AsyncStorage.setItem(
        CACHED_USER_PROFILE_KEY,
        JSON.stringify(cached),
      );
    }

    await AsyncStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, "true");

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
        emergencyPasses: nativeLockState.emergencyPasses,
        streakDays: nativeLockState.streakDays,
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

    const backup = user.user_metadata?.jnuits_backup_v2;
    const profile: CachedUserProfile = {
      id: user.id,
      name:
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        "JnUITS Member",
      email: user.email || "",
      avatarUrl:
        user.user_metadata?.avatar_url || user.user_metadata?.picture,
      emergencyPasses: backup?.emergencyPasses ?? 0,
      streakDays: backup?.streakDays ?? 0,
      lastSyncedAt: Date.now(),
    };
    await AsyncStorage.setItem(
      CACHED_USER_PROFILE_KEY,
      JSON.stringify(profile),
    );

    if (!backup) return;

    const existingContacts = await AsyncStorage.getItem("@networking_contacts");
    if (
      (!existingContacts || existingContacts === "[]") &&
      Array.isArray(backup.contacts) &&
      backup.contacts.length > 0
    ) {
      await AsyncStorage.setItem(
        "@networking_contacts",
        JSON.stringify(backup.contacts),
      );
    }

    const existingApps = await AsyncStorage.getItem("@focus_allowed_apps");
    if (
      (!existingApps || existingApps === "[]") &&
      Array.isArray(backup.allowedApps) &&
      backup.allowedApps.length > 0
    ) {
      await AsyncStorage.setItem(
        "@focus_allowed_apps",
        JSON.stringify(backup.allowedApps),
      );
      if (Platform.OS === "android" && FocusLock?.saveAllowedApps) {
        await FocusLock.saveAllowedApps(backup.allowedApps);
      }
    }

    const existingDomains = await AsyncStorage.getItem(
      "@focus_allowed_domains",
    );
    if (
      (!existingDomains || existingDomains === "[]") &&
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

    if (
      Platform.OS === "android" &&
      FocusLock?.syncPassAndStreakFromCloud &&
      typeof backup.emergencyPasses === "number"
    ) {
      await FocusLock.syncPassAndStreakFromCloud(
        backup.emergencyPasses,
        backup.streakDays ?? 0,
        backup.lastCompletedDate || "",
      );
    }
  } catch {}
}
