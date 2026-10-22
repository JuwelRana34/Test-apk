import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CACHED_USER_PROFILE_KEY,
  restoreCloudBackupAfterGoogleLogin,
  supabase,
} from "../../lib/supabase";

const LOGIN_BG_URI =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1000&q=80";

export default function LoginScreen() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    });
  }, []);

  const handleNativeGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo: any = await GoogleSignin.signIn();
      const idToken = userInfo?.idToken || userInfo?.data?.idToken;
      const gUser = userInfo?.user || userInfo?.data?.user;

      if (idToken) {
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
    <ImageBackground
      source={{ uri: LOGIN_BG_URI }}
      className="flex-1 bg-[#070B14]"
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <SafeAreaView
        className="flex-1 bg-[#070B14]/80"
        edges={["top", "bottom", "left", "right"]}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "space-between",
            paddingHorizontal: 24,
            paddingVertical: 28,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Brand Badge */}
          <View className="items-center mt-4">
            <View className="bg-indigo-500/20 border border-indigo-400/30 px-4 py-1.5 rounded-full flex-row items-center mb-6">
              <Ionicons name="sparkles" size={14} color="#818CF8" />
              <Text
                allowFontScaling={false}
                className="text-indigo-200 font-bold text-xs ml-1.5 tracking-wider uppercase"
              >
                Productivity & Life OS
              </Text>
            </View>

            <View className="w-24 h-24 rounded-[32px] bg-indigo-600/25 border-2 border-indigo-400/50 items-center justify-center mb-5 shadow-2xl">
              <Ionicons name="shield-checkmark" size={50} color="#818CF8" />
            </View>

            <Text
              allowFontScaling={false}
              className="text-4xl font-black text-white text-center tracking-tight"
            >
              JnUITS Super Life
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-300 text-xs text-center mt-2.5 px-4 leading-5"
            >
              আপনার ডিপ ফোকাস, ঘুমের রুটিন এবং প্রিয়জনদের সাথে যোগাযোগের স্মার্ট
              সঙ্গী
            </Text>
          </View>

          {/* Center Glassmorphism Feature Cards */}
          <View className="bg-slate-900/85 border border-slate-700/80 rounded-[32px] p-5 my-6 gap-y-4">
            <View className="flex-row items-center">
              <View className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/30 items-center justify-center mr-3.5">
                <Ionicons name="lock-closed" size={22} color="#F43F5E" />
              </View>
              <View className="flex-1">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  25m/5m Focus Lock & Shorts Blocker
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-xs mt-0.5"
                >
                  টানা ৩ দিন (৩০+ মি.) লক পূর্ণ করলে +1 Emergency Pass
                </Text>
              </View>
            </View>

            <View className="flex-row items-center">
              <View className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 items-center justify-center mr-3.5">
                <Ionicons name="people" size={22} color="#34D399" />
              </View>
              <View className="flex-1">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  ৩-ক্যাটাগরির Smart Contact CRM
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-xs mt-0.5"
                >
                  প্রতিদিন সন্ধ্যা ৭টায় এলোমেলো তারিখে নামসহ রিমাইন্ডার
                </Text>
              </View>
            </View>

            <View className="flex-row items-center">
              <View className="w-11 h-11 rounded-2xl bg-violet-500/20 border border-violet-500/30 items-center justify-center mr-3.5">
                <Ionicons name="alarm" size={22} color="#A78BFA" />
              </View>
              <View className="flex-1">
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  90-Min Sleep Cycle & Hard Alarm
                </Text>
                <Text
                  allowFontScaling={false}
                  className="text-slate-400 text-xs mt-0.5"
                >
                  অংক সমাধান ছাড়া বন্ধ না হওয়া হার্ড অ্যালার্ম ও ক্লাউড ব্যাকআপ
                </Text>
              </View>
            </View>
          </View>

          {/* Bottom Action Area */}
          <View>
            <TouchableOpacity
              onPress={() => void handleNativeGoogleLogin()}
              disabled={googleLoading}
              activeOpacity={0.85}
              className="bg-white py-4 px-6 rounded-2xl flex-row items-center justify-center shadow-xl"
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
                  <Text
                    allowFontScaling={false}
                    className="text-slate-900 text-base font-black ml-3"
                  >
                    Continue with Google
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <View className="flex-row items-center justify-center mt-4">
              <Ionicons name="cloud-done-outline" size={14} color="#64748B" />
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-[11px] text-center ml-1.5"
              >
                অটো ক্লাউড ব্যাকআপ • একবার লগইন করলে অফলাইনেও সচল থাকবে
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}
