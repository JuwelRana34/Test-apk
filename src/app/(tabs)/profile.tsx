import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
  clearAllLocalAccountData,
  supabase,
  syncLocalDataToCloudIfOnline,
} from "../../lib/supabase";

const { FocusLock } = NativeModules;

interface DayCell {
  dateStr: string;
  label: string;
  minutes: number;
  isToday: boolean;
}

export default function Profile() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<CachedUserProfile | null>(null);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [historyMap, setHistoryMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Modern Custom Day Details Modal (Replaces Alert.alert when tapping a 60-day heatmap cell!)
  const [selectedCell, setSelectedCell] = useState<DayCell | null>(null);

  const loadUserProfileOfflineFirst = useCallback(async () => {
    try {
      const cachedRaw = await AsyncStorage.getItem(CACHED_USER_PROFILE_KEY);
      if (cachedRaw) {
        setProfile(JSON.parse(cachedRaw));
        setLoading(false);
      }

      await syncLocalDataToCloudIfOnline();

      let passes = 0;
      let streak = 0;
      let completed = 0;
      let parsedHistory: Record<string, number> = {};

      if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
        try {
          const s = await FocusLock.getFocusSessionState();
          passes = s.emergencyPasses ?? 0;
          streak = s.streakDays ?? 0;
          completed = s.totalCompleted ?? 0;
          setTotalCompleted(completed);
          if (s.completedHistoryJson) {
            parsedHistory = JSON.parse(s.completedHistoryJson);
            setHistoryMap(parsedHistory);
          }
        } catch {}
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const cloudBackup = user.user_metadata?.jnuits_backup_v2 || {};
        const cloudHistory = cloudBackup.completedHistory || {};
        const mergedHistory: Record<string, number> = { ...cloudHistory };
        Object.keys(parsedHistory).forEach((k) => {
          mergedHistory[k] = Math.max(
            mergedHistory[k] || 0,
            parsedHistory[k] || 0,
          );
        });
        setHistoryMap(mergedHistory);

        const mergedCompleted = Math.max(
          completed,
          cloudBackup.totalCompleted ?? 0,
          Object.keys(mergedHistory).length,
        );
        setTotalCompleted(mergedCompleted);

        const freshProfile: CachedUserProfile = {
          id: user.id,
          name:
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            "JnUITS Member",
          email: user.email || "",
          avatarUrl:
            user.user_metadata?.avatar_url || user.user_metadata?.picture,
          emergencyPasses: passes,
          streakDays: streak,
          lastSyncedAt: Date.now(),
        };
        setProfile(freshProfile);
        await AsyncStorage.setItem(
          CACHED_USER_PROFILE_KEY,
          JSON.stringify(freshProfile),
        );
      } else if (cachedRaw) {
        const parsed: CachedUserProfile = JSON.parse(cachedRaw);
        setProfile({
          ...parsed,
          emergencyPasses: passes,
          streakDays: streak,
        });
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadUserProfileOfflineFirst();
    }, [loadUserProfileOfflineFirst]),
  );

  // Build 60-Day (9 Weeks x 7 Days = 63 cells ending Today) GitHub-style Contribution Grid
  const heatmapData = useMemo(() => {
    const totalDays = 63;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cells: DayCell[] = [];
    let activeDaysCount = 0;
    let totalFocusMins60d = 0;

    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const mins = historyMap[dateStr] || 0;

      if (i < 60 && mins >= 30) {
        activeDaysCount++;
      }
      if (i < 60) {
        totalFocusMins60d += mins;
      }

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
      cells.push({
        dateStr,
        label: `${months[d.getMonth()]} ${d.getDate()}`,
        minutes: mins,
        isToday: i === 0,
      });
    }

    const weeks: DayCell[][] = [];
    for (let w = 0; w < 9; w++) {
      weeks.push(cells.slice(w * 7, w * 7 + 7));
    }

    return {
      weeks,
      activeDaysCount,
      totalFocusHours: (totalFocusMins60d / 60).toFixed(1),
    };
  }, [historyMap]);

  const getGitHubGreenClass = (mins: number) => {
    if (mins <= 0) return "bg-slate-800/90 border-slate-700/60";
    if (mins < 45) return "bg-emerald-900 border-emerald-700/70";
    if (mins < 90) return "bg-emerald-700 border-emerald-500/80";
    if (mins < 180) return "bg-emerald-500 border-emerald-400";
    return "bg-emerald-400 border-emerald-200";
  };

  const handleManualSync = async () => {
    setSyncing(true);
    await syncLocalDataToCloudIfOnline();
    await loadUserProfileOfflineFirst();
    setSyncing(false);
  };

  // 🌟 Account-Wise Isolation on Sign Out: Syncs current account first, then wipes local & native state clean!
  const handleLogout = async () => {
    try {
      await syncLocalDataToCloudIfOnline();
      await clearAllLocalAccountData();
      try {
        await supabase.auth.signOut();
      } catch {}
      try {
        await GoogleSignin.signOut();
      } catch {}
      router.replace("/(auth)/login");
    } catch {}
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#0B1120]">
        <ActivityIndicator size="large" color="#818CF8" />
      </View>
    );
  }

  const fullName = profile?.name || "JnUITS Member";
  const email = profile?.email || "Google Account Connected";
  const avatarUrl = profile?.avatarUrl;
  const initial = fullName.charAt(0).toUpperCase();
  const passes = profile?.emergencyPasses ?? 0;
  const streak = profile?.streakDays ?? 0;

  return (
    <View className="flex-1 bg-[#0B1120]">
      {isFocused && <StatusBar style="light" backgroundColor="#131C31" />}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: Math.max(32, insets.bottom + 20),
        }}
      >
        {/* Curved Gradient Hero Header */}
        <View
          style={{ paddingTop: Math.max(20, insets.top + 12) }}
          className="bg-[#131C31] pb-7 px-6 rounded-b-[36px] border-b border-indigo-500/25 items-center"
        >
          <View className="p-1 rounded-full bg-indigo-500/25 border-2 border-indigo-400">
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                className="h-22 w-22 rounded-full"
                style={{ width: 84, height: 84, borderRadius: 42 }}
              />
            ) : (
              <View className="h-20 w-20 items-center justify-center rounded-full bg-indigo-600">
                <Text className="text-3xl font-black text-white">
                  {initial}
                </Text>
              </View>
            )}
          </View>

          <Text
            allowFontScaling={false}
            numberOfLines={1}
            className="mt-3 text-2xl font-black text-white text-center"
          >
            {fullName}
          </Text>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            className="mt-0.5 text-indigo-200/80 text-xs font-medium"
          >
            {email}
          </Text>

          <View className="mt-3 bg-emerald-500/15 border border-emerald-500/40 px-3.5 py-1 rounded-full flex-row items-center">
            <MaterialCommunityIcons
              name="check-decagram"
              size={15}
              color="#34D399"
            />
            <Text
              allowFontScaling={false}
              className="text-emerald-300 font-bold text-[11px] ml-1.5"
            >
              Verified Profile • {totalCompleted} Locks Completed
            </Text>
          </View>
        </View>

        {/* 2-Column Gamified Pass & Streak Cards */}
        <View className="flex-row gap-3 px-4 mt-4">
          <View className="flex-1 bg-[#131C31] border border-slate-800 p-4 rounded-3xl">
            <View className="flex-row items-center justify-between mb-2">
              <View className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 items-center justify-center">
                <MaterialCommunityIcons
                  name="ticket-confirmation"
                  size={18}
                  color="#FBBF24"
                />
              </View>
              <Text
                allowFontScaling={false}
                className="text-amber-400 font-black text-xl"
              >
                {passes}/5
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              className="text-white font-bold text-xs mb-2"
            >
              Emergency Passes
            </Text>
            <View className="flex-row gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <View
                  key={i}
                  className={`flex-1 h-2 rounded-full ${
                    passes >= i ? "bg-amber-400" : "bg-slate-800"
                  }`}
                />
              ))}
            </View>
          </View>

          <View className="flex-1 bg-[#131C31] border border-slate-800 p-4 rounded-3xl">
            <View className="flex-row items-center justify-between mb-2">
              <View className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 items-center justify-center">
                <MaterialCommunityIcons name="fire" size={19} color="#34D399" />
              </View>
              <Text
                allowFontScaling={false}
                className="text-emerald-400 font-black text-xl"
              >
                {streak}/3d
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              className="text-white font-bold text-xs mb-2"
            >
              3-Day Pass Streak
            </Text>
            <View className="flex-row gap-1.5">
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  className={`flex-1 h-2 rounded-full ${
                    streak >= i ? "bg-emerald-400" : "bg-slate-800"
                  }`}
                />
              ))}
            </View>
          </View>
        </View>

        {/* LAST 2 MONTHS (60 DAYS) GITHUB-STYLE GREEN STREAK HEATMAP */}
        <View className="mx-4 mt-4 rounded-3xl bg-[#131C31] border border-slate-800 p-4">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center flex-1 pr-2">
              <View className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 items-center justify-center mr-2.5">
                <MaterialCommunityIcons
                  name="calendar-multiselect"
                  size={18}
                  color="#34D399"
                />
              </View>
              <View className="flex-1">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  Last 60 Days Focus Streak
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-[11px]"
                >
                  {heatmapData.activeDaysCount} Active Days •{" "}
                  {heatmapData.totalFocusHours}h Total Focus
                </Text>
              </View>
            </View>

            <View className="bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-full">
              <Text
                allowFontScaling={false}
                className="text-emerald-300 font-black text-[10px]"
              >
                2 Months
              </Text>
            </View>
          </View>

          {/* 9 Weeks x 7 Days Matrix */}
          <View className="bg-[#0B1120] p-3 rounded-2xl border border-slate-800/80">
            <View className="flex-row justify-between items-center">
              <View
                className="justify-between mr-1.5 py-0.5"
                style={{ height: 118 }}
              >
                {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                  <Text
                    key={idx}
                    allowFontScaling={false}
                    className="text-[9px] font-bold text-slate-500 leading-3"
                  >
                    {d}
                  </Text>
                ))}
              </View>

              <View className="flex-1 flex-row justify-between">
                {heatmapData.weeks.map((week, wIdx) => (
                  <View key={wIdx} className="gap-y-1.5">
                    {week.map((cell) => (
                      <Pressable
                        key={cell.dateStr}
                        onPress={() => setSelectedCell(cell)}
                        className={`w-6 h-3.5 rounded-[4px] border ${getGitHubGreenClass(
                          cell.minutes,
                        )} ${cell.isToday ? "border-white" : ""}`}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </View>

            <View className="flex-row items-center justify-between mt-3 pt-2 border-t border-slate-800/80">
              <Text
                allowFontScaling={false}
                className="text-[10px] text-slate-400"
              >
                ট্যাপ করে প্রতিদিনের রেকর্ড দেখুন
              </Text>
              <View className="flex-row items-center gap-1">
                <Text
                  allowFontScaling={false}
                  className="text-[10px] text-slate-400 mr-1"
                >
                  Less
                </Text>
                <View className="w-3 h-3 rounded-[3px] bg-slate-800 border border-slate-700" />
                <View className="w-3 h-3 rounded-[3px] bg-emerald-900 border border-emerald-700" />
                <View className="w-3 h-3 rounded-[3px] bg-emerald-700 border border-emerald-500" />
                <View className="w-3 h-3 rounded-[3px] bg-emerald-500 border border-emerald-400" />
                <View className="w-3 h-3 rounded-[3px] bg-emerald-400 border border-emerald-200" />
                <Text
                  allowFontScaling={false}
                  className="text-[10px] text-slate-400 ml-1"
                >
                  More
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Cloud Backup & Sync Card */}
        <View className="mx-4 mt-4 rounded-3xl bg-[#131C31] border border-slate-800 p-4 flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 pr-3">
            <View className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 items-center justify-center mr-3">
              <MaterialCommunityIcons
                name="cloud-check-outline"
                size={20}
                color="#818CF8"
              />
            </View>
            <View className="flex-1">
              <Text
                allowFontScaling={false}
                className="text-sm font-bold text-white"
              >
                Account-Wise Cloud Backup
              </Text>
              <Text
                allowFontScaling={false}
                className="text-[11px] text-slate-400 mt-0.5"
              >
                এই Gmail অ্যাকাউন্টের নিজস্ব ডাটা সিঙ্ক সচল আছে
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => void handleManualSync()}
            disabled={syncing}
            className="bg-indigo-600 px-3.5 py-2.5 rounded-xl flex-row items-center active:bg-indigo-700"
          >
            <MaterialCommunityIcons name="sync" size={15} color="#FFFFFF" />
            <Text
              allowFontScaling={false}
              className="text-white font-bold text-xs ml-1.5"
            >
              {syncing ? "Syncing" : "Sync"}
            </Text>
          </Pressable>
        </View>

        {/* Modern Navigation Cards */}
        <View className="mx-4 mt-4 rounded-3xl bg-[#131C31] border border-slate-800 overflow-hidden">
          <MenuItem
            icon="shield-lock"
            color="#F43F5E"
            bg="bg-rose-500/15"
            title="Strict Focus Lock & Study YT"
            subtitle="25m/5m Session, 50m/10m Schedule & 3.5h Class YT"
            onPress={() => router.push("/features/StrictFocusScreen")}
          />
          <MenuItem
            icon="account-heart"
            color="#34D399"
            bg="bg-emerald-500/15"
            title="3-Category Contact CRM"
            subtitle="পরিবার, বন্ধু ও পরিচিতদের সন্ধ্যা ৭টার রিমাইন্ডার"
            onPress={() => router.push("/features/SmartNetworking")}
          />
          <MenuItem
            icon="alarm-light"
            color="#A78BFA"
            bg="bg-violet-500/15"
            title="90-Min Sleep Cycle Hard Alarm"
            subtitle="ম্যাথ পাজল ও স্লিপ সাইকেল অ্যালার্ম"
            onPress={() => router.push("/features/alarm")}
          />
          <MenuItem
            icon="bell-ring"
            color="#38BDF8"
            bg="bg-sky-500/15"
            title="Notification Center"
            subtitle="সকল রিমাইন্ডার ও ফোকাস অ্যালার্ট ম্যানেজ করুন"
            onPress={() => router.push("/(tabs)/notice")}
            isLast
          />
        </View>

        {/* Sleek Logout Button */}
        <Pressable
          onPress={() => void handleLogout()}
          className="mx-4 mt-5 flex-row items-center justify-center rounded-2xl bg-rose-500/15 border border-rose-500/40 p-4 active:bg-rose-500/25"
        >
          <Ionicons name="log-out-outline" size={20} color="#F43F5E" />
          <Text
            allowFontScaling={false}
            className="ml-2 text-sm font-black text-rose-400"
          >
            Sign Out of Google Account
          </Text>
        </Pressable>
      </ScrollView>

      {/* MODERN 60-DAY HEATMAP CELL DETAILS MODAL */}
      <Modal
        visible={!!selectedCell}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedCell(null)}
      >
        <View className="flex-1 bg-black/80 justify-center items-center px-6">
          <View className="bg-[#131C31] w-full rounded-3xl p-6 border border-slate-700 items-center">
            <View
              className={`w-16 h-16 rounded-2xl items-center justify-center mb-4 border ${
                (selectedCell?.minutes || 0) > 0
                  ? "bg-emerald-500/20 border-emerald-400/50"
                  : "bg-slate-800 border-slate-700"
              }`}
            >
              <MaterialCommunityIcons
                name={
                  (selectedCell?.minutes || 0) > 0
                    ? "calendar-check"
                    : "calendar-blank-outline"
                }
                size={32}
                color={(selectedCell?.minutes || 0) > 0 ? "#34D399" : "#94A3B8"}
              />
            </View>
            <Text
              allowFontScaling={false}
              className="text-white font-black text-lg text-center mb-1.5"
            >
              {selectedCell?.label} ({selectedCell?.dateStr})
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-300 text-xs text-center leading-5 mb-5"
            >
              {(selectedCell?.minutes || 0) > 0
                ? `এই দিনে আপনি মোট ${selectedCell?.minutes} মিনিট কড়া ফোকাস লক সফলভাবে পূর্ণ করেছেন।`
                : "এই দিনে কোনো ৩০+ মিনিটের ফোকাস লক রেকর্ড করা হয়নি।"}
            </Text>
            <Pressable
              onPress={() => setSelectedCell(null)}
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

function MenuItem({
  icon,
  color,
  bg,
  title,
  subtitle,
  onPress,
  isLast,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  bg: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
  isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className={`flex-row items-center justify-between p-4 ${
        isLast ? "" : "border-b border-slate-800"
      }`}
    >
      <View className="flex-row items-center flex-1 pr-3">
        <View
          className={`w-10 h-10 rounded-2xl ${bg} items-center justify-center mr-3.5`}
        >
          <MaterialCommunityIcons name={icon} size={20} color={color} />
        </View>
        <View className="flex-1">
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            className="text-sm font-bold text-white"
          >
            {title}
          </Text>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            className="text-[11px] text-slate-400 mt-0.5"
          >
            {subtitle}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#64748B" />
    </TouchableOpacity>
  );
}
