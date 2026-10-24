import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  CACHED_USER_PROFILE_KEY,
  CachedUserProfile,
  ContactForNotification,
  registerExpoPushTokenOnlineOffline,
  scheduleContactNotificationsOffline,
  syncLocalDataToCloudIfOnline,
  triggerInstantContactNotification,
} from "../../lib/supabase";

const STORAGE_KEY = "@networking_contacts";
const STATS_KEY = "@networking_stats";
const FREE_MAX_CONTACTS = 5;
const { FastContacts, FocusLock } = NativeModules;

export type ContactCategoryType = "family" | "friends" | "network";
type InteractionType = "call" | "whatsapp" | "sms" | "done";

export interface RelationshipContact {
  id: string;
  name: string;
  phoneNumber: string;
  category: ContactCategoryType;
  lastCalledAt: number;
  nextDueDate: number;
  note?: string;
}

interface PhonebookContact {
  id?: string;
  name?: string;
  phoneNumbers?: { number?: string }[];
}

interface AppStats {
  currentStreak: number;
  longestStreak: number;
  lastInteractionDate: string;
}

const getCategoryConfig = (cat: ContactCategoryType) => {
  switch (cat) {
    case "family":
      return {
        icon: "heart",
        color: "#F43F5E",
        bg: "bg-rose-500/20",
        border: "border-rose-500/40",
        label: "Category 1: পরিবার ও ভিআইপি (৩–৭ দিন র‍্যান্ডম)",
        shortLabel: "Cat 1: পরিবার (~5d)",
        minDays: 3,
        maxDays: 7,
      };
    case "friends":
      return {
        icon: "star",
        color: "#FBBF24",
        bg: "bg-amber-500/20",
        border: "border-amber-500/40",
        label: "Category 2: ঘনিষ্ঠ বন্ধু (১১–১৮ দিন র‍্যান্ডম)",
        shortLabel: "Cat 2: বন্ধু (~15d)",
        minDays: 11,
        maxDays: 18,
      };
    case "network":
    default:
      return {
        icon: "people",
        color: "#38BDF8",
        bg: "bg-sky-500/20",
        border: "border-sky-500/40",
        label: "Category 3: পরিচিত ও আত্মীয় (২৪–৩৬ দিন র‍্যান্ডম)",
        shortLabel: "Cat 3: পরিচিত (~30d)",
        minDays: 24,
        maxDays: 36,
      };
  }
};

const normalizeCategory = (raw: string): ContactCategoryType => {
  if (raw === "family" || raw === "close") return "family";
  if (raw === "friends" || raw === "important") return "friends";
  return "network";
};

