import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#818CF8",
        tabBarInactiveTintColor: "#64748B",
        tabBarStyle: {
          backgroundColor: "#0B1120",
          borderTopWidth: 1,
          borderTopColor: "#1E293B",
          elevation: 20,
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.35,
          shadowRadius: 12,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <View
              className={`px-3.5 py-1 rounded-full ${
                focused ? "bg-indigo-500/15" : ""
              }`}
            >
              <MaterialCommunityIcons
                name={focused ? "view-dashboard" : "view-dashboard-outline"}
                color={color}
                size={22}
              />
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="notice"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color, focused }) => (
            <View
              className={`px-3.5 py-1 rounded-full ${
                focused ? "bg-indigo-500/15" : ""
              }`}
            >
              <MaterialCommunityIcons
                name={focused ? "bell-ring" : "bell-outline"}
                color={color}
                size={22}
              />
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <View
              className={`px-3.5 py-1 rounded-full ${
                focused ? "bg-indigo-500/15" : ""
              }`}
            >
              <MaterialCommunityIcons
                name={focused ? "account-circle" : "account-circle-outline"}
                color={color}
                size={22}
              />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
