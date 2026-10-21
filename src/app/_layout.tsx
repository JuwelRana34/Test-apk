import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  Stack,
  useRootNavigationState,
  useRouter,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import "../global.css";
import {
  ensureNotificationChannelsAndPermissions,
  registerExpoPushTokenOnlineOffline,
} from "../lib/supabase";
import {
  restoreCloudBackupAfterGoogleLogin,
  syncLocalDataToCloudIfOnline,
} from "../lib/supabase";
import { supabase } from "../lib/supabase";

SplashScreen.preventAutoHideAsync();

const { FocusLock } = NativeModules;

export default function RootLayout() {
  const [hasOfflineSession, setHasOfflineSession] = useState<boolean | null>(
    null,
  );
  const [initialized, setInitialized] = useState(false);

  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    const initAuthAndNotifications = async () => {
      // 1. Setup Android Notification Channels (Offline + Online)
      void ensureNotificationChannelsAndPermissions();
      void registerExpoPushTokenOnlineOffline();

      // 2. Check local offline login flag first (0ms delay, works without internet)
      const storedStatus = await AsyncStorage.getItem("@is_logged_in");
      const isOfflineLogged = storedStatus === "true";

      if (isOfflineLogged) {
        setHasOfflineSession(true);
        setInitialized(true);
      }

      // 3. Check Supabase session if online
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          setHasOfflineSession(true);
          await AsyncStorage.setItem("@is_logged_in", "true");
          void restoreCloudBackupAfterGoogleLogin();
          void syncLocalDataToCloudIfOnline();
        } else if (!isOfflineLogged) {
          setHasOfflineSession(false);
        }
      } catch {
        // Offline: keep existing offline session state intact
        if (!isOfflineLogged) {
          setHasOfflineSession(false);
        }
      }

      setInitialized(true);
    };

    void initAuthAndNotifications();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setHasOfflineSession(true);
        await AsyncStorage.setItem("@is_logged_in", "true");
        void restoreCloudBackupAfterGoogleLogin();
      } else if (event === "SIGNED_OUT") {
        setHasOfflineSession(false);
        await AsyncStorage.removeItem("@is_logged_in");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Automatically route user to StrictFocusScreen when FocusBlockerService pulls user back into the app!
  useEffect(() => {
    if (!initialized || !rootNavigationState?.key || !hasOfflineSession) return;

    const checkAndEnforceLockScreen = async () => {
      if (Platform.OS !== "android" || !FocusLock?.getFocusSessionState) return;
      try {
        const state = await FocusLock.getFocusSessionState();
        const isLockedNow =
          state?.active &&
          state?.endTimeMillis > Date.now() &&
          !state?.isBreakActive;
        const currentRoute = segments.join("/");
        if (isLockedNow && !currentRoute.includes("StrictFocusScreen")) {
          router.replace("/features/StrictFocusScreen");
        }
      } catch {}
    };

    void checkAndEnforceLockScreen();

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkAndEnforceLockScreen();
        void syncLocalDataToCloudIfOnline();
      }
    });

    const notifResponseSub =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const targetScreen =
          response.notification.request.content.data?.screen;
        if (typeof targetScreen === "string") {
          router.push(targetScreen as any);
        } else {
          router.push("/features/SmartNetworking");
        }
      });

    return () => {
      appStateSub.remove();
      notifResponseSub.remove();
    };
  }, [initialized, rootNavigationState?.key, hasOfflineSession, segments, router]);

  useEffect(() => {
    if (!initialized || !rootNavigationState?.key) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (hasOfflineSession === false && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (hasOfflineSession === true && inAuthGroup) {
      router.replace("/(tabs)");
    }

    void SplashScreen.hideAsync();
  }, [hasOfflineSession, initialized, segments, rootNavigationState?.key, router]);

  if (!initialized) {
    return null;
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen
          name="features/alarm"
          options={{
            animation: "slide_from_right",
          }}
        />
        <Stack.Screen
          name="features/SmartNetworking"
          options={{
            animation: "slide_from_right",
          }}
        />
        <Stack.Screen
          name="features/StrictFocusScreen"
          options={{
            animation: "fade",
            gestureEnabled: false,
          }}
        />
      </Stack>
    </>
  );
}