const getDayKey = (timestamp: number) => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const formatDate = (timestamp: number) => {
  if (!timestamp || timestamp === 0) return "কখনো কথা হয়নি";
  const date = new Date(timestamp);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()} (7:00 PM)`;
};

const calculateRandomUniqueDueDate = (
  category: ContactCategoryType,
  currentList: RelationshipContact[],
  excludeContactId?: string,
): number => {
  const cfg = getCategoryConfig(category);
  const usedDayKeys = new Set<string>();

  currentList.forEach((c) => {
    if (c.id !== excludeContactId && c.nextDueDate > 0) {
      usedDayKeys.add(getDayKey(c.nextDueDate));
    }
  });

  const candidateOffsets: number[] = [];
  for (let d = cfg.minDays; d <= cfg.maxDays; d++) {
    candidateOffsets.push(d);
  }
  for (let i = candidateOffsets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = candidateOffsets[i];
    candidateOffsets[i] = candidateOffsets[j];
    candidateOffsets[j] = temp;
  }

  for (const offset of candidateOffsets) {
    const candidateDate = new Date();
    candidateDate.setDate(candidateDate.getDate() + offset);
    candidateDate.setHours(19, 0, 0, 0);
    if (!usedDayKeys.has(getDayKey(candidateDate.getTime()))) {
      return candidateDate.getTime();
    }
  }

  let extraOffset = cfg.maxDays + 1;
  while (extraOffset < cfg.maxDays + 90) {
    const candidateDate = new Date();
    candidateDate.setDate(candidateDate.getDate() + extraOffset);
    candidateDate.setHours(19, 0, 0, 0);
    if (!usedDayKeys.has(getDayKey(candidateDate.getTime()))) {
      return candidateDate.getTime();
    }
    extraOffset++;
  }

  const fallback = new Date();
  fallback.setDate(fallback.getDate() + candidateOffsets[0]);
  fallback.setHours(19, 0, 0, 0);
  return fallback.getTime();
};

export default function SmartNetworkingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [contacts, setContacts] = useState<RelationshipContact[]>([]);
  const [todayDueContacts, setTodayDueContacts] = useState<
    RelationshipContact[]
  >([]);
  const [isProUser, setIsProUser] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "today" | "family" | "friends" | "network"
  >("today");

  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<PhonebookContact[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  const [selectedContactToAdd, setSelectedContactToAdd] =
    useState<PhonebookContact | null>(null);
  const [customNoteInput, setCustomNoteInput] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Modern Custom Modal State
  const [uiModal, setUiModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    color: string;
    confirmText?: string;
    onConfirm?: () => void;
  }>({
    visible: false,
    title: "",
    message: "",
    icon: "check-decagram",
    color: "#34D399",
  });

  const [appStats, setAppStats] = useState<AppStats>({
    currentStreak: 0,
    longestStreak: 0,
    lastInteractionDate: "",
  });

  const pendingCallContactIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);

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

  const loadContactsAndScheduleNotifications = useCallback(async () => {
    try {
      const [rawContacts, rawStats, cachedProfileRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(STATS_KEY),
        AsyncStorage.getItem(CACHED_USER_PROFILE_KEY),
      ]);

      let pro = false;
      if (cachedProfileRaw) {
        const parsedProfile: CachedUserProfile = JSON.parse(cachedProfileRaw);
        pro = !!parsedProfile.isPro;
      }
      if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
        try {
          const s = await FocusLock.getFocusSessionState();
          pro = !!(pro || s.isPro);
        } catch {}
      }
      setIsProUser(pro);

      if (rawStats) {
        setAppStats(JSON.parse(rawStats));
      }

      if (rawContacts) {
        const parsed: any[] = JSON.parse(rawContacts);
        const normalized: RelationshipContact[] = [];
        const seenDayKeys = new Set<string>();
        let didFixDuplicates = false;

        for (const item of parsed) {
          const cat = normalizeCategory(item.category);
          let due = item.nextDueDate || 0;
          const dayKey = due > 0 ? getDayKey(due) : "";

          if (due <= 0 || seenDayKeys.has(dayKey)) {
            due = calculateRandomUniqueDueDate(cat, normalized, item.id);
            didFixDuplicates = true;
          } else {
            const d = new Date(due);
            d.setHours(19, 0, 0, 0);
            due = d.getTime();
          }

          seenDayKeys.add(getDayKey(due));
          normalized.push({
            ...item,
            category: cat,
            nextDueDate: due,
          });
        }

        if (didFixDuplicates) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        }

        setContacts(normalized);

        const todayEnd = new Date().setHours(23, 59, 59, 999);
        const due = normalized
          .filter((c) => c.nextDueDate <= todayEnd)
          .sort((a, b) => {
            const rank = { family: 0, friends: 1, network: 2 };
            return rank[a.category] - rank[b.category];
          });

        setTodayDueContacts(due);

        await scheduleContactNotificationsOffline(
          normalized as ContactForNotification[],
        );
      } else {
        setContacts([]);
        setTodayDueContacts([]);
      }
    } catch (error) {
      console.warn("Error loading contacts:", error);
    }
  }, []);

  useEffect(() => {
    void registerExpoPushTokenOnlineOffline();
    void loadContactsAndScheduleNotifications();
  }, [loadContactsAndScheduleNotifications]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      async (nextAppState) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active" &&
          pendingCallContactIdRef.current
        ) {
          const contactId = pendingCallContactIdRef.current;
          pendingCallContactIdRef.current = null;
          await markContactAsSpoken(contactId);
        }
        appState.current = nextAppState;
      },
    );
    return () => subscription.remove();
  });

  const markContactAsSpoken = async (contactId: string) => {
    const updatedList = contacts.map((c) => {
      if (c.id === contactId) {
        return {
          ...c,
          lastCalledAt: Date.now(),
          nextDueDate: calculateRandomUniqueDueDate(
            c.category,
            contacts,
            c.id,
          ),
        };
      }
      return c;
    });

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));

    const todayStr = new Date().toISOString().split("T")[0];
    if (appStats.lastInteractionDate !== todayStr) {
      const nextStreak = appStats.currentStreak + 1;
      const newStats: AppStats = {
        currentStreak: nextStreak,
        longestStreak: Math.max(nextStreak, appStats.longestStreak),
        lastInteractionDate: todayStr,
      };
      setAppStats(newStats);
      await AsyncStorage.setItem(STATS_KEY, JSON.stringify(newStats));
    }

    await loadContactsAndScheduleNotifications();
    void syncLocalDataToCloudIfOnline();
  };

  const handleInteraction = async (
    contact: RelationshipContact,
    type: InteractionType,
  ) => {
    if (type === "done") {
      await markContactAsSpoken(contact.id);
      setUiModal({
        visible: true,
        title: "যোগাযোগ সম্পন্ন হয়েছে!",
        message: `${contact.name}-এর সাথে যোগাযোগ রেকর্ড করা হয়েছে। পরবর্তী রিমাইন্ডার নতুন একটি র‍্যান্ডম তারিখে সন্ধ্যা ৭টায় সেট হয়ে গেছে!`,
        icon: "check-decagram",
        color: "#34D399",
      });
      return;
    }

    pendingCallContactIdRef.current = contact.id;
    const cleanPhone = contact.phoneNumber.replace(/\s+/g, "");

    if (type === "call") {
      void Linking.openURL(`tel:${cleanPhone}`);
    } else if (type === "whatsapp") {
      void Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
    } else if (type === "sms") {
      void Linking.openURL(`sms:${cleanPhone}`);
    }
  };

  const openContactPicker = async () => {
    // Free vs Toki Pro Contact Cap: Free = 5 Contacts, Pro = Unlimited!
    if (!isProUser && contacts.length >= FREE_MAX_CONTACTS) {
      setUiModal({
        visible: true,
        title: "Free ভার্সনে সর্বোচ্চ ৫টি কন্টাক্ট 👑",
        message:
          "Free ভার্সনে সর্বোচ্চ ৫ জন প্রিয় মানুষের রিমাইন্ডার সেট করা যায়। আনলিমিটেড কন্টাক্ট যুক্ত করতে Toki Pro-তে আপগ্রেড করুন!",
        icon: "crown",
        color: "#FBBF24",
        confirmText: "Upgrade to Pro",
        onConfirm: () => router.push("/(tabs)/profile"),
      });
      return;
    }

    setPickerModalVisible(true);
    setIsLoadingContacts(true);

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setIsLoadingContacts(false);
        return;
      }

      const nativeContacts = await FastContacts.getContactsAsync();
      const uniqueMap = new Map<string, PhonebookContact>();
      (nativeContacts || []).forEach((c: any) => {
        if (!uniqueMap.has(c.id)) {
          uniqueMap.set(c.id, {
            id: c.id,
            name: c.name,
            phoneNumbers: [{ number: c.phoneNumber }],
          });
        }
      });
      setPhoneContacts(Array.from(uniqueMap.values()));
    } catch {
    } finally {
      setIsLoadingContacts(false);
    }
  };

  const addContactWithCategory = async (category: ContactCategoryType) => {
    if (!selectedContactToAdd) return;
    if (!isProUser && contacts.length >= FREE_MAX_CONTACTS) {
      setSelectedContactToAdd(null);
      setPickerModalVisible(false);
      setUiModal({
        visible: true,
        title: "Free ভার্সনে সর্বোচ্চ ৫টি কন্টাক্ট 👑",
        message:
          "আনলিমিটেড কন্টাক্ট রিমাইন্ডার সেট করতে Toki Pro-তে আপগ্রেড করুন!",
        icon: "crown",
        color: "#FBBF24",
        confirmText: "Upgrade to Pro",
        onConfirm: () => router.push("/(tabs)/profile"),
      });
      return;
    }

    const phone = selectedContactToAdd.phoneNumbers?.[0]?.number || "";
    if (!phone) {
      setUiModal({
        visible: true,
        title: "নাম্বার পাওয়া যায়নি",
        message: "এই কন্টাক্টের কোনো ফোন নাম্বার নেই।",
        icon: "phone-alert",
        color: "#F43F5E",
      });
      return;
    }

    if (contacts.some((c) => c.id === selectedContactToAdd.id)) {
      setSelectedContactToAdd(null);
      setUiModal({
        visible: true,
        title: "আগে থেকেই যুক্ত আছে",
        message: "এই কন্টাক্টটি আপনার রিমাইন্ডার লিস্টে ইতিমধ্যেই যুক্ত আছে।",
        icon: "account-check-outline",
        color: "#FBBF24",
      });
      return;
    }

    const randomDueTimestamp = calculateRandomUniqueDueDate(category, contacts);

    const newContact: RelationshipContact = {
      id: selectedContactToAdd.id || Date.now().toString(),
      name: selectedContactToAdd.name || "Unknown",
      phoneNumber: phone,
      category,
      lastCalledAt: Date.now(),
      nextDueDate: randomDueTimestamp,
      note: customNoteInput.trim() || undefined,
    };

    const updated = [newContact, ...contacts];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSelectedContactToAdd(null);
    setCustomNoteInput("");
    setPickerModalVisible(false);
    setActiveTab(category);

    await loadContactsAndScheduleNotifications();
    void syncLocalDataToCloudIfOnline();
  };

  const deleteContact = (id: string, name: string) => {
    setUiModal({
      visible: true,
      title: "কন্টাক্ট মুছে ফেলবেন?",
      message: `আপনি কি "${name}"-কে রিমাইন্ডার লিস্ট থেকে মুছে ফেলতে চান?`,
      icon: "trash-can-outline",
      color: "#F43F5E",
      confirmText: "হ্যাঁ, মুছুন",
      onConfirm: async () => {
        const updated = contacts.filter((c) => c.id !== id);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        await loadContactsAndScheduleNotifications();
        void syncLocalDataToCloudIfOnline();
      },
    });
  };

  const cycleContactCategory = async (
    id: string,
    current: ContactCategoryType,
  ) => {
    const nextMap: Record<ContactCategoryType, ContactCategoryType> = {
      family: "friends",
      friends: "network",
      network: "family",
    };
    const nextCat = nextMap[current];
    const updated = contacts.map((c) =>
      c.id === id
        ? {
            ...c,
            category: nextCat,
            nextDueDate: calculateRandomUniqueDueDate(nextCat, contacts, id),
          }
        : c,
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    await loadContactsAndScheduleNotifications();
    void syncLocalDataToCloudIfOnline();
  };

  const filteredPhoneContacts = useMemo(() => {
    const existingIds = new Set(contacts.map((c) => c.id));
    const available = phoneContacts.filter((c) => !existingIds.has(c.id || ""));
    if (!searchInput.trim()) return available;
    const q = searchInput.toLowerCase();
    return available.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phoneNumbers?.[0]?.number?.includes(q),
    );
  }, [phoneContacts, contacts, searchInput]);

  const displayedList = useMemo(() => {
    if (activeTab === "today") return todayDueContacts;
    return contacts
      .filter((c) => c.category === activeTab)
      .sort((a, b) => a.nextDueDate - b.nextDueDate);
  }, [activeTab, todayDueContacts, contacts]);

  return (
    <SafeAreaView
      className="flex-1 bg-[#0B1120]"
      edges={["top", "bottom", "left", "right"]}
    >
      <StatusBar style="light" backgroundColor="#0B1120" />

      {/* HEADER */}
      <View className="px-4 pt-3 pb-1">
        <View className="flex-row justify-between items-center mb-1">
          <View className="flex-1 pr-2">
            <View className="flex-row items-center">
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                className="text-xl font-black text-white tracking-tight"
              >
                Toki Contact CRM
              </Text>
              <View className="ml-2 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                <Text
                  allowFontScaling={false}
                  className="text-indigo-300 font-bold text-[10px]"
                >
                  {isProUser
                    ? `${contacts.length} Saved (Pro)`
                    : `${contacts.length}/${FREE_MAX_CONTACTS} Free`}
                </Text>
              </View>
            </View>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              className="text-slate-400 text-[11px] font-medium mt-0.5"
            >
              সন্ধ্যা ৭:০০টায় র‍্যান্ডম তারিখে নামসহ রিমাইন্ডার
            </Text>
          </View>

          <View className="flex-row gap-2">
            {__DEV__ && (
              <Pressable
                onPress={async () => {
                  const sample = todayDueContacts[0] || contacts[0];
                  const ok = await triggerInstantContactNotification(
                    sample?.name,
                    sample ? getCategoryConfig(sample.category).label : undefined,
                  );
                  if (!ok) {
                    setUiModal({
                      visible: true,
                      title: "Notification Permission",
                      message:
                        "নোটিফিকেশন পাওয়ার জন্য ফোনের Notification Permission অন করুন।",
                      icon: "bell-alert-outline",
                      color: "#FBBF24",
                    });
                  }
                }}
                className="bg-emerald-600/20 border border-emerald-500/40 h-10 px-2.5 items-center justify-center rounded-xl flex-row"
              >
                <MaterialCommunityIcons
                  name="bell-ring-outline"
                  size={15}
                  color="#34D399"
                />
                <Text
                  allowFontScaling={false}
                  className="text-emerald-300 font-bold text-xs ml-1"
                >
                  Test
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => void openContactPicker()}
              className="bg-indigo-600 h-10 w-10 items-center justify-center rounded-xl active:bg-indigo-700"
            >
              <Ionicons name="person-add" size={18} color="white" />
            </Pressable>
          </View>
        </View>

        {/* 4 Tabs */}
        <View className="flex-row bg-[#131C31] p-1 rounded-2xl mt-3 mb-2 border border-slate-800">
          {[
            { id: "today", label: `আজ (${todayDueContacts.length})` },
            {
              id: "family",
              label: `পরিবার (${contacts.filter((c) => c.category === "family").length})`,
            },
            {
              id: "friends",
              label: `বন্ধু (${contacts.filter((c) => c.category === "friends").length})`,
            },
            {
              id: "network",
              label: `পরিচিত (${contacts.filter((c) => c.category === "network").length})`,
            },
          ].map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-2 px-1 rounded-xl items-center justify-center ${
                activeTab === tab.id ? "bg-indigo-600" : ""
              }`}
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                adjustsFontSizeToFit
                className={`font-bold text-[11px] ${
                  activeTab === tab.id ? "text-white" : "text-slate-400"
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* CONTACT CARDS LIST */}
      <View className="flex-1 px-4">
        {displayedList.length === 0 ? (
          <View className="flex-1 items-center justify-center pb-12">
            <View className="p-5 bg-[#131C31] rounded-full items-center justify-center mb-4 border border-slate-800">
              <MaterialCommunityIcons
                name="account-heart-outline"
                size={36}
                color="#818CF8"
              />
            </View>
            <Text
              allowFontScaling={false}
              className="text-slate-200 font-bold text-base mb-1 text-center"
            >
              {activeTab === "today"
                ? "আজ সন্ধ্যা ৭টায় কারো রিমাইন্ডার নেই"
                : "এই ক্যাটাগরিতে এখনো কেউ নেই"}
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-500 text-xs text-center px-6 leading-5"
            >
              {activeTab === "today"
                ? "পাশের 'পরিবার', 'বন্ধু' বা 'পরিচিত' ট্যাবে ট্যাপ করে দেখুন কার রিমাইন্ডার কোন তারিখে পড়েছে!"
                : "ওপরের + বাটনে ট্যাপ করে ফোনবুক থেকে কন্টাক্ট যুক্ত করুন।"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayedList}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingTop: 4,
              paddingBottom: Math.max(28, insets.bottom + 16),
            }}
            renderItem={({ item }) => {
              const cfg = getCategoryConfig(item.category);
              return (
                <View className="bg-[#131C31] border border-slate-800 p-3.5 rounded-3xl mb-3">
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center flex-1 pr-2">
                      <Pressable
                        onPress={() =>
                          void cycleContactCategory(item.id, item.category)
                        }
                        className={`h-10 w-10 rounded-2xl items-center justify-center mr-3 border ${cfg.bg} ${cfg.border}`}
                      >
                        <Ionicons
                          name={cfg.icon as any}
                          size={18}
                          color={cfg.color}
                        />
                      </Pressable>
                      <View className="flex-1">
                        <Text
                          allowFontScaling={false}
                          className="text-white font-bold text-sm"
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        <View className="flex-row items-center mt-0.5">
                          <Feather name="calendar" size={11} color="#818CF8" />
                          <Text
                            allowFontScaling={false}
                            numberOfLines={1}
                            className="text-indigo-300 text-[11px] font-semibold ml-1"
                          >
                            Next: {formatDate(item.nextDueDate)}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => deleteContact(item.id, item.name)}
                      className="p-2 rounded-xl bg-[#0B1120] border border-slate-800"
                    >
                      <Feather name="trash-2" size={15} color="#F43F5E" />
                    </Pressable>
                  </View>

                  {item.note ? (
                    <View className="bg-[#0B1120] px-3 py-2 rounded-xl border border-slate-800 mb-3 flex-row items-center">
                      <Feather name="file-text" size={12} color="#818CF8" />
                      <Text
                        allowFontScaling={false}
                        className="text-indigo-300 text-xs italic ml-1.5 flex-1"
                      >
                        {item.note}
                      </Text>
                    </View>
                  ) : null}

                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => void handleInteraction(item, "call")}
                      className="flex-1 bg-indigo-600 py-2.5 px-1.5 rounded-xl flex-row items-center justify-center active:bg-indigo-700"
                    >
                      <Ionicons name="call" size={14} color="#FFFFFF" />
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-white font-bold text-[11px] ml-1"
                      >
                        Call
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => void handleInteraction(item, "whatsapp")}
                      className="flex-1 bg-emerald-600/20 border border-emerald-500/40 py-2.5 px-1.5 rounded-xl flex-row items-center justify-center"
                    >
                      <Ionicons
                        name="logo-whatsapp"
                        size={14}
                        color="#34D399"
                      />
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-emerald-300 font-bold text-[11px] ml-1"
                      >
                        WhatsApp
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => void handleInteraction(item, "done")}
                      className="flex-1 bg-[#0B1120] border border-slate-800 py-2.5 px-1.5 rounded-xl flex-row items-center justify-center"
                    >
                      <Ionicons
                        name="checkmark-done"
                        size={14}
                        color="#38BDF8"
                      />
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        className="text-sky-300 font-bold text-[11px] ml-1"
                      >
                        কথা হয়েছে
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>

      {/* PHONEBOOK CONTACT PICKER MODAL */}
      <Modal visible={pickerModalVisible} animationType="slide">
        <SafeAreaView
          className="flex-1 bg-[#0B1120]"
          edges={["top", "bottom", "left", "right"]}
        >
          <View className="flex-row justify-between items-center px-5 pt-3 pb-3">
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              className="text-white text-lg font-bold flex-1 pr-2"
            >
              ফোনবুক থেকে কন্টাক্ট বাছাই করুন
            </Text>
            <Pressable
              onPress={() => setPickerModalVisible(false)}
              className="h-9 w-9 bg-slate-800 rounded-full items-center justify-center"
            >
              <Ionicons name="close" size={20} color="#94A3B8" />
            </Pressable>
          </View>

          <View className="px-5 mb-3">
            <TextInput
              className="bg-[#131C31] text-white px-4 py-2.5 rounded-2xl border border-slate-800 text-sm"
              placeholder="নাম বা নাম্বার দিয়ে খুঁজুন..."
              placeholderTextColor="#64748B"
              value={searchInput}
              onChangeText={setSearchInput}
            />
          </View>

          {isLoadingContacts ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#818CF8" />
              <Text className="text-slate-400 text-xs mt-3">
                ফোনবুক লোড হচ্ছে...
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredPhoneContacts}
              keyExtractor={(item, idx) => `${item.id}-${idx}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingBottom: Math.max(
                  28,
                  insets.bottom + keyboardHeight + 16,
                ),
              }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedContactToAdd(item)}
                  className="bg-[#131C31] p-3.5 rounded-2xl mb-2 border border-slate-800 flex-row items-center justify-between"
                >
                  <View className="flex-1 pr-3">
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-white font-bold text-sm"
                    >
                      {item.name || "Unknown"}
                    </Text>
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-slate-400 text-xs mt-0.5"
                    >
                      {item.phoneNumbers?.[0]?.number || ""}
                    </Text>
                  </View>
                  <Ionicons name="add-circle" size={24} color="#818CF8" />
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* 3-CATEGORY SELECTION MODAL */}
      <Modal transparent visible={!!selectedContactToAdd} animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1 bg-black/75 justify-end"
        >
          <View
            style={{
              paddingBottom:
                keyboardHeight > 0
                  ? keyboardHeight + 16
                  : Math.max(20, insets.bottom + 12),
            }}
            className="bg-slate-900 w-full rounded-t-[28px] px-5 pt-5 border-t border-slate-700 max-h-[90%]"
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                className="text-white text-lg font-bold text-center"
              >
                {selectedContactToAdd?.name}
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-xs text-center mt-1 mb-3 leading-4"
              >
                ক্যাটাগরি সিলেক্ট করলে অটোমেটিক একটি ফাঁকা র‍্যান্ডম তারিখে
                সন্ধ্যা ৭টায় রিমাইন্ডার সেট হবে
              </Text>

              <TextInput
                placeholder="ছোট নোট (ঐচ্ছিক, যেমন: আঙ্কেলের স্বাস্থ্যের খবর নেব)"
                placeholderTextColor="#64748B"
                value={customNoteInput}
                onChangeText={setCustomNoteInput}
                className="bg-slate-800 text-white px-3.5 py-2.5 rounded-xl border border-slate-700 mb-3 text-xs"
              />

              <View className="gap-y-2.5 mb-4">
                {(
                  ["family", "friends", "network"] as ContactCategoryType[]
                ).map((cat) => {
                  const cfg = getCategoryConfig(cat);
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => void addContactWithCategory(cat)}
                      className="bg-slate-800 p-3.5 rounded-2xl flex-row items-center border border-slate-700 active:bg-slate-700"
                    >
                      <View
                        className={`p-2 rounded-xl mr-3 ${cfg.bg} border ${cfg.border}`}
                      >
                        <Ionicons
                          name={cfg.icon as any}
                          size={20}
                          color={cfg.color}
                        />
                      </View>
                      <View className="flex-1">
                        <Text
                          allowFontScaling={false}
                          className="text-white font-bold text-xs"
                        >
                          {cfg.label}
                        </Text>
                        <Text
                          allowFontScaling={false}
                          className="text-slate-400 text-[11px] mt-0.5 leading-4"
                        >
                          আলাদা র‍্যান্ডম তারিখে সন্ধ্যা ৭:০০টায় নোটিফিকেশন আসবে
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={() => {
                  setSelectedContactToAdd(null);
                  setCustomNoteInput("");
                }}
                className="py-3 rounded-2xl items-center bg-slate-800"
              >
                <Text
                  allowFontScaling={false}
                  className="text-slate-300 font-bold text-xs"
                >
                  বাতিল
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODERN CUSTOM MODAL */}
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
                size={32}
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
                    না
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const fn = uiModal.onConfirm;
                    setUiModal((prev) => ({ ...prev, visible: false }));
                    if (fn) fn();
                  }}
                  className="flex-1 bg-rose-600 py-3.5 rounded-2xl items-center active:bg-rose-700"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-white font-black text-xs"
                  >
                    {uiModal.confirmText || "হ্যাঁ, মুছুন"}
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
    </SafeAreaView>
  );
}
