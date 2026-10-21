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
            universalApk false  // If true, also generate a universal APK
            // 🌟 ফিক্স: সরাসরি আর্কিটেকচারের নাম বসিয়ে দেওয়া হয়েছে
            include "armeabi-v7a", "x86", "arm64-v8a", "x86_64"
        }
    }
    // applicationVariants are e.g. debug, release
    applicationVariants.all { variant ->
        variant.outputs.each { output ->
            def versionCodes = ["armeabi-v7a": 1, "x86": 2, "arm64-v8a": 3, "x86_64": 4]
            def abi = output.getFilter(com.android.build.OutputFile.ABI)
            if (abi != null) {  
                output.versionCodeOverride =
                        defaultConfig.versionCode * 1000 + versionCodes.get(abi)
            }
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
