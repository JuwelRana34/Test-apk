import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CACHED_USER_PROFILE_KEY,
  restoreCloudBackupAfterGoogleLogin,
} from "../../lib/supabase";
import { supabase } from "../../lib/supabase";

export default function LoginScreen() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    });
  }, []);

  // 🌐 শুধুমাত্র Google One-Tap Login (কোনো ব্রাউজার বা পাসওয়ার্ড লাগবে না)
  const handleNativeGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo: any = await GoogleSignin.signIn();
      const idToken = userInfo?.idToken || userInfo?.data?.idToken;
      const gUser = userInfo?.user || userInfo?.data?.user;

      if (idToken) {
        // Save local profile cache immediately so offline works right away
        if (gUser) {
          await AsyncStorage.setItem(
            CACHED_USER_PROFILE_KEY,
            JSON.stringify({
              id: gUser.id || "local-google-user",
              name: gUser.name || "JnUITS Member",
              email: gUser.email || "",
              avatarUrl: gUser.photo || undefined,
              emergencyPasses: 0,
              streakDays: 0,
              lastSyncedAt: Date.now(),
            }),
          );
        }

        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: idToken,
        });

        if (error) throw error;

        await AsyncStorage.setItem("@is_logged_in", "true");
        await restoreCloudBackupAfterGoogleLogin();
        router.replace("/(tabs)");
      } else {
        throw new Error("No Google ID token received.");
      }
    } catch (error: any) {
      if (error?.code === "SIGN_IN_CANCELLED") {
        return;
      }
      Alert.alert(
        "Google Login Error",
        error?.message || "লগইন সম্পন্ন করা যায়নি। ইন্টারনেট সংযোগ চেক করুন।",
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0F172A]">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 28,
          paddingVertical: 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Logo & Badge */}
        <View className="items-center mb-8">
          <View className="w-24 h-24 rounded-3xl bg-indigo-500/20 border border-indigo-500/40 items-center justify-center mb-5">
            <Ionicons name="shield-checkmark" size={48} color="#818CF8" />
          </View>
          <Text className="text-3xl font-black text-white text-center">
            JnUITS Super Life
          </Text>
          <Text className="text-slate-400 text-sm text-center mt-2 leading-5">
            Hard Alarm • 25m/5m Strict Lock • 3-Category Contact CRM
          </Text>
        </View>

        {/* Feature Highlights Card */}
        <View className="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 mb-8 gap-y-4">
          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-xl bg-rose-500/20 items-center justify-center mr-3.5">
              <Ionicons name="lock-closed" size={20} color="#F43F5E" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-bold text-sm">
                Strict Focus & 0–5 Emergency Pass
              </Text>
              <Text className="text-slate-400 text-xs mt-0.5">
                টানা ৩ দিন লক পূর্ণ করলে +1 Pass, Shorts ও Chrome ফিল্টার
              </Text>
            </View>
          </View>

          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-xl bg-emerald-500/20 items-center justify-center mr-3.5">
              <Ionicons name="people" size={20} color="#34D399" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-bold text-sm">
                ৩-ক্যাটাগরির কন্টাক্ট রিমাইন্ডার
              </Text>
              <Text className="text-slate-400 text-xs mt-0.5">
                পরিবার, বন্ধু ও পরিচিতদের নামসহ অটোমেটিক নোটিফিকেশন
              </Text>
            </View>
          </View>

          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-xl bg-indigo-500/20 items-center justify-center mr-3.5">
              <Ionicons name="cloud-done" size={20} color="#818CF8" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-bold text-sm">
                ১০০% অফলাইন + ক্লাউড প্রোফাইল ব্যাকআপ
              </Text>
              <Text className="text-slate-400 text-xs mt-0.5">
                ইন্টারনেট ছাড়াও সব ফিচার চলবে এবং অনলাইনে অটো সিঙ্ক হবে
              </Text>
            </View>
          </View>
        </View>

        {/* Single Login Option: Native Google One-Tap Button */}
        <TouchableOpacity
          onPress={() => void handleNativeGoogleLogin()}
          disabled={googleLoading}
          activeOpacity={0.85}
          className="bg-white h-16 rounded-2xl flex-row items-center justify-center shadow-lg"
        >
          {googleLoading ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <>
              <Image
                source={{
                  uri: "https://upload.wikimedia.org/wikipedia/commons/archive/c/c1/20230822192910%21Google_%22G%22_logo.svg",
                }}
                style={{ width: 22, height: 22 }}
              />
              <Text className="text-slate-900 text-base font-black ml-3">
                Continue with Google
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text className="text-slate-500 text-xs text-center mt-5">
          একবার Google দিয়ে লগইন করলে অফলাইনেও আপনার প্রোফাইল সচল থাকবে।
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
