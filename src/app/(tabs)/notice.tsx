import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Linking, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppNoticeItem,
  clearAllInAppNotices,
  deleteInAppNotice,
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

  // Modern Custom Modal State (Replaces all default Alert.alert!)
  const [clearAllModalVisible, setClearAllModalVisible] = useState(false);
  const [permModalVisible, setPermModalVisible] = useState(false);

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

  const handleDeleteSingle = async (id: string) => {
    const updated = await deleteInAppNotice(id);
    setNotices(updated);
  };

  const handleClearAll = () => {
    if (notices.length === 0) return;
    setClearAllModalVisible(true);
  };

  const confirmClearAll = async () => {
    setClearAllModalVisible(false);
    await clearAllInAppNotices();
    setNotices([]);
  };

  const handleTestPushNotification = async () => {
    const ok = await triggerInstantContactNotification();
    if (ok) {
      await loadNotices();
    } else {
      setPermModalVisible(true);
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
    <View className="flex-1 bg-[#0B1120]">
      {isFocused && <StatusBar style="light" backgroundColor="#131C31" />}

      {/* Overflow-Proof Two-Row Modern Header & Filter Tabs */}
      <View
        style={{ paddingTop: Math.max(16, insets.top + 8) }}
        className="bg-[#131C31] px-5 pb-4 rounded-b-[28px] border-b border-slate-800"
      >
        {/* Row 1: Title & Unread Badge */}
        <View className="flex-row items-center justify-between mb-2.5">
          <View className="flex-row items-center flex-1">
            <View className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 items-center justify-center mr-2.5">
              <MaterialCommunityIcons
                name="bell-badge-outline"
                size={20}
                color="#818CF8"
              />
            </View>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              className="text-xl font-black text-white"
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
        </View>

        {/* Row 2: 3 Clean Action Buttons */}
        <View className="flex-row items-center gap-2 mb-3">
          <Pressable
            onPress={() => void handleTestPushNotification()}
            className="flex-1 bg-emerald-500/15 border border-emerald-500/40 py-2 px-2.5 rounded-xl flex-row items-center justify-center"
          >
            <MaterialCommunityIcons
              name="bell-ring-outline"
              size={14}
              color="#34D399"
            />
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              className="font-bold text-xs text-emerald-300 ml-1.5"
            >
              Test Alert
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void handleMarkAllRead()}
            className="flex-1 bg-indigo-500/15 border border-indigo-500/40 py-2 px-2.5 rounded-xl flex-row items-center justify-center"
          >
            <MaterialCommunityIcons
              name="check-all"
              size={15}
              color="#818CF8"
            />
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              className="font-bold text-xs text-indigo-300 ml-1.5"
            >
              Mark Read
            </Text>
          </Pressable>

          <Pressable
            onPress={handleClearAll}
            disabled={notices.length === 0}
            className={`flex-1 py-2 px-2.5 rounded-xl flex-row items-center justify-center border ${
              notices.length > 0
                ? "bg-rose-500/15 border-rose-500/40"
                : "bg-slate-800/50 border-slate-800"
            }`}
          >
            <Feather
              name="trash-2"
              size={13}
              color={notices.length > 0 ? "#F43F5E" : "#64748B"}
            />
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              className={`font-bold text-xs ml-1.5 ${
                notices.length > 0 ? "text-rose-300" : "text-slate-500"
              }`}
            >
              Clear All
            </Text>
          </Pressable>
        </View>

        {/* Filter Pills with Vector Icons */}
        <View className="flex-row bg-[#0B1120] p-1 rounded-2xl border border-slate-800">
          {[
            {
              id: "all",
              label: `All (${notices.length})`,
              icon: "layers-outline" as const,
            },
            {
              id: "contact",
              label: `Contacts (${notices.filter((n) => n.type === "contact").length})`,
              icon: "call-outline" as const,
            },
            {
              id: "lock",
              label: `Focus Lock (${notices.filter((n) => n.type === "lock").length})`,
              icon: "shield-checkmark-outline" as const,
            },
          ].map((tab) => {
            const active = filter === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setFilter(tab.id as any)}
                className={`flex-1 py-2 px-1 rounded-xl flex-row items-center justify-center ${
                  active ? "bg-indigo-600" : ""
                }`}
              >
                <Ionicons
                  name={tab.icon}
                  size={13}
                  color={active ? "#FFFFFF" : "#94A3B8"}
                />
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  className={`font-bold text-[11px] ml-1 ${
                    active ? "text-white" : "text-slate-400"
                  }`}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {filteredNotices.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8 pb-16">
          <View className="w-20 h-20 rounded-full bg-slate-900 border border-slate-800 items-center justify-center mb-4">
            <MaterialCommunityIcons
              name="bell-sleep-outline"
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
            ওপরের Test Alert বাটনে ট্যাপ করে কন্টাক্ট রিমাইন্ডার নোটিফিকেশন
            পরীক্ষা করতে পারেন।
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
                    ? "bg-[#131C31]/80 border-slate-800"
                    : "bg-[#131C31] border-indigo-500/50"
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
                    <MaterialCommunityIcons
                      name={
                        isContact
                          ? "phone-incoming"
                          : isLock
                            ? "shield-lock"
                            : "bell-ring"
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

                      <View className="flex-row items-center gap-2">
                        <Text
                          allowFontScaling={false}
                          className="text-[11px] text-slate-400"
                        >
                          {formatRelativeTime(item.timestamp)}
                        </Text>
                        <Pressable
                          onPress={() => void handleDeleteSingle(item.id)}
                          hitSlop={10}
                          className="h-7 w-7 rounded-lg bg-slate-800/90 border border-slate-700/70 items-center justify-center active:bg-rose-500/20"
                        >
                          <Feather name="trash-2" size={13} color="#F43F5E" />
                        </Pressable>
                      </View>
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
                    <View className="ml-1.5 mt-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* MODERN CLEAR ALL CONFIRMATION MODAL */}
      <Modal
        visible={clearAllModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setClearAllModalVisible(false)}
      >
        <View className="flex-1 bg-black/80 justify-center items-center px-6">
          <View className="bg-[#131C31] w-full rounded-3xl p-6 border border-rose-500/30 items-center">
            <View className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/40 items-center justify-center mb-4">
              <Feather name="trash-2" size={30} color="#F43F5E" />
            </View>
            <Text
              allowFontScaling={false}
              className="text-white font-black text-lg text-center mb-2"
            >
              সব নোটিফিকেশন মুছে ফেলবেন?
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-300 text-xs text-center leading-5 mb-5"
            >
              আপনি কি নিশ্চিতভাবে আপনার নোটিফিকেশন লিস্টের সবগুলো অ্যালার্ট মুছে
              ফেলতে চান?
            </Text>
            <View className="flex-row gap-3 w-full">
              <Pressable
                onPress={() => setClearAllModalVisible(false)}
                className="flex-1 bg-slate-800 py-3.5 rounded-2xl items-center border border-slate-700"
              >
                <Text
                  allowFontScaling={false}
                  className="text-slate-200 font-bold text-xs"
                >
                  ফিরে যান
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmClearAll()}
                className="flex-1 bg-rose-600 py-3.5 rounded-2xl items-center active:bg-rose-700"
              >
                <Text
                  allowFontScaling={false}
                  className="text-white font-black text-xs"
                >
                  হ্যাঁ, সব মুছুন
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODERN PERMISSION INFO MODAL */}
      <Modal
        visible={permModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPermModalVisible(false)}
      >
        <View className="flex-1 bg-black/80 justify-center items-center px-6">
          <View className="bg-[#131C31] w-full rounded-3xl p-6 border border-amber-500/30 items-center">
            <View className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 items-center justify-center mb-4">
              <MaterialCommunityIcons
                name="bell-alert-outline"
                size={32}
                color="#FBBF24"
              />
            </View>
            <Text
              allowFontScaling={false}
              className="text-white font-black text-lg text-center mb-2"
            >
              Notification পারমিশন প্রয়োজন
            </Text>
            <Text
              allowFontScaling={false}
              className="text-slate-300 text-xs text-center leading-5 mb-5"
            >
              রিমাইন্ডার পাওয়ার জন্য ফোনের সেটিংস থেকে Notification পারমিশন অন
              করুন।
            </Text>
            <Pressable
              onPress={() => setPermModalVisible(false)}
              className="w-full bg-indigo-600 py-3.5 rounded-2xl items-center"
            >
              <Text
                allowFontScaling={false}
                className="text-white font-black text-xs"
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
