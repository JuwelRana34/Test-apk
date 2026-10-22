import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppNoticeItem,
  getInAppNotices,
  markAllInAppNoticesRead,
  triggerInstantContactNotification,
} from "../../lib/supabase";

export default function Notice() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [notices, setNotices] = useState<AppNoticeItem[]>([]);
  const [filter, setFilter] = useState<"all" | "contact" | "lock">("all");

  const loadNotices = useCallback(async () => {
    const items = await getInAppNotices();
    setNotices(items);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadNotices();
    }, [loadNotices]),
  );

  const handleMarkAllRead = async () => {
    const updated = await markAllInAppNoticesRead();
    setNotices(updated);
  };

  const handleTestPushNotification = async () => {
    const ok = await triggerInstantContactNotification();
    if (ok) {
      await loadNotices();
    } else {
      Alert.alert(
        "Permission Required",
        "ফোনের সেটিংস থেকে Notification পারমিশন অন করুন।",
      );
    }
  };

  const filteredNotices = useMemo(() => {
    if (filter === "all") return notices;
    return notices.filter((n) => n.type === filter);
  }, [notices, filter]);

  const unreadCount = useMemo(
    () => notices.filter((n) => !n.read).length,
    [notices],
  );

  const formatRelativeTime = (ts: number) => {
    const diffMins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const hours = Math.floor(diffMins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <View className="flex-1 bg-[#0F172A]">
      {isFocused && <StatusBar style="light" />}

      {/* 🌟 Modern Header & Filter Tabs */}
      <View
        style={{ paddingTop: Math.max(16, insets.top + 8) }}
        className="bg-[#1E293B] px-5 pb-4 rounded-b-[28px] border-b border-slate-700/80"
      >
        <View className="flex-row items-center justify-between mb-1">
          <View className="flex-row items-center flex-1 pr-2">
            <Text
              allowFontScaling={false}
              className="text-2xl font-black text-white"
            >
              Notifications
            </Text>
            {unreadCount > 0 && (
              <View className="ml-2 bg-rose-500 px-2 py-0.5 rounded-full">
                <Text
                  allowFontScaling={false}
                  className="text-white font-black text-[10px]"
                >
                  {unreadCount} NEW
                </Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => void handleTestPushNotification()}
              className="bg-emerald-500/15 border border-emerald-500/40 px-3 py-1.5 rounded-xl flex-row items-center"
            >
              <Ionicons name="notifications" size={14} color="#34D399" />
              <Text
                allowFontScaling={false}
                className="font-bold text-xs text-emerald-300 ml-1"
              >
                Test
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void handleMarkAllRead()}
              className="bg-indigo-500/15 border border-indigo-500/40 px-3 py-1.5 rounded-xl"
            >
              <Text
                allowFontScaling={false}
                className="font-bold text-xs text-indigo-300"
              >
                ✓ Read All
              </Text>
            </Pressable>
          </View>
        </View>

        <Text
          allowFontScaling={false}
          className="text-xs text-slate-400 mb-3.5"
        >
          কন্টাক্ট রিমাইন্ডার ও ফোকাস লক অ্যালার্ট (অনলাইন ও অফলাইনে সচল)
        </Text>

        {/* Filter Pills */}
        <View className="flex-row bg-slate-900 p-1 rounded-2xl border border-slate-700/80">
          {[
            { id: "all", label: `All (${notices.length})` },
            {
              id: "contact",
              label: `Contacts 📞 (${notices.filter((n) => n.type === "contact").length})`,
            },
            {
              id: "lock",
              label: `Focus Lock 🛡️ (${notices.filter((n) => n.type === "lock").length})`,
            },
          ].map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setFilter(tab.id as any)}
              className={`flex-1 py-2 px-1 rounded-xl items-center justify-center ${
                filter === tab.id ? "bg-indigo-600" : ""
              }`}
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                className={`font-bold text-[11px] ${
                  filter === tab.id ? "text-white" : "text-slate-400"
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {filteredNotices.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8 pb-16">
          <View className="w-20 h-20 rounded-full bg-slate-800 border border-slate-700 items-center justify-center mb-4">
            <Ionicons
              name="notifications-off-outline"
              size={34}
              color="#64748B"
            />
          </View>
          <Text
            allowFontScaling={false}
            className="text-white font-bold text-base mb-1"
          >
            কোনো নোটিফিকেশন নেই
          </Text>
          <Text
            allowFontScaling={false}
            className="text-slate-400 text-xs text-center leading-5"
          >
            ওপরের Test বাটনে ট্যাপ করে কন্টাক্ট রিমাইন্ডার নোটিফিকেশন পরীক্ষা
            করতে পারেন।
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: Math.max(28, insets.bottom + 16),
          }}
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => {
            const isContact = item.type === "contact";
            const isLock = item.type === "lock";

            return (
              <Pressable
                onPress={() => {
                  if (isContact) {
                    router.push("/features/SmartNetworking");
                  } else if (isLock) {
                    router.push("/features/StrictFocusScreen");
                  }
                }}
                className={`rounded-3xl p-4 border ${
                  item.read
                    ? "bg-slate-800/70 border-slate-700/70"
                    : "bg-slate-800 border-indigo-500/50"
                }`}
              >
                <View className="flex-row">
                  <View
                    className={`h-12 w-12 items-center justify-center rounded-2xl border ${
                      isContact
                        ? "bg-emerald-500/15 border-emerald-500/30"
                        : isLock
                          ? "bg-rose-500/15 border-rose-500/30"
                          : "bg-indigo-500/15 border-indigo-500/30"
                    }`}
                  >
                    <Ionicons
                      name={
                        isContact
                          ? "call"
                          : isLock
                            ? "shield-checkmark"
                            : "notifications"
                      }
                      size={22}
                      color={
                        isContact ? "#34D399" : isLock ? "#F43F5E" : "#818CF8"
                      }
                    />
                  </View>

                  <View className="ml-3.5 flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text
                        allowFontScaling={false}
                        className="text-sm font-bold text-white flex-1 pr-2"
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text
                        allowFontScaling={false}
                        className="text-[11px] text-slate-400"
                      >
                        {formatRelativeTime(item.timestamp)}
                      </Text>
                    </View>

                    <Text
                      allowFontScaling={false}
                      className="mt-1 text-xs text-slate-300 leading-4"
                    >
                      {item.message}
                    </Text>

                    {item.phoneNumber ? (
                      <View className="flex-row gap-2 mt-3">
                        <Pressable
                          onPress={() =>
                            void Linking.openURL(`tel:${item.phoneNumber}`)
                          }
                          className="bg-indigo-600 px-3.5 py-2 rounded-xl flex-row items-center"
                        >
                          <Ionicons name="call" size={13} color="#FFFFFF" />
                          <Text
                            allowFontScaling={false}
                            className="text-white text-xs font-bold ml-1.5"
                          >
                            কল করুন
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            void Linking.openURL(
                              `whatsapp://send?phone=${item.phoneNumber}`,
                            )
                          }
                          className="bg-emerald-600/20 border border-emerald-500/40 px-3.5 py-2 rounded-xl flex-row items-center"
                        >
                          <Ionicons
                            name="logo-whatsapp"
                            size={13}
                            color="#34D399"
                          />
                          <Text
                            allowFontScaling={false}
                            className="text-emerald-300 text-xs font-bold ml-1.5"
                          >
                            WhatsApp
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>

                  {!item.read && (
                    <View className="ml-2 mt-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
