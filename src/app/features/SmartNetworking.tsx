import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  Alert,
  AppState,
  FlatList,
  Linking,
  Modal,
  NativeModules,
  PermissionsAndroid,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ContactForNotification,
  registerExpoPushTokenOnlineOffline,
  scheduleContactNotificationsOffline,
  triggerInstantContactNotification,
} from "../../lib/supabase";
import { syncLocalDataToCloudIfOnline } from "../../lib/supabase";

const STORAGE_KEY = "@networking_contacts";
const STATS_KEY = "@networking_stats";
const { FastContacts } = NativeModules;

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
        label: "Category 1: পরিবার ও ভিআইপি (৫ দিন পর পর)",
        shortLabel: "Cat 1: পরিবার (5d)",
        intervalDays: 5,
      };
    case "friends":
      return {
        icon: "star",
        color: "#FBBF24",
        bg: "bg-amber-500/20",
        border: "border-amber-500/40",
        label: "Category 2: ঘনিষ্ঠ বন্ধু (১৫ দিন পর পর)",
        shortLabel: "Cat 2: বন্ধু (15d)",
        intervalDays: 15,
      };
    case "network":
    default:
      return {
        icon: "people",
        color: "#38BDF8",
        bg: "bg-sky-500/20",
        border: "border-sky-500/40",
        label: "Category 3: পরিচিত ও আত্মীয় (৩০ দিন পর পর)",
        shortLabel: "Cat 3: পরিচিত (30d)",
        intervalDays: 30,
      };
  }
};

const normalizeCategory = (raw: string): ContactCategoryType => {
  if (raw === "family" || raw === "close") return "family";
  if (raw === "friends" || raw === "important") return "friends";
  return "network";
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
  return `${months[date.getMonth()]} ${date.getDate()}`;
};

