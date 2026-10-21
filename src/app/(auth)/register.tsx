import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase"; // Supabase ফাইলের সঠিক পাথ দিন

export default function RegisterScreen() {
  const router = useRouter();

  // 🌟 স্টেটগুলো ডিক্লেয়ার করা হলো
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // 📝 রেজিস্ট্রেশন ফাংশন
  const handleRegister = async () => {
    // ১. ফর্ম ভ্যালিডেশন
    if (!name || !email || !password) {
      Alert.alert("Error", "Please fill all the fields");
      return;
    }

    setLoading(true);

    // ২. Supabase-এ নতুন ইউজার তৈরি করা
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name, // ডাটাবেসে ইউজারের নাম সেভ করার জন্য
        },
      },
    });

    if (error) {
      Alert.alert("Registration Failed", error.message);
    } else {
      Alert.alert(
        "Success",
        "Account created successfully! Please check your email to verify.",
      );
      // সফল হলে লগইন পেজে পাঠিয়ে দেবে
      router.back();
    }

    setLoading(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 24,
          paddingVertical: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* --- Illustration Image --- */}
        <View className="items-center mb-2">
          <Image
            source={{
              uri: "https://cdni.iconscout.com/illustration/premium/thumb/sign-up-8694031-6983270.png",
            }}
            className="w-80 h-80"
            resizeMode="contain"
          />
        </View>

        {/* --- Header Texts --- */}
        <View className="mb-2">
          <Text className="text-3xl font-extrabold text-slate-900 mb-2">
            Create Account 🚀
          </Text>
          <Text className="text-slate-500 text-base">
            Sign up to get started.
          </Text>
        </View>

        {/* --- Input Fields --- */}
        <View className="gap-4 mb-5">
          <View className="bg-white flex-row items-center h-14 px-4 rounded-2xl border border-slate-200">
            <Ionicons name="person-outline" size={20} color="#94a3b8" />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Full Name"
              className="flex-1 ml-3 text-slate-900"
            />
          </View>

          <View className="bg-white flex-row items-center h-14 px-4 rounded-2xl border border-slate-200">
            <Ionicons name="mail-outline" size={20} color="#94a3b8" />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email Address"
              autoCapitalize="none"
              className="flex-1 ml-3 text-slate-900"
              keyboardType="email-address"
            />
          </View>

          <View className="bg-white flex-row items-center h-14 px-4 rounded-2xl border border-slate-200">
            <Ionicons name="lock-closed-outline" size={20} color="#94a3b8" />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              className="flex-1 ml-3 text-slate-900"
            />
          </View>
        </View>

        {/* --- Register Button --- */}
        <TouchableOpacity
          onPress={handleRegister}
          disabled={loading}
          className="bg-indigo-600 h-14 rounded-2xl items-center justify-center mb-2 shadow-sm active:bg-indigo-700"
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-white text-lg font-bold">Sign Up</Text>
          )}
        </TouchableOpacity>

        {/* --- Navigate to Login --- */}
        <View className="flex-row justify-center mt-2">
          <Text className="text-slate-500">Already have an account? </Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-slate-900 font-bold">Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
