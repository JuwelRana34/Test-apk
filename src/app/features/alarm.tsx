import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Platform,
  NativeModules,
  Modal,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { AlarmModule } = NativeModules;

interface SleepCycle {
  id: string;
  cycles: number;
  durationMinutes: number;
  durationText: string;
}

const sleepCycles: SleepCycle[] = [
  { id: "1", cycles: 1, durationMinutes: 105, durationText: "1.5 Hours" },
  { id: "2", cycles: 2, durationMinutes: 195, durationText: "3.0 Hours" },
  { id: "3", cycles: 3, durationMinutes: 285, durationText: "4.5 Hours" },
  {
    id: "4",
    cycles: 4,
    durationMinutes: 375,
    durationText: "6.0 Hours (Good)",
  },
  {
    id: "5",
    cycles: 5,
    durationMinutes: 465,
    durationText: "7.5 Hours (Best)",
  },
  { id: "6", cycles: 6, durationMinutes: 555, durationText: "9.0 Hours" },
  { id: "7", cycles: 7, durationMinutes: 645, durationText: "10.5 Hours" },
];

export default function ModernAlarmScreen() {
  const [baseTime, setBaseTime] = useState<Date>(new Date());
  const [activeAlarm, setActiveAlarm] = useState<{
    time: string;
    cycleText: string;
    timestamp?: number;
  } | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<SleepCycle | null>(null);
  const [ringtoneUri, setRingtoneUri] = useState<string>("");

  // 🌟 পারমিশন হাইড/শো করার স্টেট
  const [hasOverlayPermission, setHasOverlayPermission] =
    useState<boolean>(true);
  const [hideAutoLaunch, setHideAutoLaunch] = useState<boolean>(true);

  const [customAlert, setCustomAlert] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: "success" | "error" | "info";
  }>({
    visible: false,
    title: "",
    message: "",
    type: "info",
  });

  const alarmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCustomAlert = (
    title: string,
    message: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    setCustomAlert({ visible: true, title, message, type });
  };

  const hideCustomAlert = () => {
    setCustomAlert((prev) => ({ ...prev, visible: false }));
  };

  // 🌟 পারমিশন চেক করার লজিক (অ্যাপে ফিরলেই চেক করবে)
  const checkPermissions = async () => {
    if (Platform.OS === "android" && AlarmModule) {
      if (AlarmModule.checkOverlayPermission) {
        const isGranted = await AlarmModule.checkOverlayPermission();
        setHasOverlayPermission(isGranted);
      }
      const autoLaunchDismissed = await AsyncStorage.getItem(
        "autoLaunchDismissed",
      );
      setHideAutoLaunch(autoLaunchDismissed === "true");
    }
  };

  useEffect(() => {
    checkPermissions();

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        checkPermissions();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleOverlayPermissionClick = () => {
    if (
      Platform.OS === "android" &&
      AlarmModule &&
      AlarmModule.requestOverlayPermission
    ) {
      AlarmModule.requestOverlayPermission();
    } else {
      showCustomAlert(
        "Error",
        "Feature not supported on this device.",
        "error",
      );
    }
  };

  const handleAutostartSettingsClick = () => {
    if (
      Platform.OS === "android" &&
      AlarmModule &&
      AlarmModule.openAutostartSettings
    ) {
      AlarmModule.openAutostartSettings();
    } else {
      showCustomAlert(
        "Error",
        "Feature not supported on this device.",
        "error",
      );
    }
  };

  const dismissAutoLaunch = async () => {
    setHideAutoLaunch(true);
    await AsyncStorage.setItem("autoLaunchDismissed", "true");
    showCustomAlert(
      "Success",
      "Auto Launch permission marked as completed.",
      "success",
    );
  };

  useEffect(() => {
    const loadSavedAlarm = async () => {
      try {
        const saved = await AsyncStorage.getItem("savedAlarm");
        if (saved) {
          const parsedAlarm = JSON.parse(saved);
          const currentTime = Date.now();

          if (parsedAlarm.timestamp > currentTime) {
            setActiveAlarm({
              time: parsedAlarm.time,
              cycleText: parsedAlarm.cycleText,
            });

            const timeRemaining = parsedAlarm.timestamp - currentTime;
            alarmTimeoutRef.current = setTimeout(async () => {
              setActiveAlarm(null);
              await AsyncStorage.removeItem("savedAlarm");
            }, timeRemaining);
          } else {
            await AsyncStorage.removeItem("savedAlarm");
          }
        }
      } catch (e) {
        console.error("Error loading alarm:", e);
      }
    };

    loadSavedAlarm();

    const interval = setInterval(() => setBaseTime(new Date()), 60000);
    return () => {
      clearInterval(interval);
      if (alarmTimeoutRef.current) clearTimeout(alarmTimeoutRef.current);
    };
  }, []);

  const pickRingtone = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "audio/*" });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setRingtoneUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error("Error picking audio file:", error);
    }
  };

  const confirmAlarm = async () => {
    if (!selectedCycle) return;

    if (Platform.OS !== "android") {
      setModalVisible(false);
      showCustomAlert(
        "Unsupported Platform",
        "This native feature is exclusively designed for Android devices.",
        "error",
      );
      return;
    }

    if (AlarmModule) {
      setModalVisible(false);

      const triggerTimestamp =
        baseTime.getTime() + selectedCycle.durationMinutes * 60000;

      AlarmModule.setAlarm(
        triggerTimestamp,
        `You slept for (${selectedCycle.durationText})😴`,
        ringtoneUri,
      );

      const triggerTime = new Date(triggerTimestamp);
      const timeString = triggerTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const newAlarmData = {
        time: timeString,
        cycleText: selectedCycle.durationText,
        timestamp: triggerTimestamp,
      };

      setActiveAlarm(newAlarmData);
      await AsyncStorage.setItem("savedAlarm", JSON.stringify(newAlarmData));

      showCustomAlert(
        "Sleep Cycle Active",
        `Your alarm is securely scheduled for ${timeString}. Lock your screen and rest well.`,
        "success",
      );

      if (alarmTimeoutRef.current) clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = setTimeout(async () => {
        setActiveAlarm(null);
        await AsyncStorage.removeItem("savedAlarm");
      }, selectedCycle.durationMinutes * 60000);
    } else {
      setModalVisible(false);
      showCustomAlert(
        "System Error",
        "Native module is disconnected. Please rebuild the application.",
        "error",
      );
    }
  };

  const testInstantAlarm = async () => {
    if (Platform.OS !== "android") return;

    if (AlarmModule) {
      const triggerTimestamp = baseTime.getTime() + 10000;

      AlarmModule.setAlarm(triggerTimestamp, "Test Alarm (10s)😴", "");

      const triggerTime = new Date(triggerTimestamp);
      const timeString = triggerTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const testAlarmData = {
        time: timeString,
        cycleText: "Test Timer (5s)",
        timestamp: triggerTimestamp,
      };

      setActiveAlarm(testAlarmData);
      await AsyncStorage.setItem("savedAlarm", JSON.stringify(testAlarmData));

      if (alarmTimeoutRef.current) clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = setTimeout(async () => {
        setActiveAlarm(null);
        await AsyncStorage.removeItem("savedAlarm");
      }, 5000);
    } else {
      showCustomAlert(
        "System Error",
        "Native module is disconnected.",
        "error",
      );
    }
  };

  const cancelAlarmUI = async () => {
    if (AlarmModule && AlarmModule.cancelAlarm) {
      AlarmModule.cancelAlarm();
    }

    setActiveAlarm(null);
    if (alarmTimeoutRef.current) clearTimeout(alarmTimeoutRef.current);

    await AsyncStorage.removeItem("savedAlarm");

    showCustomAlert(
      "Alarm Dismissed",
      "Your scheduled sleep cycle has been completely turned off.",
      "info",
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* --- Header --- */}
      <View className="items-center bg-slate-800 pt-8 pb-6 rounded-b-[32px] shadow-lg mb-4">
        <Text
          allowFontScaling={false}
          className="text-3xl font-extrabold text-slate-100 tracking-wide mb-1"
        >
          Sleep Cycles
        </Text>
        <Text
          allowFontScaling={false}
          className="text-base text-blue-400 font-medium"
        >
          Current Time:{" "}
          {baseTime.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>

        <Pressable
          onPress={testInstantAlarm}
          className="mt-4 flex-row items-center bg-slate-700/50 px-4 py-2 rounded-full border border-slate-600 active:bg-slate-700"
        >
          <Ionicons name="flask-outline" size={16} color="#94A3B8" />
          <Text
            allowFontScaling={false}
            className="ml-2 text-sm text-slate-300 font-semibold"
          >
            Test Alarm (5s)
          </Text>
        </Pressable>
      </View>

      {/* 🌟 ডায়নামিক Permissions Suggestion Box */}
      {(!hasOverlayPermission || !hideAutoLaunch) && (
        <View className="mx-4 mb-4 bg-indigo-900/20 border border-indigo-500/30 rounded-2xl p-4">
          <View className="flex-row items-center mb-4">
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color="#818CF8"
            />
            <Text
              allowFontScaling={false}
              className="text-indigo-400 font-bold ml-2"
            >
              Required for Background Alarms
            </Text>
          </View>

          <View className="flex-col space-y-3">
            {!hasOverlayPermission && (
              <Pressable
                onPress={handleOverlayPermissionClick}
                className="w-full bg-slate-800 border border-indigo-500/50 py-3 rounded-xl items-center flex-row justify-center active:bg-slate-700 mb-2"
              >
                <Ionicons name="layers-outline" size={18} color="#818CF8" />
                <Text
                  allowFontScaling={false}
                  className="text-indigo-300 text-xs font-bold text-center ml-2"
                >
                  Allow Display Over Apps
                </Text>
              </Pressable>
            )}

            {!hideAutoLaunch && (
              <View className="flex-row space-x-2">
                <Pressable
                  onPress={handleAutostartSettingsClick}
                  className="flex-1 bg-slate-800 border border-indigo-500/50 py-3 rounded-xl items-center flex-row justify-center active:bg-slate-700"
                >
                  <Ionicons name="rocket-outline" size={18} color="#818CF8" />
                  <Text
                    allowFontScaling={false}
                    className="text-indigo-300 text-xs font-bold text-center ml-2"
                  >
                    Allow Auto Launch
                  </Text>
                </Pressable>

                <Pressable
                  onPress={dismissAutoLaunch}
                  className="bg-emerald-900/40 border border-emerald-500/50 px-4 rounded-xl items-center justify-center active:bg-emerald-800/50 ml-2"
                >
                  <Ionicons name="checkmark-done" size={20} color="#34D399" />
                </Pressable>
              </View>
            )}
          </View>
        </View>
      )}

      {/* --- Active Timer UI --- */}
      {activeAlarm && (
        <View className="mx-4 mb-4 bg-emerald-900/30 border border-emerald-500/30 rounded-2xl p-4 flex-row justify-between items-center">
          <View className="flex-row items-center flex-1">
            <View className="h-10 w-10 bg-emerald-500/20 rounded-full items-center justify-center mr-3">
              <Ionicons name="alarm-outline" size={24} color="#34D399" />
            </View>
            <View>
              <Text
                allowFontScaling={false}
                className="text-emerald-400 text-xs font-bold uppercase tracking-wider"
              >
                Alarm Set
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-100 text-lg font-bold"
              >
                Waking up at {activeAlarm.time}
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-xs mt-0.5"
              >
                {activeAlarm.cycleText}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={cancelAlarmUI}
            className="bg-red-500/10 border border-red-500/30 px-4 py-2 rounded-xl active:bg-red-500/20"
          >
            <Text
              allowFontScaling={false}
              className="text-red-400 font-bold text-sm"
            >
              Clear
            </Text>
          </Pressable>
        </View>
      )}

      {/* --- Sleep Cycles List --- */}
      <FlatList
        data={sleepCycles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const isOptimal = item.cycles === 4 || item.cycles === 5;

          const exactWakeUpTime = new Date(
            baseTime.getTime() + item.durationMinutes * 60000,
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          return (
            <View
              className={`p-5 rounded-2xl mb-4 flex-row justify-between items-center border ${
                isOptimal
                  ? "bg-blue-900/20 border-blue-500/50"
                  : "bg-slate-800 border-slate-700"
              }`}
            >
              <View className="flex-1 pr-3">
                <Text
                  allowFontScaling={false}
                  className="text-lg font-bold text-slate-200 mb-1"
                >
                  Cycle {item.cycles}
                </Text>

                <View className="flex-row items-center flex-wrap gap-y-1">
                  <Text
                    allowFontScaling={false}
                    className={`${
                      isOptimal ? "text-blue-400" : "text-slate-400"
                    } font-medium`}
                  >
                    {item.durationText}
                  </Text>

                  <Text
                    allowFontScaling={false}
                    className="text-slate-500 mx-2"
                  >
                    •
                  </Text>

                  <View className="flex-row items-center">
                    <Ionicons
                      name="notifications-outline"
                      size={14}
                      color={isOptimal ? "#60A5FA" : "#94A3B8"}
                    />
                    <Text
                      allowFontScaling={false}
                      className={`${
                        isOptimal ? "text-blue-300" : "text-slate-300"
                      } font-semibold ml-1`}
                    >
                      {exactWakeUpTime}
                    </Text>
                  </View>
                </View>
              </View>

              <Pressable
                onPress={() => {
                  setSelectedCycle(item);
                  setModalVisible(true);
                }}
                className={`px-5 py-3 rounded-xl active:opacity-80 ${
                  isOptimal ? "bg-blue-600" : "bg-slate-700"
                }`}
              >
                <Text
                  allowFontScaling={false}
                  className="text-white font-bold text-sm"
                >
                  Sleep Now
                </Text>
              </Pressable>
            </View>
          );
        }}
      />

      {/* --- Professional Confirmation Modal --- */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View className="flex-1 justify-center items-center bg-black/70 p-6">
          <View className="bg-slate-800 p-6 rounded-3xl w-full border border-slate-700 shadow-2xl">
            <View className="items-center mb-4">
              <View className="h-14 w-14 bg-blue-500/20 rounded-full items-center justify-center mb-2">
                <Ionicons name="moon-outline" size={28} color="#60A5FA" />
              </View>
              <Text
                allowFontScaling={false}
                className="text-white text-2xl font-bold"
              >
                Confirm Sleep Cycle
              </Text>
              <Text
                allowFontScaling={false}
                className="text-slate-400 text-center mt-1"
              >
                Are you sure you want to set an alarm for Cycle{" "}
                {selectedCycle?.cycles} ({selectedCycle?.durationText})?
              </Text>
            </View>

            {/* Ringtone Selector Button */}
            <Pressable
              onPress={pickRingtone}
              className="bg-slate-700/60 border border-slate-600 p-4 rounded-2xl mb-6 flex-row items-center justify-between"
            >
              <View className="flex-row items-center flex-1 pr-2">
                <Ionicons
                  name="musical-notes-outline"
                  size={20}
                  color="#38BDF8"
                />
                <Text
                  allowFontScaling={false}
                  className="text-slate-200 ml-3 font-medium"
                  numberOfLines={1}
                >
                  {ringtoneUri
                    ? "Custom Ringtone Selected"
                    : "Use Default Alarm Tone"}
                </Text>
              </View>
              <Text
                allowFontScaling={false}
                className="text-blue-400 text-xs font-bold uppercase"
              >
                {ringtoneUri ? "Change" : "Select"}
              </Text>
            </Pressable>

            {/* Action Buttons */}
            <View className="flex-row space-x-3">
              <Pressable
                onPress={() => setModalVisible(false)}
                className="flex-1 py-3.5 border-rose-500 bg-red-200 rounded-xl items-center active:bg-red-400"
              >
                <Text
                  allowFontScaling={false}
                  className="text-rose-600 font-bold"
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={confirmAlarm}
                className="flex-1 py-3.5 bg-blue-600 rounded-xl mx-2 items-center active:bg-blue-500"
              >
                <Text allowFontScaling={false} className="text-white font-bold">
                  Yes, Set Alarm
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- Custom Alert Modal --- */}
      <Modal visible={customAlert.visible} transparent animationType="fade">
        <View className="flex-1 justify-center items-center bg-black/70 p-6">
          <View className="bg-slate-800 p-6 rounded-3xl w-full max-w-sm border border-slate-700 shadow-2xl items-center">
            {/* Dynamic Icon based on alert type */}
            <View
              className={`h-16 w-16 rounded-full items-center justify-center mb-4 ${
                customAlert.type === "success"
                  ? "bg-emerald-500/20"
                  : customAlert.type === "error"
                    ? "bg-red-500/20"
                    : "bg-blue-500/20"
              }`}
            >
              <Ionicons
                name={
                  customAlert.type === "success"
                    ? "checkmark-circle-outline"
                    : customAlert.type === "error"
                      ? "close-circle-outline"
                      : "information-circle-outline"
                }
                size={36}
                color={
                  customAlert.type === "success"
                    ? "#34D399"
                    : customAlert.type === "error"
                      ? "#F87171"
                      : "#60A5FA"
                }
              />
            </View>

            <Text
              allowFontScaling={false}
              className="text-white text-xl font-bold mb-2 text-center"
            >
              {customAlert.title}
            </Text>

            <Text
              allowFontScaling={false}
              className="text-slate-400 text-center mb-6 leading-relaxed"
            >
              {customAlert.message}
            </Text>

            <Pressable
              onPress={hideCustomAlert}
              className="w-full py-3.5 bg-slate-700 rounded-2xl items-center active:bg-slate-600"
            >
              <Text
                allowFontScaling={false}
                className="text-white font-bold text-base"
              >
                OK
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}