import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, FlatList, Linking, Pressable, Text, View } from "react-native";
import {
  AppNoticeItem,
  getInAppNotices,
  markAllInAppNoticesRead,
  triggerInstantContactNotification,
} from "../../lib/supabase";

export default function Notice() {
  const router = useRouter();
  const [notices, setNotices] = useState<AppNoticeItem[]>([]);

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

  const formatRelativeTime = (ts: number) => {
    const diffMins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const hours = Math.floor(diffMins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <View className="flex-1 bg-slate-100">
      {/* Header */}
      <View className="bg-white px-5 pb-4 pt-14 border-b border-slate-200">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-black text-slate-900">
            Notifications
          </Text>
          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={() => void handleTestPushNotification()}
              className="bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-200"
            >
              <Text className="font-bold text-xs text-indigo-600">
                🔔 Test Alert
              </Text>
            </Pressable>
            <Pressable onPress={() => void handleMarkAllRead()}>
              <Text className="font-bold text-xs text-blue-600">
                Mark all read
              </Text>
            </Pressable>
          </View>
        </View>
        <Text className="text-xs text-slate-500 mt-1">
          কন্টাক্ট রিমাইন্ডার ও ফোকাস লক অ্যালার্ট (অনলাইন ও অফলাইনে সচল)
        </Text>
      </View>

      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
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
              className={`rounded-2xl p-4 border ${
                item.read
                  ? "bg-white border-slate-200"
                  : "bg-indigo-50/70 border-indigo-200"
              }`}
            >
              <View className="flex-row">
                <View
                  className={`h-12 w-12 items-center justify-center rounded-2xl ${
                    isContact
                      ? "bg-emerald-100"
                      : isLock
                        ? "bg-rose-100"
                        : "bg-blue-100"
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
                      isContact ? "#059669" : isLock ? "#E11D48" : "#2563EB"
                    }
                  />
                </View>

                <View className="ml-3.5 flex-1">
                  <View className="flex-row items-center justify-between">
                    <Text
                      className="text-sm font-bold text-slate-900 flex-1 pr-2"
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    <Text className="text-[11px] text-slate-400">
                      {formatRelativeTime(item.timestamp)}
                    </Text>
                  </View>

                  <Text className="mt-1 text-xs text-slate-600 leading-4">
                    {item.message}
                  </Text>

                  {item.phoneNumber ? (
                    <View className="flex-row gap-2 mt-3">
                      <Pressable
                        onPress={() =>
                          void Linking.openURL(`tel:${item.phoneNumber}`)
                        }
                        className="bg-indigo-600 px-3 py-1.5 rounded-lg flex-row items-center"
                      >
                        <Ionicons name="call" size={12} color="#FFFFFF" />
                        <Text className="text-white text-xs font-bold ml-1">
                          কল করুন
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void Linking.openURL(
                            `whatsapp://send?phone=${item.phoneNumber}`,
                          )
                        }
                        className="bg-emerald-600 px-3 py-1.5 rounded-lg flex-row items-center"
                      >
                        <Ionicons
                          name="logo-whatsapp"
                          size={12}
                          color="#FFFFFF"
                        />
                        <Text className="text-white text-xs font-bold ml-1">
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
    </View>
  );
}