export default function SmartNetworkingScreen() {
  const [contacts, setContacts] = useState<RelationshipContact[]>([]);
  const [todayDueContacts, setTodayDueContacts] = useState<
    RelationshipContact[]
  >([]);
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

  const [appStats, setAppStats] = useState<AppStats>({
    currentStreak: 0,
    longestStreak: 0,
    lastInteractionDate: "",
  });

  const pendingCallContactIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);

  // Smart Rotation Algorithm: calculates next due date by category and spreads out contacts so max 2 fall on the same day
  const calculateNextDueDate = useCallback(
    (
      category: ContactCategoryType,
      currentList: RelationshipContact[],
      dueImmediately = false,
    ) => {
      if (dueImmediately) {
        return new Date().setHours(10, 0, 0, 0);
      }

      const config = getCategoryConfig(category);
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + config.intervalDays);
      targetDate.setHours(0, 0, 0, 0);

      const dateCounts = new Map<number, number>();
      currentList.forEach((c) => {
        if (c.nextDueDate > 0) {
          const d = new Date(c.nextDueDate).setHours(0, 0, 0, 0);
          dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
        }
      });

      while ((dateCounts.get(targetDate.getTime()) || 0) >= 2) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
      targetDate.setHours(10, 0, 0, 0);
      return targetDate.getTime();
    },
    [],
  );

  const loadContactsAndScheduleNotifications = useCallback(async () => {
    try {
      const [rawContacts, rawStats] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(STATS_KEY),
      ]);

      if (rawStats) {
        setAppStats(JSON.parse(rawStats));
      }

      if (rawContacts) {
        const parsed: any[] = JSON.parse(rawContacts);
        const normalized: RelationshipContact[] = parsed.map((c) => ({
          ...c,
          category: normalizeCategory(c.category),
        }));
        setContacts(normalized);

        const todayEnd = new Date().setHours(23, 59, 59, 999);
        const due = normalized
          .filter((c) => c.nextDueDate <= todayEnd)
          .sort((a, b) => {
            const rank = { family: 0, friends: 1, network: 2 };
            return rank[a.category] - rank[b.category];
          });

        setTodayDueContacts(due);

        // Schedule both Offline Local Notifications (naming the contact!) & Online Sync
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

  // Auto-mark contact as spoken when user returns from Phone Call / WhatsApp
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
          nextDueDate: calculateNextDueDate(c.category, contacts, false),
        };
      }
      return c;
    });

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));

    // Update streak
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
      Alert.alert(
        "সম্পন্ন হয়েছে ✅",
        `${contact.name}-এর সাথে যোগাযোগ রেকর্ড করা হয়েছে। পরবর্তী রিমাইন্ডার অটোমেটিক সেট হয়ে গেছে!`,
      );
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

  const addContactWithCategory = async (
    category: ContactCategoryType,
    dueTodayForFirstTime = true,
  ) => {
    if (!selectedContactToAdd) return;
    const phone = selectedContactToAdd.phoneNumbers?.[0]?.number || "";
    if (!phone) {
      Alert.alert("নাম্বার পাওয়া যায়নি", "এই কন্টাক্টের কোনো ফোন নাম্বার নেই।");
      return;
    }

    if (contacts.some((c) => c.id === selectedContactToAdd.id)) {
      Alert.alert("আগে থেকেই আছে", "এই কন্টাক্টটি আপনার লিস্টে ইতিমধ্যেই যুক্ত আছে।");
      setSelectedContactToAdd(null);
      return;
    }

    const newContact: RelationshipContact = {
      id: selectedContactToAdd.id || Date.now().toString(),
      name: selectedContactToAdd.name || "Unknown",
      phoneNumber: phone,
      category,
      lastCalledAt: 0,
      nextDueDate: calculateNextDueDate(
        category,
        contacts,
        dueTodayForFirstTime,
      ),
      note: customNoteInput.trim() || undefined,
    };

    const updated = [newContact, ...contacts];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setSelectedContactToAdd(null);
    setCustomNoteInput("");
    setPickerModalVisible(false);

    await loadContactsAndScheduleNotifications();
    void syncLocalDataToCloudIfOnline();

    // Immediately fire a confirmation notification naming the added contact!
    const catCfg = getCategoryConfig(category);
    await triggerInstantContactNotification(newContact.name, catCfg.label);
  };

  const deleteContact = async (id: string, name: string) => {
    Alert.alert(
      "কন্টাক্ট মুছে ফেলবেন?",
      `আপনি কি "${name}"-কে রিমাইন্ডার লিস্ট থেকে মুছে ফেলতে চান?`,
      [
        { text: "না", style: "cancel" },
        {
          text: "হ্যাঁ, মুছুন",
          style: "destructive",
          onPress: async () => {
            const updated = contacts.filter((c) => c.id !== id);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            await loadContactsAndScheduleNotifications();
            void syncLocalDataToCloudIfOnline();
          },
        },
      ],
    );
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
            nextDueDate: calculateNextDueDate(nextCat, contacts, false),
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
    return contacts.filter((c) => c.category === activeTab);
  }, [activeTab, todayDueContacts, contacts]);

  return (
    <SafeAreaView
      className="flex-1 bg-[#0F172A]"
      edges={["top", "left", "right"]}
    >
      <StatusBar style="light" />

      {/* HEADER */}
      <View className="px-6 pt-4 pb-2">
        <View className="flex-row justify-between items-center mb-1">
          <View>
            <Text
              allowFontScaling={false}
              className="text-2xl font-black text-white tracking-tight"
            >
              Contact Reminder CRM
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-400 text-xs font-medium mt-0.5"
            >
              ৩ ক্যাটাগরিতে পরিবার ও বন্ধুদের সাথে সম্পর্ক সতেজ রাখুন
            </Text>
          </View>

          <View className="flex-row gap-2">
            {/* Instant Test Notification Button */}
            <Pressable
              onPress={async () => {
                const sample = todayDueContacts[0] || contacts[0];
                const ok = await triggerInstantContactNotification(
                  sample?.name,
                  sample ? getCategoryConfig(sample.category).label : undefined,
                );
                if (!ok) {
                  Alert.alert(
                    "Notification Permission",
                    "নোটিফিকেশন পাওয়ার জন্য ফোনের Notification Permission অন করুন।",
                  );
                }
              }}
              className="bg-emerald-600/20 border border-emerald-500/40 h-11 px-3 items-center justify-center rounded-2xl flex-row"
            >
              <Ionicons name="notifications" size={18} color="#34D399" />
              <Text
                allowFontScaling={false}
                className="text-emerald-300 font-bold text-xs ml-1"
              >
                Test
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void openContactPicker()}
              className="bg-indigo-600 h-11 w-11 items-center justify-center rounded-2xl active:bg-indigo-700"
            >
              <Ionicons name="person-add" size={20} color="white" />
            </Pressable>
          </View>
        </View>

        {/* 4 Tabs: Today + 3 Categories */}
        <View className="flex-row bg-slate-800 p-1 rounded-2xl mt-4 mb-3 border border-slate-700">
          {[
            { id: "today", label: `আজকের (${todayDueContacts.length})` },
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
              className={`flex-1 py-2.5 rounded-xl items-center justify-center ${
                activeTab === tab.id ? "bg-indigo-600" : ""
              }`}
            >
              <Text
                allowFontScaling={false}
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
      <View className="flex-1 px-5 pb-6">
        {displayedList.length === 0 ? (
          <View className="flex-1 items-center justify-center pb-16">
            <View className="w-20 h-20 bg-slate-800 rounded-full items-center justify-center mb-4 border border-slate-700">
              <Ionicons name="people-outline" size={36} color="#818CF8" />
            </View>
            <Text
              allowFontScaling={false}
              className="text-slate-200 font-bold text-base mb-1"
            >
              {activeTab === "today"
                ? "আজ কথা বলার কেউ বাকি নেই! 🎉"
                : "এই ক্যাটাগরিতে এখনো কেউ নেই"}
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-500 text-xs text-center px-8"
            >
              ওপরের + বাটনে ক্লিক করে ফোনবুক থেকে পরিবার, বন্ধু বা পরিচিতদের
              ৩টি ক্যাটাগরিতে যুক্ত করুন।
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayedList}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 28 }}
            renderItem={({ item }) => {
              const cfg = getCategoryConfig(item.category);
              return (
                <View className="bg-slate-800 border border-slate-700 p-4 rounded-3xl mb-3">
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center flex-1 pr-2">
                      <Pressable
                        onPress={() =>
                          void cycleContactCategory(item.id, item.category)
                        }
                        className={`h-11 w-11 rounded-2xl items-center justify-center mr-3 border ${cfg.bg} ${cfg.border}`}
                      >
                        <Ionicons
                          name={cfg.icon as any}
                          size={20}
                          color={cfg.color}
                        />
                      </Pressable>
                      <View className="flex-1">
                        <Text
                          allowFontScaling={false}
                          className="text-white font-bold text-base"
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        <Text
                          allowFontScaling={false}
                          className="text-slate-400 text-xs mt-0.5"
                        >
                          {cfg.shortLabel} • Due: {formatDate(item.nextDueDate)}
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => void deleteContact(item.id, item.name)}
                      className="p-2 rounded-xl bg-slate-900"
                    >
                      <Ionicons
                        name="trash-outline"
                        size={17}
                        color="#F43F5E"
                      />
                    </Pressable>
                  </View>

                  {item.note ? (
                    <View className="bg-slate-900/70 px-3 py-2 rounded-xl border border-slate-700/60 mb-3">
                      <Text
                        allowFontScaling={false}
                        className="text-indigo-300 text-xs italic"
                      >
                        📝 নোট: {item.note}
                      </Text>
                    </View>
                  ) : null}

                  {/* Quick Connect Actions */}
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => void handleInteraction(item, "call")}
                      className="flex-1 bg-indigo-600 py-2.5 rounded-xl flex-row items-center justify-center active:bg-indigo-700"
                    >
                      <Ionicons name="call" size={15} color="#FFFFFF" />
                      <Text
                        allowFontScaling={false}
                        className="text-white font-bold text-xs ml-1.5"
                      >
                        Call
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => void handleInteraction(item, "whatsapp")}
                      className="flex-1 bg-emerald-600/20 border border-emerald-500/40 py-2.5 rounded-xl flex-row items-center justify-center"
                    >
                      <Ionicons
                        name="logo-whatsapp"
                        size={15}
                        color="#34D399"
                      />
                      <Text
                        allowFontScaling={false}
                        className="text-emerald-300 font-bold text-xs ml-1.5"
                      >
                        WhatsApp
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => void handleInteraction(item, "done")}
                      className="bg-slate-900 border border-slate-700 px-3.5 py-2.5 rounded-xl flex-row items-center justify-center"
                    >
                      <Ionicons
                        name="checkmark-done"
                        size={16}
                        color="#38BDF8"
                      />
                      <Text
                        allowFontScaling={false}
                        className="text-sky-300 font-bold text-xs ml-1"
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
        <SafeAreaView className="flex-1 bg-slate-900" edges={["top"]}>
          <View className="flex-row justify-between items-center px-6 pt-4 pb-3">
            <Text
              allowFontScaling={false}
              className="text-white text-xl font-bold"
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

          <View className="px-6 mb-3">
            <TextInput
              className="bg-slate-800 text-white px-4 py-3 rounded-2xl border border-slate-700"
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
              contentContainerStyle={{
                paddingHorizontal: 24,
                paddingBottom: 32,
              }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedContactToAdd(item)}
                  className="bg-slate-800 p-4 rounded-2xl mb-2.5 border border-slate-700 flex-row items-center justify-between"
                >
                  <View className="flex-1 pr-3">
                    <Text
                      allowFontScaling={false}
                      className="text-white font-bold text-sm"
                    >
                      {item.name || "Unknown"}
                    </Text>
                    <Text
                      allowFontScaling={false}
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
        <View className="flex-1 bg-black/75 justify-end">
          <View className="bg-slate-900 w-full rounded-t-[32px] p-6 border-t border-slate-700">
            <Text
              allowFontScaling={false}
              className="text-white text-xl font-bold text-center"
            >
              {selectedContactToAdd?.name}
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-400 text-xs text-center mt-1 mb-4"
            >
              কোন ক্যাটাগরিতে রেখে রিমাইন্ডার পেতে চান?
            </Text>

            <TextInput
              placeholder="ছোট নোট (ঐচ্ছিক, যেমন: আঙ্কেলের স্বাস্থ্যের খবর নেব)"
              placeholderTextColor="#64748B"
              value={customNoteInput}
              onChangeText={setCustomNoteInput}
              className="bg-slate-800 text-white px-4 py-3 rounded-xl border border-slate-700 mb-4 text-xs"
            />

            <View className="gap-y-2.5 mb-5">
              {(["family", "friends", "network"] as ContactCategoryType[]).map(
                (cat) => {
                  const cfg = getCategoryConfig(cat);
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => void addContactWithCategory(cat, true)}
                      className="bg-slate-800 p-4 rounded-2xl flex-row items-center border border-slate-700 active:bg-slate-700"
                    >
                      <View
                        className={`p-2.5 rounded-xl mr-3.5 ${cfg.bg} border ${cfg.border}`}
                      >
                        <Ionicons
                          name={cfg.icon as any}
                          size={22}
                          color={cfg.color}
                        />
                      </View>
                      <View className="flex-1">
                        <Text
                          allowFontScaling={false}
                          className="text-white font-bold text-sm"
                        >
                          {cfg.label}
                        </Text>
                        <Text
                          allowFontScaling={false}
                          className="text-slate-400 text-xs mt-0.5"
                        >
                          প্রতি {cfg.intervalDays} দিন পর পর আপনাকে নামসহ
                          নোটিফিকেশন দেবে
                        </Text>
                      </View>
                    </Pressable>
                  );
                },
              )}
            </View>

            <Pressable
              onPress={() => {
                setSelectedContactToAdd(null);
                setCustomNoteInput("");
              }}
              className="py-3.5 rounded-2xl items-center bg-slate-800"
            >
              <Text
                allowFontScaling={false}
                className="text-slate-300 font-bold text-sm"
              >
                বাতিল
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
