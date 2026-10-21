const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE_NAME = "com.juwel522.myapp";

function withAlarmManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];

    // 🌟 RingActivity রেজিস্টার
    app.activity = app.activity || [];
    app.activity = app.activity.filter(
      (a) => a.$["android:name"] !== ".RingActivity",
    );
    app.activity.push({
      $: {
        "android:name": ".RingActivity",
        "android:exported": "false",
        "android:showWhenLocked": "true",
        "android:turnScreenOn": "true",
        "android:launchMode": "singleInstance",
        "android:taskAffinity": "",
        "android:excludeFromRecents": "true",
        "android:screenOrientation": "portrait",
        "android:configChanges":
          "orientation|screenSize|screenLayout|keyboardHidden|uiMode",
        "android:theme": "@style/Theme.RingActivity",
      },
    });

    // 🌟 AlarmReceiver রেজিস্টার (যাতে অ্যাপ কাটলে অ্যালার্ম না মরে)
    app.receiver = app.receiver || [];
    app.receiver = app.receiver.filter(
      (r) => r.$["android:name"] !== ".AlarmReceiver",
    );
    app.receiver.push({
      $: {
        "android:name": ".AlarmReceiver",
        "android:enabled": "true",
        "android:exported": "true",
      },
    });

    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    const perms = [
      "android.permission.WAKE_LOCK",
      "android.permission.DISABLE_KEYGUARD",
      "android.permission.SCHEDULE_EXACT_ALARM",
      "android.permission.USE_EXACT_ALARM",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.USE_FULL_SCREEN_INTENT",
      "android.permission.READ_CONTACTS",
    ];
    perms.forEach((p) => {
      const exists = manifest["uses-permission"].some(
        (u) => u.$["android:name"] === p,
      );
      if (!exists) {
        manifest["uses-permission"].push({ $: { "android:name": p } });
      }
    });

    return config;
  });
}

function withAlarmTheme(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const stylesPath = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/values/styles.xml",
      );
      let styles = fs.readFileSync(stylesPath, "utf-8");
      if (!styles.includes("Theme.RingActivity")) {
        styles = styles.replace(
          "</resources>",
          `    <style name="Theme.RingActivity" parent="Theme.AppCompat.NoActionBar">
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:windowIsTranslucent">false</item>
        <item name="android:windowNoTitle">true</item>
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowAnimationStyle">@null</item>
    </style>
</resources>`,
        );
        fs.writeFileSync(stylesPath, styles);
      }
      return config;
    },
  ]);
}

function withAlarmNativeFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, "native/android/alarm");
      const pkgPath = PACKAGE_NAME.replace(/\./g, "/");
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        `app/src/main/java/${pkgPath}`,
      );

      if (!fs.existsSync(srcDir)) {
        console.warn(
          `[withAlarmModule] Source dir not found: ${srcDir} — skipping native file copy.`,
        );
        return config;
      }
      fs.mkdirSync(destDir, { recursive: true });
      const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".kt"));
      files.forEach((file) => {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        console.log(`[withAlarmModule] Copied ${file} -> ${destDir}`);
      });
      return config;
    },
  ]);
}

function withAlarmSound(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcSound = path.join(
        projectRoot,
        "assets/sounds/default_alarm.mp3",
      );
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/raw",
      );
      const destSound = path.join(destDir, "default_alarm.mp3");

      if (fs.existsSync(srcSound)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcSound, destSound);
        console.log(`[withAlarmModule] Copied default_alarm.mp3 to res/raw/`);
      }
      return config;
    },
  ]);
}


function withAlarmPackageRegistered(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes("add(FastContactsPackage())")) {
      if (
        contents.includes("import com.facebook.react.ReactPackage") &&
        !contents.includes(`import ${PACKAGE_NAME}.FastContactsPackage`)
      ) {
        contents = contents.replace(
          "import com.facebook.react.ReactPackage",
          `import com.facebook.react.ReactPackage\nimport ${PACKAGE_NAME}.AlarmPackage\nimport ${PACKAGE_NAME}.FastContactsPackage`,
        );
      }
      const targetString = "// add(MyReactNativePackage())";
      const replacementString =
        "// add(MyReactNativePackage())\n          add(AlarmPackage())\n          add(FastContactsPackage())";
      if (contents.includes(targetString)) {
        contents = contents.replace(targetString, replacementString);
      }
    }
    config.modResults.contents = contents;
    return config;
  });
}

function withAlarmModule(config) {
  config = withAlarmManifest(config);
  config = withAlarmTheme(config);
  config = withAlarmNativeFiles(config);
  config = withAlarmSound(config);
  config = withAlarmPackageRegistered(config);
  return config;
}

module.exports = withAlarmModule;
                                          