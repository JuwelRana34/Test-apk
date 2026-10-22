const { withAppBuildGradle } = require("@expo/config-plugins");

function withSplitApks(config) {
  return withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    if (!buildGradle.includes("splits {")) {
      const splitConfig = `
    splits {
        abi {
            reset()
            enable enableSeparateBuildPerCPUArchitecture
            universalApk false
            // 🌟 ফিক্স: শুধুমাত্র arm64-v8a রাখা হলো যাতে Expo সরাসরি ১টি সিঙ্গেল .apk ডাউনলোড দেয় (.tar.gz নয়!)
            include "arm64-v8a"
        }
    }
`;

      buildGradle = buildGradle.replace(
        /android\s*{/,
        `android {\n${splitConfig}`,
      );

      if (
        !buildGradle.includes("def enableSeparateBuildPerCPUArchitecture =")
      ) {
        buildGradle =
          `def enableSeparateBuildPerCPUArchitecture = true\n\n` + buildGradle;
      }
    }

    config.modResults.contents = buildGradle;
    return config;
  });
}

module.exports = withSplitApks;
