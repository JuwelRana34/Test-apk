import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CACHED_USER_PROFILE_KEY,
  CachedUserProfile,
  getInAppNotices,
  syncLocalDataToCloudIfOnline,
} from "../../lib/supabase";

const { FocusLock } = NativeModules;

interface HomeContactItem {
  id: string;
  name: string;
  phoneNumber: string;
  category: "family" | "friends" | "network";
  nextDueDate: number;
  note?: string;
}

export default function HomePage() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();

  const [userName, setUserName] = useState("JnUITS Member");
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [emergencyPasses, setEmergencyPasses] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [isFocusActive, setIsFocusActive] = useState(false);
  const [remainingMins, setRemainingMins] = useState(0);
  const [historyMap, setHistoryMap] = useState<Record<string, number>>({});
  const [dueTodayContacts, setDueTodayContacts] = useState<HomeContactItem[]>(
    [],
  );
  const [totalContacts, setTotalContacts] = useState(0);
  const [unreadNotices, setUnreadNotices] = useState(0);

  // Modern Custom Modal State (Replaces default Alert.alert)
  const [uiModal, setUiModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    color: string;
  }>({
    visible: false,
    title: "",
    message: "",
    icon: "information-outline",
    color: "#38BDF8",
  });

  useFocusEffect(
    useCallback(() => {
      const loadHomeDashboard = async () => {
        try {
          if (Platform.OS === "android" && FocusLock?.applyDarkNavigationBar) {
            void FocusLock.applyDarkNavigationBar();
          }
          void syncLocalDataToCloudIfOnline();

          const [cachedProfileRaw, contactsRaw, noticesList] =
            await Promise.all([
              AsyncStorage.getItem(CACHED_USER_PROFILE_KEY),
              AsyncStorage.getItem("@networking_contacts"),
              getInAppNotices(),
            ]);

          setUnreadNotices(noticesList.filter((n) => !n.read).length);

          if (cachedProfileRaw) {
            const p: CachedUserProfile = JSON.parse(cachedProfileRaw);
            if (p.name) setUserName(p.name);
            if (p.avatarUrl) setAvatarUri(p.avatarUrl);
            setEmergencyPasses(p.emergencyPasses ?? 0);
            setStreakDays(p.streakDays ?? 0);
          }

          if (contactsRaw) {
            const parsed: HomeContactItem[] = JSON.parse(contactsRaw);
            setTotalContacts(parsed.length);
            const todayEnd = new Date().setHours(23, 59, 59, 999);
            const due = parsed
              .filter((c) => c.nextDueDate <= todayEnd)
              .sort((a, b) => a.nextDueDate - b.nextDueDate);
            setDueTodayContacts(due);
          } else {
            setTotalContacts(0);
            setDueTodayContacts([]);
          }

          if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
            const s = await FocusLock.getFocusSessionState();
            const active = !!(s.active && s.endTimeMillis > Date.now());
            setIsFocusActive(active);
            setRemainingMins(
              active
                ? Math.max(1, Math.ceil((s.endTimeMillis - Date.now()) / 60000))
                : 0,
            );
            setEmergencyPasses(s.emergencyPasses ?? 0);
            setStreakDays(s.streakDays ?? 0);
            setTotalCompleted(s.totalCompleted ?? 0);
            if (s.completedHistoryJson) {
              try {
                setHistoryMap(JSON.parse(s.completedHistoryJson));
              } catch {}
            }
          }
        } catch {}
      };
      void loadHomeDashboard();
    }, []),
  );

  // Pick & Open Study PDF directly from Home (Only .pdf files allowed!)
  const handleOpenStudyPdf = async () => {
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
        setUiModal({
          visible: true,
          title: "শুধুমাত্র PDF ফাইল অনুমোদিত",
          message: "পড়াশোনার জন্য শুধুমাত্র .pdf ফাইল সিলেক্ট করুন।",
          icon: "file-alert-outline",
          color: "#F43F5E",
        });
        return;
      }

      if (Platform.OS === "android" && FocusLock?.openPdfUri) {
        await FocusLock.openPdfUri(asset.uri);
      } else {
        await Linking.openURL(asset.uri);
      }
    } catch {
      setUiModal({
        visible: true,
        title: "PDF ওপেন করা যায়নি",
        message:
          "ফোনে News Plus বা Google Drive PDF Viewer ইনস্টল করা আছে কি না চেক করুন।",
        icon: "file-pdf-box",
        color: "#F43F5E",
      });
    }
  };

  // Last 7 days mini focus strip
  const last7Days = useMemo(() => {
    const days = [];
    const dayLetters = ["S", "M", "T", "W", "T", "F", "S"];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const key = `${yyyy}-${mm}-${dd}`;
      const mins = historyMap[key] || 0;
      days.push({
        key,
        letter: dayLetters[d.getDay()],
        dateNum: d.getDate(),
        mins,
        done: mins >= 30,
        isToday: i === 0,
      });
    }
    return days;
  }, [historyMap]);

  const initial = userName.charAt(0).toUpperCase();
  const primaryDueContact = dueTodayContacts[0];

  return (
    <View className="flex-1 bg-[#0B1120]">
      {isFocused && <StatusBar style="light" backgroundColor="#131C31" />}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: Math.max(32, insets.bottom + 20),
        }}
      >
        {/* 1. PREMIUM DARK-INDIGO HERO HEADER */}
        <View
          style={{ paddingTop: Math.max(16, insets.top + 10) }}
          className="bg-[#131C31] pb-6 px-5 rounded-b-[32px] border-b border-indigo-500/20"
        >
          <View className="flex-row justify-between items-center mb-5">
            {/* Profile Greeting */}
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile")}
              activeOpacity={0.8}
              className="flex-row items-center flex-1 pr-3"
            >
              <View className="p-0.5 rounded-full bg-indigo-500/30 border border-indigo-400">
                {avatarUri ? (
                  <Image
                    source={{ uri: avatarUri }}
                    className="w-11 h-11 rounded-full"
                  />
                ) : (
                  <View className="w-11 h-11 rounded-full bg-indigo-600 items-center justify-center">
                    <Text className="text-white font-black text-base">
                      {initial}
                    </Text>
                  </View>
                )}
              </View>
              <View className="ml-3 flex-1">
                <Text
                  allowFontScaling={false}
                  className="text-indigo-300 text-[11px] font-bold uppercase tracking-wider"
                >
                  Productivity Suite
                </Text>
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-white text-lg font-black mt-0.5"
                >
                  {userName}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Top Action Buttons */}
            <View className="flex-row items-center gap-2.5">
              <TouchableOpacity
                onPress={() => void handleOpenStudyPdf()}
                className="w-10 h-10 rounded-2xl bg-sky-500/15 border border-sky-500/30 items-center justify-center"
              >
                <MaterialCommunityIcons
                  name="file-pdf-box"
                  size={22}
                  color="#38BDF8"
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push("/(tabs)/notice")}
                className="w-10 h-10 rounded-2xl bg-slate-800/90 border border-slate-700 items-center justify-center relative"
              >
                <MaterialCommunityIcons
                  name="bell-outline"
                  size={21}
                  color="#E2E8F0"
                />
                {unreadNotices > 0 && (
                  <View className="absolute top-2 right-2 w-2.5 h-2.5 bg-rose-500 rounded-full border border-[#131C31]" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Overflow-Proof Pass, Streak & Focus Button Card */}
          <View className="bg-[#0B1120]/90 border border-slate-800 p-3 rounded-2xl flex-row items-center justify-between">
            <Pressable
              onPress={() => router.push("/(tabs)/profile")}
              className="flex-row items-center flex-1 mr-2"
            >
              <View className="flex-row items-center flex-1">
                <View className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 items-center justify-center">
                  <MaterialCommunityIcons
                    name="ticket-confirmation"
                    size={16}
                    color="#FBBF24"
                  />
                </View>
                <View className="ml-2 flex-shrink">
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    className="text-white font-black text-xs"
                  >
                    {emergencyPasses}/5 Pass
                  </Text>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    className="text-slate-400 text-[10px]"
                  >
                    Unlock
                  </Text>
                </View>
              </View>

              <View className="w-[1px] h-7 bg-slate-800 mx-2" />

              <View className="flex-row items-center flex-1">
                <View className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 items-center justify-center">
                  <MaterialCommunityIcons
                    name="fire"
                    size={17}
                    color="#34D399"
                  />
                </View>
                <View className="ml-2 flex-shrink">
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    className="text-white font-black text-xs"
                  >
                    {streakDays}/3d Streak
                  </Text>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    className="text-slate-400 text-[10px]"
                  >
                    {totalCompleted} Done
                  </Text>
                </View>
              </View>
            </Pressable>

            <Pressable
              onPress={() => router.push("/features/StrictFocusScreen")}
              className={`px-3 py-2 rounded-xl flex-row items-center border flex-shrink-0 ${
                isFocusActive
                  ? "bg-rose-500/20 border-rose-500/50"
                  : "bg-indigo-600 border-indigo-500"
              }`}
            >
              <MaterialCommunityIcons
                name={isFocusActive ? "shield-lock" : "rocket-launch"}
                size={14}
                color="#FFFFFF"
              />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                className="text-white font-black text-[11px] ml-1"
              >
                {isFocusActive ? `${remainingMins}m` : "Focus"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* 2. 2x2 MODERN BENTO GRID */}
        <View className="px-4 mt-5">
          <View className="flex-row items-center justify-between mb-3 px-1">
            <Text
              allowFontScaling={false}
              className="text-white font-black text-base"
            >
              Core Workspace
            </Text>
            <Text
              allowFontScaling={false}
              className="text-indigo-400 font-bold text-xs"
            >
              4 Active Modules
            </Text>
          </View>

          {/* Row 1: Strict Focus Lock + Smart Contact CRM */}
          <View className="flex-row gap-3 mb-3">
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push("/features/StrictFocusScreen")}
              className="flex-1 bg-[#131C31] border border-rose-500/30 p-4 rounded-3xl justify-between"
              style={{ minHeight: 148 }}
            >
              <View className="flex-row items-center justify-between">
                <View className="w-11 h-11 rounded-2xl bg-rose-500/15 border border-rose-500/30 items-center justify-center">
                  <MaterialCommunityIcons
                    name="shield-lock"
                    size={24}
                    color="#F43F5E"
                  />
                </View>
                <View
                  className={`px-2.5 py-1 rounded-full border ${
                    isFocusActive
                      ? "bg-rose-500/20 border-rose-500/50"
                      : "bg-slate-800 border-slate-700"
                  }`}
                >
                  <Text
                    allowFontScaling={false}
                    className={`font-black text-[10px] ${
                      isFocusActive ? "text-rose-300" : "text-slate-300"
                    }`}
                  >
                    {isFocusActive ? "LOCKED" : "25m / 50m"}
                  </Text>
                </View>
              </View>

              <View className="mt-4">
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-white font-black text-base"
                >
                  Strict Focus Lock
                </Text>
                <Text
                  allowFontScaling={false}
                  numberOfLines={2}
                  className="text-slate-400 text-[11px] mt-1 leading-4"
                >
                  Reels ও Shorts ব্লকার, অ্যাপ ও ওয়েবসাইট লক
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push("/features/SmartNetworking")}
              className="flex-1 bg-[#131C31] border border-emerald-500/30 p-4 rounded-3xl justify-between"
              style={{ minHeight: 148 }}
            >
              <View className="flex-row items-center justify-between">
                <View className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 items-center justify-center">
                  <MaterialCommunityIcons
                    name="account-heart"
                    size={24}
                    color="#34D399"
                  />
                </View>
                <View
                  className={`px-2.5 py-1 rounded-full border ${
                    dueTodayContacts.length > 0
                      ? "bg-emerald-500/20 border-emerald-500/50"
                      : "bg-slate-800 border-slate-700"
                  }`}
                >
                  <Text
                    allowFontScaling={false}
                    className={`font-black text-[10px] ${
                      dueTodayContacts.length > 0
                        ? "text-emerald-300"
                        : "text-slate-300"
                    }`}
                  >
                    {dueTodayContacts.length > 0
                      ? `${dueTodayContacts.length} DUE TODAY`
                      : `${totalContacts} SAVED`}
                  </Text>
                </View>
              </View>

              <View className="mt-4">
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-white font-black text-base"
                >
                  Contact CRM
                </Text>
                <Text
                  allowFontScaling={false}
                  numberOfLines={2}
                  className="text-slate-400 text-[11px] mt-1 leading-4"
                >
                  পরিবার, বন্ধু ও নেটওয়ার্কের সন্ধ্যা ৭টার রিমাইন্ডার
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Row 2: Hard Alarm + Study PDF Reader */}
          <View className="flex-row gap-3">
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push("/features/alarm")}
              className="flex-1 bg-[#131C31] border border-violet-500/30 p-4 rounded-3xl justify-between"
              style={{ minHeight: 148 }}
            >
              <View className="flex-row items-center justify-between">
                <View className="w-11 h-11 rounded-2xl bg-violet-500/15 border border-violet-500/30 items-center justify-center">
                  <MaterialCommunityIcons
                    name="alarm-light"
                    size={24}
                    color="#A78BFA"
                  />
                </View>
                <View className="px-2.5 py-1 rounded-full bg-violet-500/15 border border-violet-500/30">
                  <Text
                    allowFontScaling={false}
                    className="text-violet-300 font-black text-[10px]"
                  >
                    90m CYCLE
                  </Text>
                </View>
              </View>

              <View className="mt-4">
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-white font-black text-base"
                >
                  Hard Alarm
                </Text>
                <Text
                  allowFontScaling={false}
                  numberOfLines={2}
                  className="text-slate-400 text-[11px] mt-1 leading-4"
                >
                  ম্যাথ পাজল ও ৯০ মিনিট স্লিপ সাইকেল ক্যালকুলেটর
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => void handleOpenStudyPdf()}
              className="flex-1 bg-[#131C31] border border-sky-500/30 p-4 rounded-3xl justify-between"
              style={{ minHeight: 148 }}
            >
              <View className="flex-row items-center justify-between">
                <View className="w-11 h-11 rounded-2xl bg-sky-500/15 border border-sky-500/30 items-center justify-center">
                  <MaterialCommunityIcons
                    name="file-pdf-box"
                    size={26}
                    color="#38BDF8"
                  />
                </View>
                <View className="px-2.5 py-1 rounded-full bg-sky-500/15 border border-sky-500/30">
                  <Text
                    allowFontScaling={false}
                    className="text-sky-300 font-black text-[10px]"
                  >
                    ONLY .PDF
                  </Text>
                </View>
              </View>

              <View className="mt-4">
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className="text-white font-black text-base"
                >
                  Study PDF Reader
                </Text>
                <Text
                  allowFontScaling={false}
                  numberOfLines={2}
                  className="text-slate-400 text-[11px] mt-1 leading-4"
                >
                  News Plus ও Drive PDF ভিউয়ারে নিরাপদ পড়াশোনা
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* 3. LIVE 7-DAY FOCUS STREAK STRIP */}
        <View className="px-4 mt-4">
          <Pressable
            onPress={() => router.push("/(tabs)/profile")}
            className="bg-[#131C31] border border-slate-800 p-4 rounded-3xl"
          >
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center">
                <MaterialCommunityIcons
                  name="calendar-check"
                  size={17}
                  color="#34D399"
                />
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-xs ml-2"
                >
                  This Week&apos;s Focus Activity
                </Text>
              </View>
              <Text
                allowFontScaling={false}
                className="text-indigo-400 font-bold text-[11px]"
              >
                60-Day Graph →
              </Text>
            </View>

            <View className="flex-row justify-between">
              {last7Days.map((d) => (
                <View key={d.key} className="items-center">
                  <Text
                    allowFontScaling={false}
                    className="text-slate-500 font-bold text-[10px] mb-1.5"
                  >
                    {d.letter}
                  </Text>
                  <View
                    className={`w-9 h-9 rounded-xl items-center justify-center border ${
                      d.done
                        ? "bg-emerald-500/20 border-emerald-400"
                        : d.isToday
                          ? "bg-indigo-500/15 border-indigo-400/60"
                          : "bg-[#0B1120] border-slate-800"
                    }`}
                  >
                    {d.done ? (
                      <MaterialCommunityIcons
                        name="check-bold"
                        size={16}
                        color="#34D399"
                      />
                    ) : (
                      <Text
                        allowFontScaling={false}
                        className={`text-xs font-bold ${
                          d.isToday ? "text-indigo-300" : "text-slate-500"
                        }`}
                      >
                        {d.dateNum}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </Pressable>
        </View>

        {/* 4. SMART QUICK ACTIONS */}
        <View className="px-4 mt-5">
          <Text
            allowFontScaling={false}
            className="text-white font-black text-base mb-3 px-1"
          >
            Quick Actions
          </Text>

          {primaryDueContact ? (
            <View className="bg-[#131C31] border border-emerald-500/30 p-4 rounded-3xl mb-3">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center flex-1 pr-2">
                  <View className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 items-center justify-center mr-3">
                    <MaterialCommunityIcons
                      name="phone-ring"
                      size={20}
                      color="#34D399"
                    />
                  </View>
                  <View className="flex-1">
                    <Text
                      allowFontScaling={false}
                      className="text-emerald-300 font-bold text-[10px] uppercase tracking-wider"
                    >
                      আজ কথা বলার রিমাইন্ডার ({dueTodayContacts.length} জন)
                    </Text>
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      className="text-white font-black text-base mt-0.5"
                    >
                      {primaryDueContact.name}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => router.push("/features/SmartNetworking")}
                  className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700"
                >
                  <Text
                    allowFontScaling={false}
                    className="text-slate-300 font-bold text-[11px]"
                  >
                    See All
                  </Text>
                </Pressable>
              </View>

              <View className="flex-row gap-2.5">
                <Pressable
                  onPress={() =>
                    void Linking.openURL(`tel:${primaryDueContact.phoneNumber}`)
                  }
                  className="flex-1 bg-indigo-600 py-2.5 rounded-xl flex-row items-center justify-center"
                >
                  <Ionicons name="call" size={14} color="#FFFFFF" />
                  <Text
                    allowFontScaling={false}
                    className="text-white font-bold text-xs ml-1.5"
                  >
                    সরাসরি কল করুন
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void Linking.openURL(
                      `whatsapp://send?phone=${primaryDueContact.phoneNumber}`,
                    )
                  }
                  className="flex-1 bg-emerald-500/15 border border-emerald-500/40 py-2.5 rounded-xl flex-row items-center justify-center"
                >
                  <Ionicons name="logo-whatsapp" size={14} color="#34D399" />
                  <Text
                    allowFontScaling={false}
                    className="text-emerald-300 font-bold text-xs ml-1.5"
                  >
                    WhatsApp
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push("/features/SmartNetworking")}
              className="bg-[#131C31] border border-slate-800 p-4 rounded-3xl flex-row items-center mb-3"
            >
              <View className="w-11 h-11 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl items-center justify-center mr-3.5">
                <MaterialCommunityIcons
                  name="account-multiple-check"
                  size={22}
                  color="#34D399"
                />
              </View>
              <View className="flex-1 pr-2">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  আজ কারো কল রিমাইন্ডার নেই
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-xs mt-0.5"
                >
                  ট্যাপ করে পরিবার ও বন্ধুদের পরবর্তী রিমাইন্ডার তারিখ দেখুন
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#64748B" />
            </TouchableOpacity>
          )}

          {/* Action 2: Quick Focus Lock & Schedule Setup */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push("/features/StrictFocusScreen")}
            className="bg-[#131C31] border border-slate-800 p-4 rounded-3xl flex-row items-center"
          >
            <View className="w-11 h-11 bg-rose-500/15 border border-rose-500/30 rounded-2xl items-center justify-center mr-3.5">
              <MaterialCommunityIcons
                name="timer-lock-outline"
                size={22}
                color="#F43F5E"
              />
            </View>
            <View className="flex-1 pr-2">
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-sm"
              >
                {isFocusActive
                  ? "ফোকাস লক ড্যাশবোর্ডে ফিরে যান"
                  : "Start 25m/5m Session or 50m/10m Schedule"}
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-xs mt-0.5"
              >
                সেশন লক (সর্বোচ্চ ৬ ঘণ্টা) • শিডিউল লক (সর্বোচ্চ ১৫ ঘণ্টা)
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#64748B" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* MODERN CUSTOM MODAL (Replaces default Alert.alert) */}
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
              className="w-full bg-indigo-600 py-3.5 rounded-2xl items-center active:bg-indigo-700"
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
    </View>
  );
}
