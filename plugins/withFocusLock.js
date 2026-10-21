const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE_NAME = "com.juwel522.myapp";

function withFocusLockManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];

    // 1. Accessibility Service setup (0ms instant response)
    app.service = app.service || [];
    app.service = app.service.filter(
      (s) => s.$["android:name"] !== ".FocusBlockerService",
    );
    app.service.push({
      $: {
        "android:name": ".FocusBlockerService",
        "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
        "android:exported": "true",
        "android:foregroundServiceType": "specialUse",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name":
                  "android.accessibilityservice.AccessibilityService",
              },
            },
          ],
        },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.accessibilityservice",
            "android:resource": "@xml/focus_accessibility_config",
          },
        },
      ],
      property: [
        {
          $: {
            "android:name": "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE",
            "android:value": "Accessibility-based focus session enforcement",
          },
        },
      ],
    });

    // 2. Receivers setup (SessionTriggerReceiver, BootReceiver, LockdownAdminReceiver)
    app.receiver = app.receiver || [];
    app.receiver = app.receiver.filter(
      (receiver) =>
        ![
          ".SessionTriggerReceiver",
          ".BootReceiver",
          ".LockdownAdminReceiver",
        ].includes(receiver.$["android:name"]),
    );

    app.receiver.push({
      $: {
        "android:name": ".SessionTriggerReceiver",
        "android:enabled": "true",
        "android:exported": "true",
      },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "android.intent.action.BOOT_COMPLETED" } },
            { $: { "android:name": "START_SESSION" } },
            { $: { "android:name": "END_SESSION" } },
          ],
        },
      ],
    });

    app.receiver.push({
      $: {
        "android:name": ".BootReceiver",
        "android:enabled": "true",
        "android:exported": "true",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.intent.action.BOOT_COMPLETED",
              },
            },
          ],
        },
      ],
    });

    // Device Administrator Receiver (Uninstall Protection)
    app.receiver.push({
      $: {
        "android:name": ".LockdownAdminReceiver",
        "android:permission": "android.permission.BIND_DEVICE_ADMIN",
        "android:exported": "true",
      },
      "meta-data": [
        {
          $: {
            "android:name": "android.app.device_admin",
            "android:resource": "@xml/device_admin_receiver",
          },
        },
      ],
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.app.action.DEVICE_ADMIN_ENABLED",
              },
            },
          ],
        },
      ],
    });

    // 3. Permissions setup
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    const perms = [
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.SCHEDULE_EXACT_ALARM",
      "android.permission.USE_EXACT_ALARM",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
      "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      "android.permission.REORDER_TASKS",
      "android.permission.QUERY_ALL_PACKAGES",
      "android.permission.WAKE_LOCK",
      "android.permission.USE_FULL_SCREEN_INTENT",
      "android.permission.DISABLE_KEYGUARD",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.VIBRATE",
    ];
    perms.forEach((p) => {
      if (!manifest["uses-permission"].some((u) => u.$["android:name"] === p)) {
        manifest["uses-permission"].push({ $: { "android:name": p } });
      }
    });

    if (app.activity) {
      const mainActivity = app.activity.find(
        (a) => a.$["android:name"] === ".MainActivity",
      );
      if (mainActivity) {
        mainActivity.$["android:launchMode"] = "singleTask";
        mainActivity.$["android:showWhenLocked"] = "true";
        mainActivity.$["android:turnScreenOn"] = "true";
      }
    }

    return config;
  });
}

function withFocusLockXMLResources(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const resXmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      if (!fs.existsSync(resXmlDir))
        fs.mkdirSync(resXmlDir, { recursive: true });

      const accessibilityContent = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowsChanged|typeWindowContentChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault|flagRetrieveInteractiveWindows|flagIncludeNotImportantViews|flagReportViewIds"
    android:canRetrieveWindowContent="true"
    android:notificationTimeout="0"
    android:description="@string/app_name" />`;

      fs.writeFileSync(
        path.join(resXmlDir, "focus_accessibility_config.xml"),
        accessibilityContent,
      );

      const deviceAdminContent = `<?xml version="1.0" encoding="utf-8"?>
<device-admin xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-policies>
        <force-lock />
    </uses-policies>
</device-admin>`;

      fs.writeFileSync(
        path.join(resXmlDir, "device_admin_receiver.xml"),
        deviceAdminContent,
      );

      return config;
    },
  ]);
}

function withFocusLockNativeFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const srcDir = path.join(
        config.modRequest.projectRoot,
        "native/android/focuslock",
      );
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        `app/src/main/java/${PACKAGE_NAME.replace(/\./g, "/")}`,
      );
      if (!fs.existsSync(srcDir)) return config;
      fs.mkdirSync(destDir, { recursive: true });
      const staleActivity = path.join(destDir, "LockScreenActivity.kt");
      if (fs.existsSync(staleActivity)) fs.unlinkSync(staleActivity);
      fs.readdirSync(srcDir)
        .filter((f) => f.endsWith(".kt"))
        .forEach((file) => {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        });
      return config;
    },
  ]);
}

function withFocusLockPackageRegistered(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes(`import ${PACKAGE_NAME}.FocusLockPackage`)) {
      contents = contents.replace(
        "import com.facebook.react.ReactPackage",
        `import com.facebook.react.ReactPackage\nimport ${PACKAGE_NAME}.FocusLockPackage`,
      );
    }
    const targetString = "// add(MyReactNativePackage())";
    if (
      contents.includes(targetString) &&
      !contents.includes("add(FocusLockPackage())")
    ) {
      contents = contents.replace(
        targetString,
        `// add(MyReactNativePackage())\n          add(FocusLockPackage())`,
      );
    }
    config.modResults.contents = contents;
    return config;
  });
}

module.exports = (config) =>
  withFocusLockPackageRegistered(
    withFocusLockNativeFiles(
      withFocusLockXMLResources(withFocusLockManifest(config)),
    ),
  );
