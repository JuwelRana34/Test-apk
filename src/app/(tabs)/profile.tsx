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
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CACHED_USER_PROFILE_KEY,
  CachedUserProfile,
  syncLocalDataToCloudIfOnline,
} from "../../lib/supabase";
import { supabase } from "../../lib/supabase";

const { FocusLock } = NativeModules;

export default function Profile() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const [profile, setProfile] = useState<CachedUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadUserProfileOfflineFirst = useCallback(async () => {
    try {
      // 1. Read local cache first (works 100% offline)
      const cachedRaw = await AsyncStorage.getItem(CACHED_USER_PROFILE_KEY);
      if (cachedRaw) {
        setProfile(JSON.parse(cachedRaw));
        setLoading(false);
      }

      // 2. Read native pass & streak state on Android
      let passes = 0;
      let streak = 0;
      if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
        try {
          const s = await FocusLock.getFocusSessionState();
          passes = s.emergencyPasses ?? 0;
          streak = s.streakDays ?? 0;
        } catch {}
      }

      // 3. Try fetching online user from Supabase if internet is available
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
      // Offline mode: cached profile stays displayed cleanly
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
      <View className="flex-1 items-center justify-center bg-slate-100">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  const fullName = profile?.name || "JnUITS Member";
  const email = profile?.email || "Offline Google Profile";
  const avatarUrl = profile?.avatarUrl;
  const initial = fullName.charAt(0).toUpperCase();

  return (
    <SafeAreaView className="flex-1 bg-slate-100 text-gray-900">
      {isFocused && <StatusBar style="dark" />}

      <ScrollView className="flex-1 bg-slate-100">
        {/* Header */}
        <View className="items-center bg-white pt-10 pb-8">
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              className="h-28 w-28 rounded-full border-[3px] border-indigo-600"
            />
          ) : (
            <View className="h-28 w-28 items-center justify-center rounded-full bg-indigo-600">
              <Text className="text-4xl font-bold text-white">{initial}</Text>
            </View>
          )}

          <Text className="mt-4 text-2xl font-bold text-slate-900">
            {fullName}
          </Text>
          <Text className="mt-1 text-slate-500 font-medium">{email}</Text>

          {/* Gamified Pass & Streak Summary Badges */}
          <View className="flex-row gap-3 mt-5">
            <View className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-2xl flex-row items-center">
              <Ionicons name="ticket" size={18} color="#D97706" />
              <Text className="text-amber-800 font-bold text-xs ml-1.5">
                Emergency Pass: {profile?.emergencyPasses ?? 0} / 5
              </Text>
            </View>
            <View className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-2xl flex-row items-center">
              <Ionicons name="flame" size={18} color="#059669" />
              <Text className="text-emerald-800 font-bold text-xs ml-1.5">
                Streak: {profile?.streakDays ?? 0} / 3 দিন
              </Text>
            </View>
          </View>
        </View>

        {/* Cloud & Offline Sync Card */}
        <View className="mx-4 mt-5 rounded-2xl bg-white p-4 shadow-sm shadow-slate-200 flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-sm font-bold text-slate-800">
              Google Profile Cloud Backup
            </Text>
            <Text className="text-xs text-slate-500 mt-0.5">
              অফলাইনে সব ফিচার সচল • নেট থাকলে অটো ব্যাকআপ হয়
            </Text>
          </View>
          <Pressable
            onPress={() => void handleManualSync()}
            disabled={syncing}
            className="bg-indigo-600 px-4 py-2.5 rounded-xl flex-row items-center"
          >
            <Ionicons name="sync" size={15} color="#FFFFFF" />
            <Text className="text-white font-bold text-xs ml-1.5">
              {syncing ? "Syncing..." : "Sync Now"}
            </Text>
          </Pressable>
        </View>

        {/* Quick Features Menu */}
        <View className="mx-4 mt-5 rounded-2xl bg-white shadow-sm shadow-slate-200">
          <MenuItem
            icon="shield-checkmark-outline"
            title="Strict Focus Lock & Passes"
            onPress={() => router.push("/features/StrictFocusScreen")}
          />
          <MenuItem
            icon="people-outline"
            title="3-Category Contact Reminder CRM"
            onPress={() => router.push("/features/SmartNetworking")}
          />
          <MenuItem
            icon="alarm-outline"
            title="90-Min Sleep Cycle Hard Alarm"
            onPress={() => router.push("/features/alarm")}
          />
          <MenuItem
            icon="notifications-outline"
            title="Notification Center"
            onPress={() => router.push("/(tabs)/notice")}
          />
        </View>

        {/* Logout Button */}
        <Pressable
          onPress={() => void handleLogout()}
          className="mx-4 mt-6 mb-10 flex-row items-center justify-center rounded-2xl bg-red-500 p-4 active:bg-red-600"
        >
          <Ionicons name="log-out-outline" size={22} color="white" />
          <Text className="ml-2 text-lg font-bold text-white">Logout</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({
  icon,
  title,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="flex-row items-center justify-between border-b border-slate-100 p-4"
    >
      <View className="flex-row items-center">
        <Ionicons name={icon} size={22} color="#475569" />
        <Text className="ml-4 text-base font-medium text-slate-700">
          {title}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
    </TouchableOpacity>
  );
}
