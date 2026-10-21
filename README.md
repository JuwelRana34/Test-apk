# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).
অর্থাৎ বর্তমানে expo start Expo Go mode-এ চলছে।

এখন যা করবেন:

টার্মিনালে s চাপুন।
এটি Development Build mode-এ সুইচ করবে।
এরপর a চাপুন।
এটি ADB দিয়ে আপনার ফোনে ইনস্টল করা Development Build খুলতে চেষ্টা করবে।

 rm -rf android
 npx expo prebuild
 cd android && ./gradlew assembleRelease 

ব্যস! এখন যখনই আপনি npx expo run:android বা npx expo prebuild --clean রান করবেন:


🚀 Step 3: প্রজেক্ট রিবিল্ড করা

যেহেতু আমরা নতুন নেটিভ প্যাকেজ এড করেছি, এক্সপোকে একবার ক্লিন করে বিল্ড করতে হবে। টার্মিনালে এই কমান্ডগুলো দিন:
Bash

npx expo prebuild --clean
npx expo run:android
## Get started
npx expo run:android
npx expo run:android --variant release

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
