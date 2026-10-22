import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
   supabase,
  syncLocalDataToCloudIfOnline,
} from "../../lib/supabase";

const { FocusLock } = NativeModules;

export default function Profile() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<CachedUserProfile | null>(null);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadUserProfileOfflineFirst = useCallback(async () => {
    try {
      const cachedRaw = await AsyncStorage.getItem(CACHED_USER_PROFILE_KEY);
      if (cachedRaw) {
        setProfile(JSON.parse(cachedRaw));
        setLoading(false);
      }

      let passes = 0;
      let streak = 0;
      let completed = 0;
      if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
        try {
          const s = await FocusLock.getFocusSessionState();
          passes = s.emergencyPasses ?? 0;
          streak = s.streakDays ?? 0;
          completed = s.totalCompleted ?? 0;
          setTotalCompleted(completed);
        } catch {}
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
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

  const handleManualSync = async () => {
    setSyncing(true);
    await syncLocalDataToCloudIfOnline();
    await loadUserProfileOfflineFirst();
    setSyncing(false);
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem("@is_logged_in");
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
      <View className="flex-1 items-center justify-center bg-[#0F172A]">
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
    <View className="flex-1 bg-[#0F172A]">
      {isFocused && <StatusBar style="light" />}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: Math.max(32, insets.bottom + 20),
        }}
      >
        {/* 🌟 Curved Gradient Hero Header */}
        <View
          style={{ paddingTop: Math.max(20, insets.top + 12) }}
          className="bg-[#1E1B4B] pb-8 px-6 rounded-b-[36px] border-b border-indigo-500/30 items-center"
        >
          <View className="p-1 rounded-full bg-indigo-500/30 border-2 border-indigo-400">
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                className="h-24 w-24 rounded-full"
              />
            ) : (
              <View className="h-24 w-24 items-center justify-center rounded-full bg-indigo-600">
                <Text className="text-3xl font-black text-white">
                  {initial}
                </Text>
              </View>
            )}
          </View>

          <Text
            allowFontScaling={false}
            numberOfLines={1}
            className="mt-3.5 text-2xl font-black text-white text-center"
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
            <Ionicons name="checkmark-circle" size={14} color="#34D399" />
            <Text
              allowFontScaling={false}
              className="text-emerald-300 font-bold text-[11px] ml-1.5"
            >
              Verified Google Profile • {totalCompleted} Sessions Done
            </Text>
          </View>
        </View>

        {/* 🌟 2-Column Gamified Pass & Streak Cards */}
        <View className="flex-row gap-3 px-4 mt-5">
          <View className="flex-1 bg-slate-800/90 border border-slate-700 p-4 rounded-3xl">
            <View className="flex-row items-center justify-between mb-2">
              <View className="w-9 h-9 rounded-xl bg-amber-500/20 items-center justify-center">
                <Ionicons name="ticket" size={18} color="#FBBF24" />
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
                    passes >= i ? "bg-amber-400" : "bg-slate-700"
                  }`}
                />
              ))}
            </View>
          </View>

          <View className="flex-1 bg-slate-800/90 border border-slate-700 p-4 rounded-3xl">
            <View className="flex-row items-center justify-between mb-2">
              <View className="w-9 h-9 rounded-xl bg-emerald-500/20 items-center justify-center">
                <Ionicons name="flame" size={18} color="#34D399" />
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
                    streak >= i ? "bg-emerald-400" : "bg-slate-700"
                  }`}
                />
              ))}
            </View>
          </View>
        </View>

        {/* 🌟 Cloud Backup & Sync Card */}
        <View className="mx-4 mt-4 rounded-3xl bg-slate-800/90 border border-slate-700 p-4 flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 pr-3">
            <View className="w-10 h-10 rounded-2xl bg-indigo-500/20 items-center justify-center mr-3">
              <Ionicons name="cloud-done" size={20} color="#818CF8" />
            </View>
            <View className="flex-1">
              <Text
                allowFontScaling={false}
                className="text-sm font-bold text-white"
              >
                Cloud Profile Backup
              </Text>
              <Text
                allowFontScaling={false}
                className="text-[11px] text-slate-400 mt-0.5"
              >
                অফলাইন + অনলাইন অটো সিঙ্ক সচল আছে
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => void handleManualSync()}
            disabled={syncing}
            className="bg-indigo-600 px-3.5 py-2.5 rounded-xl flex-row items-center active:bg-indigo-700"
          >
            <Ionicons name="sync" size={14} color="#FFFFFF" />
            <Text
              allowFontScaling={false}
              className="text-white font-bold text-xs ml-1.5"
            >
              {syncing ? "Syncing" : "Sync"}
            </Text>
          </Pressable>
        </View>

        {/* 🌟 Modern Navigation Cards */}
        <View className="mx-4 mt-4 rounded-3xl bg-slate-800/90 border border-slate-700 overflow-hidden">
          <MenuItem
            icon="shield-checkmark"
            color="#F43F5E"
            bg="bg-rose-500/15"
            title="Strict Focus Lock & Passes"
            subtitle="25m/5m Session, Schedule & Website Rules"
            onPress={() => router.push("/features/StrictFocusScreen")}
          />
          <MenuItem
            icon="people"
            color="#34D399"
            bg="bg-emerald-500/15"
            title="3-Category Contact CRM"
            subtitle="পরিবার, বন্ধু ও পরিচিতদের সন্ধ্যা ৭টার রিমাইন্ডার"
            onPress={() => router.push("/features/SmartNetworking")}
          />
          <MenuItem
            icon="alarm"
            color="#A78BFA"
            bg="bg-violet-500/15"
            title="90-Min Sleep Cycle Hard Alarm"
            subtitle="ম্যাথ পাজল ও স্লিপ সাইকেল অ্যালার্ম"
            onPress={() => router.push("/features/alarm")}
          />
          <MenuItem
            icon="notifications"
            color="#38BDF8"
            bg="bg-sky-500/15"
            title="Notification Center"
            subtitle="সকল রিমাইন্ডার ও ফোকাস অ্যালার্ট"
            onPress={() => router.push("/(tabs)/notice")}
            isLast
          />
        </View>

        {/* 🌟 Sleek Logout Button */}
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
  icon: keyof typeof Ionicons.glyphMap;
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
        isLast ? "" : "border-b border-slate-700/60"
      }`}
    >
      <View className="flex-row items-center flex-1 pr-3">
        <View
          className={`w-10 h-10 rounded-2xl ${bg} items-center justify-center mr-3.5`}
        >
          <Ionicons name={icon} size={20} color={color} />
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
