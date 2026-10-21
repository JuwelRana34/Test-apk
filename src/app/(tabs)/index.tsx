import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useState } from "react";
import {
  Image,
  NativeModules,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  CACHED_USER_PROFILE_KEY,
  CachedUserProfile,
} from "../../lib/supabase";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

interface ServiceIconProps {
  icon: IoniconsName;
  label: string;
  color: string;
  bg: string;
  onPress?: () => void;
}

const { FocusLock } = NativeModules;

export default function HomePage() {
  const [showId, setShowId] = useState(false);
  const [userName, setUserName] = useState("Juwel Rana");
  const [avatarUri, setAvatarUri] = useState(
    "https://i.pravatar.cc/150?img=33",
  );
  const [emergencyPasses, setEmergencyPasses] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      const loadHomeStatus = async () => {
        try {
          const cached = await AsyncStorage.getItem(CACHED_USER_PROFILE_KEY);
          if (cached) {
            const p: CachedUserProfile = JSON.parse(cached);
            if (p.name) setUserName(p.name);
            if (p.avatarUrl) setAvatarUri(p.avatarUrl);
            setEmergencyPasses(p.emergencyPasses ?? 0);
            setStreakDays(p.streakDays ?? 0);
          }

          if (Platform.OS === "android" && FocusLock?.getFocusSessionState) {
            const s = await FocusLock.getFocusSessionState();
            setEmergencyPasses(s.emergencyPasses ?? 0);
            setStreakDays(s.streakDays ?? 0);
          }
        } catch {}
      };
      void loadHomeStatus();
    }, []),
  );

  return (
    <View className="flex-1 bg-[#F4F5F7]">
      <StatusBar style="light" />

      {/* 🔴 1. TOP HEADER (Brand Color Background) */}
      <View className="bg-[#4F46E5] pt-14 pb-8 px-5 rounded-b-[30px] z-10">
        <View className="flex-row justify-between items-center mb-6">
          {/* Profile Section */}
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/profile")}
            className="flex-row items-center gap-3"
          >
            <View className="p-0.5 bg-white rounded-full">
              <Image
                source={{ uri: avatarUri }}
                className="w-11 h-11 rounded-full"
              />
            </View>
            <View>
              <Text className="text-indigo-100 text-xs font-medium mb-0.5">
                Welcome back,
              </Text>
              <Text className="text-white text-lg font-bold">{userName}</Text>
            </View>
          </TouchableOpacity>

          {/* Notification & QR */}
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => router.push("/features/StrictFocusScreen")}
              className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
            >
              <Ionicons name="shield-checkmark-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/notice")}
              className="w-10 h-10 rounded-full bg-white/20 items-center justify-center relative"
            >
              <Ionicons
                name="notifications-outline"
                size={22}
                color="#FFFFFF"
              />
              <View className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-500 rounded-full border border-[#4F46E5]" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 💳 "Tap for Balance" Style Pass & Streak Pill */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setShowId(!showId)}
          className="bg-white/20 self-start px-4 py-2 rounded-full flex-row items-center border border-white/30"
        >
          <Ionicons name="ticket" size={16} color="#FBBF24" />
          <Text className="text-white font-bold ml-2 text-sm">
            {showId
              ? `Emergency Pass: ${emergencyPasses}/5 • Streak: ${streakDays}/3d`
              : "Tap for Focus Pass & Streak"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 📜 MAIN SCROLL CONTENT */}
      <ScrollView showsVerticalScrollIndicator={false} className="z-20">
        {/* 🟢 2. OVERLAPPING SERVICES GRID (The core bKash/Nagad look) */}
        <View className="bg-white mx-3 mt-2 rounded-2xl p-2 shadow-lg shadow-slate-200/50">
          <View className="flex-row justify-between mb-6">
            <ServiceIcon
              icon="lock-closed"
              label="Focus Lock"
              color="#ec4899"
              bg="bg-pink-50"
              onPress={() => router.push("/features/StrictFocusScreen")}
            />
            <ServiceIcon
              icon="code-slash"
              label="Projects"
              color="#3b82f6"
              bg="bg-blue-50"
            />
            <ServiceIcon
              icon="people"
              label="Contacts"
              color="#10b981"
              bg="bg-emerald-50"
              onPress={() => router.push("/features/SmartNetworking")}
            />
            <ServiceIcon
              icon="library"
              label="Resources"
              color="#8b5cf6"
              bg="bg-violet-50"
            />
          </View>

          <View className="flex-row justify-between">
            <ServiceIcon
              icon="megaphone"
              label="Notice"
              color="#f59e0b"
              bg="bg-amber-50"
              onPress={() => router.push("/(tabs)/notice")}
            />
            <ServiceIcon
              icon="ribbon"
              label="Committee"
              color="#06b6d4"
              bg="bg-cyan-50"
            />
            <ServiceIcon
              icon="trophy"
              label="Contests"
              color="#f43f5e"
              bg="bg-rose-50"
            />
            <ServiceIcon
              icon="alarm"
              label="Alarm"
              color="#8b5cf6"
              bg="bg-violet-50"
              onPress={() => router.push("/features/alarm")}
            />
          </View>
        </View>

        {/* 🔵 3. PROMOTIONAL BANNERS (Carousel) */}
        <View className="mt-4 mb-3">
          <View className="flex-row justify-between items-center px-5 mb-3">
            <Text className="text-lg font-bold text-slate-800">Highlights</Text>
            <TouchableOpacity>
              <Text className="text-indigo-600 font-bold text-sm">See All</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 15 }}
          >
            <TouchableOpacity className="w-72 h-36 rounded-2xl overflow-hidden relative shadow-sm">
              <Image
                source={{
                  uri: "https://images.unsplash.com/photo-1542831371-29b0f74f9713?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
                }}
                className="w-full h-full absolute"
              />
              <View className="flex-1 bg-black/40 justify-end p-4">
                <Text className="text-white font-black text-lg mb-1">
                  Intra-JnU Hackathon
                </Text>
                <Text className="text-slate-200 text-xs font-medium">
                  Registration Open Now!
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity className="w-72 h-36 rounded-2xl overflow-hidden relative shadow-sm">
              <Image
                source={{
                  uri: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
                }}
                className="w-full h-full absolute"
              />
              <View className="flex-1 bg-indigo-900/50 justify-end p-4">
                <Text className="text-white font-black text-lg mb-1">
                  UI/UX Masterclass
                </Text>
                <Text className="text-slate-200 text-xs font-medium">
                  Coming this Friday
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* 🟡 4. SUGGESTED FOR YOU (List style) */}
        <View className="px-5 mb-24">
          <Text className="text-lg font-bold text-slate-800 mb-4">
            Quick Actions
          </Text>

          <TouchableOpacity
            onPress={() => router.push("/features/StrictFocusScreen")}
            className="bg-white p-4 rounded-2xl flex-row items-center shadow-sm shadow-slate-100 mb-3 border border-slate-100"
          >
            <View className="w-12 h-12 bg-rose-50 rounded-full items-center justify-center mr-4">
              <Ionicons name="shield-checkmark" size={24} color="#F43F5E" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-800 font-bold text-base mb-0.5">
                Start 25m/5m Focus Session
              </Text>
              <Text className="text-slate-500 text-xs">
                Emergency Passes: {emergencyPasses}/5 • Streak: {streakDays}/3d
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push("/features/SmartNetworking")}
            className="bg-white p-4 rounded-2xl flex-row items-center shadow-sm shadow-slate-100 mb-3 border border-slate-100"
          >
            <View className="w-12 h-12 bg-emerald-50 rounded-full items-center justify-center mr-4">
              <Ionicons name="people" size={24} color="#10B981" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-800 font-bold text-base mb-0.5">
                3-Category Contact Reminders
              </Text>
              <Text className="text-slate-500 text-xs">
                Check who is due for a call or WhatsApp today
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const ServiceIcon = ({ icon, label, color, bg, onPress }: ServiceIconProps) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    className="items-center w-[70px]"
  >
    <View
      className={`${bg} w-14 h-14 rounded-full items-center justify-center mb-2`}
    >
      <Ionicons name={icon} size={28} color={color} />
    </View>
    <Text className="text-slate-600 text-xs font-semibold text-center">
      {label}
    </Text>
  </TouchableOpacity>
);
