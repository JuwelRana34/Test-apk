package com.juwel522.myapp

import android.app.Activity
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.text.TextUtils
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.bridge.*
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.HashSet
import java.util.Locale

class FocusLockModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val SESSION_FOCUS_MILLIS = 25 * 60 * 1000L
        private const val SESSION_BREAK_MILLIS = 5 * 60 * 1000L
        private const val SESSION_CYCLE_MILLIS = SESSION_FOCUS_MILLIS + SESSION_BREAK_MILLIS

        private const val SCHEDULE_FOCUS_MILLIS = 50 * 60 * 1000L
        private const val SCHEDULE_BREAK_MILLIS = 10 * 60 * 1000L
        private const val SCHEDULE_CYCLE_MILLIS = SCHEDULE_FOCUS_MILLIS + SCHEDULE_BREAK_MILLIS

        // Free vs Pro Session Caps: Free = 60m (1h), Pro = 360m (6h)
        private const val FREE_MAX_SESSION_MINUTES = 60
        private const val PRO_MAX_SESSION_MINUTES = 360
        private const val MAX_SCHEDULE_MINUTES = 900

        private const val BIOMETRIC_REQUEST_CODE = 5229

        // 🌟 XOR-Obfuscated Secret Key Bytes so nobody can grep strings from the APK!
        private val OBFUSCATED_SALT = intArrayOf(
            0x1E, 0x25, 0x21, 0x23, 0x67, 0x1A, 0x38, 0x25,
            0x67, 0x19, 0x2F, 0x23, 0x2F, 0x26, 0x2E, 0x67,
            0x78, 0x7A, 0x78, 0x7C
        )
    }

    private var pendingBiometricPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String {
        return "FocusLock"
    }

    // Reconstructs secret salt in memory only when verifying/generating keys
    private fun getSecretSalt(): String {
        val chars = CharArray(OBFUSCATED_SALT.size)
        for (i in OBFUSCATED_SALT.indices) {
            chars[i] = (OBFUSCATED_SALT[i] xor 0x4A).toChar()
        }
        return String(chars)
    }

    // Computes deterministic 8-char signature for (accountCode + planType + nonce)
    private fun computeKeySignature(accountCode: String, planType: String, nonce: String): String {
        val cleanCode = accountCode.trim().uppercase(Locale.US)
        val cleanType = planType.trim().uppercase(Locale.US)
        val cleanNonce = nonce.trim().uppercase(Locale.US)
        val raw = "$cleanCode|$cleanType|$cleanNonce|${getSecretSalt()}"
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(raw.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder()
        for (i in 0 until 4) {
            sb.append(String.format("%02X", digest[i]))
        }
        return sb.toString()
    }

    // 🌟 Hardware Fingerprint / Biometric / Screen Lock Verification for Admin Control Panel!
    @ReactMethod
    fun authenticateAdminBiometric(promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
            if (activity == null) {
                promise.resolve(false)
                return
            }
            val km = reactApplicationContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            if (!km.isDeviceSecure) {
                // If phone has no screen lock/fingerprint set at all, warn admin to set one or allow
                promise.resolve(true)
                return
            }

            @Suppress("DEPRECATION")
            val intent = km.createConfirmDeviceCredentialIntent(
                "Toki Admin Security 👑",
                "অ্যাডমিন প্যানেলে প্রবেশ করতে আপনার ফোনের Fingerprint বা Screen Lock ভেরিফাই করুন"
            )
            if (intent != null) {
                pendingBiometricPromise = promise
                activity.startActivityForResult(intent, BIOMETRIC_REQUEST_CODE)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == BIOMETRIC_REQUEST_CODE) {
            val p = pendingBiometricPromise
            pendingBiometricPromise = null
            if (p != null) {
                p.resolve(resultCode == Activity.RESULT_OK)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {}

    // 🌟 Anti-Crack / Mod & Lucky Patcher Detector
    private fun isDeviceUsingPiracyTools(): Boolean {
        val piratePkgs = listOf(
            "com.chelpus.lackypatch",
            "com.dimonvideo.luckypatcher",
            "com.forpda.lp",
            "com.android.vending.billing.InAppBillingService.COIN",
            "com.android.vending.billing.InAppBillingService.LUCK"
        )
        val pm = reactApplicationContext.packageManager
        for (pkg in piratePkgs) {
            try {
                pm.getPackageInfo(pkg, 0)
                return true
            } catch (_: Exception) {}
        }
        return false
    }

    // 🌟 Generates a User-Bound Cryptographic Activation Key (Admin Only!)
    // Format: TK-<TYPE>-<NONCE>-<8_CHAR_SHA256_SIG>
    @ReactMethod
    fun generateActivationKeyNative(
        targetAccountCode: String,
        planType: String,
        promise: Promise
    ) {
        try {
            val cleanAcc = targetAccountCode.trim().uppercase(Locale.US)
            val cleanType = planType.trim().uppercase(Locale.US)
            val nonce = ((System.currentTimeMillis() / 1000L) % 90000L + 10000L).toString()
            val sig = computeKeySignature(cleanAcc, cleanType, nonce)
            val fullKey = "TK-$cleanType-$nonce-$sig"
            promise.resolve(fullKey)
        } catch (e: Exception) {
            promise.reject("KEY_GEN_ERROR", e.message)
        }
    }

    // 🌟 Verifies & Applies a User-Bound Cryptographic Activation Key in Native Kotlin!
    @ReactMethod
    fun verifyAndApplyActivationKey(
        userAccountCode: String,
        keyString: String,
        promise: Promise
    ) {
        try {
            if (isDeviceUsingPiracyTools()) {
                val errMap = WritableNativeMap().apply {
                    putBoolean("success", false)
                    putString("message", "ফোনে আনঅফিসিয়াল পির‍্যাসি টুল (Lucky Patcher) পাওয়া গেছে! অনুগ্রহ করে সেটি আনইনস্টল করুন।")
                }
                promise.resolve(errMap)
                return
            }

            val cleanAcc = userAccountCode.trim().uppercase(Locale.US)
            val cleanKey = keyString.trim().uppercase(Locale.US)
            val parts = cleanKey.split("-")
            if (parts.size != 4 || parts[0] != "TK") {
                val errMap = WritableNativeMap().apply {
                    putBoolean("success", false)
                    putString("message", "অ্যাক্টিভেশন কোডের ফরম্যাট সঠিক নয়!")
                }
                promise.resolve(errMap)
                return
            }

            val planType = parts[1]
            val nonce = parts[2]
            val providedSig = parts[3]
            val expectedSig = computeKeySignature(cleanAcc, planType, nonce)

            if (providedSig != expectedSig) {
                val errMap = WritableNativeMap().apply {
                    putBoolean("success", false)
                    putString("message", "এই কোডটি আপনার অ্যাকাউন্টের ($cleanAcc) জন্য নয় অথবা কোডটি ভুল!")
                }
                promise.resolve(errMap)
                return
            }

            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val usedKeysCsv = prefs.getString("USED_LICENSE_KEYS_CSV", "") ?: ""
            val usedSet = usedKeysCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toMutableSet()

            if (usedSet.contains(cleanKey)) {
                val errMap = WritableNativeMap().apply {
                    putBoolean("success", false)
                    putString("message", "এই অ্যাক্টিভেশন কোডটি ইতিমধ্যে একবার ব্যবহার করা হয়েছে!")
                }
                promise.resolve(errMap)
                return
            }

            usedSet.add(cleanKey)
            val now = System.currentTimeMillis()
            val dayMillis = 24L * 60L * 60L * 1000L
            var currentEarned = prefs.getInt("TOTAL_PASSES_EARNED", prefs.getInt("EMERGENCY_PASSES", 0))
            val currentUsed = prefs.getInt("TOTAL_PASSES_USED", 0)
            var currentProExpiry = prefs.getLong("PRO_EXPIRES_AT", 0L)
            var planTitle = ""
            var amountBdt = 0

            val editor = prefs.edit()
                .putString("USED_LICENSE_KEYS_CSV", usedSet.joinToString(","))

            when (planType) {
                "PRO30" -> {
                    val base = maxOf(now, currentProExpiry)
                    currentProExpiry = base + 30L * dayMillis
                    planTitle = "Monthly Toki Pro (30 Days)"
                    amountBdt = 49
                    editor.putBoolean("IS_PRO_USER", true)
                    editor.putLong("PRO_EXPIRES_AT", currentProExpiry)
                    editor.putString("PRO_PLAN_NAME", planTitle)
                }
                "PRO180" -> {
                    val base = maxOf(now, currentProExpiry)
                    currentProExpiry = base + 180L * dayMillis
                    // 6-Month Pro includes +1 Free Bonus Pass!
                    currentEarned += 1
                    planTitle = "6-Month Semester Pro (+1 Bonus Pass)"
                    amountBdt = 199
                    editor.putBoolean("IS_PRO_USER", true)
                    editor.putLong("PRO_EXPIRES_AT", currentProExpiry)
                    editor.putString("PRO_PLAN_NAME", planTitle)
                }
                "PRO365" -> {
                    val base = maxOf(now, currentProExpiry)
                    currentProExpiry = base + 365L * dayMillis
                    // Yearly VIP Pro includes +1 Free Bonus Pass!
                    currentEarned += 1
                    planTitle = "Yearly VIP Pro (+1 Bonus Pass)"
                    amountBdt = 349
                    editor.putBoolean("IS_PRO_USER", true)
                    editor.putLong("PRO_EXPIRES_AT", currentProExpiry)
                    editor.putString("PRO_PLAN_NAME", planTitle)
                }
                "PASS1" -> {
                    currentEarned += 1
                    planTitle = "1 Instant Emergency Pass"
                    amountBdt = 19
                }
                "PASS3" -> {
                    currentEarned += 3
                    planTitle = "3 Emergency Pass Pack"
                    amountBdt = 49
                }
                else -> {
                    val errMap = WritableNativeMap().apply {
                        putBoolean("success", false)
                        putString("message", "অজানা প্যাকেজ টাইপ!")
                    }
                    promise.resolve(errMap)
                    return
                }
            }

            val updatedPasses = (currentEarned - currentUsed).coerceIn(0, 15)
            editor
                .putInt("TOTAL_PASSES_EARNED", currentEarned)
                .putInt("EMERGENCY_PASSES", updatedPasses)
                .commit()

            val resMap = WritableNativeMap().apply {
                putBoolean("success", true)
                putString("planType", planType)
                putString("planTitle", planTitle)
                putInt("amountBdt", amountBdt)
                putDouble("proExpiresAt", currentProExpiry.toDouble())
                putInt("emergencyPasses", updatedPasses)
                putString("message", "$planTitle সফলভাবে অ্যাক্টিভেট হয়েছে!")
            }
            promise.resolve(resMap)
        } catch (e: Exception) {
            promise.reject("VERIFY_KEY_ERROR", e.message)
        }
    }

    private fun applyDarkNavBarInternal() {
        val activity = reactApplicationContext.currentActivity ?: return
        activity.runOnUiThread {
            try {
                val window = activity.window
                window.navigationBarColor = Color.parseColor("#0B1120")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    window.navigationBarDividerColor = Color.parseColor("#1E293B")
                }
                val controller = WindowInsetsControllerCompat(window, window.decorView)
                controller.isAppearanceLightNavigationBars = false
            } catch (_: Exception) {}
        }
    }

    @ReactMethod
    fun applyDarkNavigationBar(promise: Promise) {
        applyDarkNavBarInternal()
        promise.resolve(true)
    }

    // 100% Account-Wise Isolation: Clears previous Gmail's native SharedPreferences & alarms on Sign Out or Account Switch!
    @ReactMethod
    fun resetLocalAccountData(newUserId: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit()
                .clear()
                .putString("ACTIVE_USER_ID", newUserId)
                .putInt("YT_LIMIT_MINUTES", 30)
                .putInt("YT_STUDY_LIMIT_MINUTES", 210)
                .putBoolean("POMODORO_ENABLED", true)
                .putBoolean("SCHEDULE_BREAK_ENABLED", true)
                .commit()

            FocusScheduler.cancelSessionAlarms(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("RESET_ACCOUNT_ERROR", e.message)
        }
    }

    private fun isProActive(prefs: android.content.SharedPreferences): Boolean {
        val proFlag = prefs.getBoolean("IS_PRO_USER", false)
        val expiresAt = prefs.getLong("PRO_EXPIRES_AT", 0L)
        return proFlag && expiresAt > System.currentTimeMillis()
    }

    private fun saveAllowedAppsToPrefs(prefs: android.content.SharedPreferences, pkgSet: Set<String>) {
        val maxAllowed = if (isProActive(prefs)) 6 else 2
        val limitedSet = pkgSet.take(maxAllowed).toSet()
        prefs.edit().remove("ALLOWED_APPS").apply()
        prefs.edit()
            .putStringSet("ALLOWED_APPS", HashSet(limitedSet))
            .putString("ALLOWED_APPS_CSV", limitedSet.joinToString(","))
            .commit()
    }

    private fun saveAllowedDomainsToPrefs(prefs: android.content.SharedPreferences, domainList: List<String>) {
        val maxDomains = if (isProActive(prefs)) 5 else 2
        val cleanList = domainList
            .map { it.trim().lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.").trimEnd('/') }
            .filter { it.isNotEmpty() && !it.contains("youtube.") && !it.contains("youtu.be") }
            .distinct()
            .take(maxDomains)

        prefs.edit().remove("ALLOWED_DOMAINS").apply()
        prefs.edit()
            .putStringSet("ALLOWED_DOMAINS", HashSet(cleanList))
            .putString("ALLOWED_DOMAINS_CSV", cleanList.joinToString(","))
            .commit()
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        try {
            val enabledServices = Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            )
            if (enabledServices.isNullOrEmpty()) {
                promise.resolve(false)
                return
            }
            val colonSplitter = TextUtils.SimpleStringSplitter(':')
            colonSplitter.setString(enabledServices)
            val packageName = reactApplicationContext.packageName
            val targetService = "$packageName/${FocusBlockerService::class.java.name}"

            var isEnabled = false
            while (colonSplitter.hasNext()) {
                val componentName = colonSplitter.next()
                if (componentName.equals(targetService, ignoreCase = true)) {
                    isEnabled = true
                    break
                }
            }
            promise.resolve(isEnabled)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun isOverlayPermissionGranted(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                promise.resolve(Settings.canDrawOverlays(reactApplicationContext))
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openOverlaySettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${reactApplicationContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun isDeviceAdminEnabled(promise: Promise) {
        try {
            val dpm = reactApplicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val adminComponent = ComponentName(reactApplicationContext, LockdownAdminReceiver::class.java)
            promise.resolve(dpm.isAdminActive(adminComponent))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openDeviceAdminSettings(promise: Promise) {
        try {
            val adminComponent = ComponentName(reactApplicationContext, LockdownAdminReceiver::class.java)
            val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
                putExtra(
                    DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                    "লক চলাকালীন কেউ যেন অ্যাপ আনইনস্টল বা বন্ধ করতে না পারে, সেজন্য এই পারমিশনটি অন করুন।"
                )
            }
            val currentActivity = reactApplicationContext.currentActivity
            if (currentActivity != null) {
                currentActivity.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun checkAndRequestBatteryWhitelist(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
                if (!pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName)) {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${reactApplicationContext.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactApplicationContext.startActivity(intent)
                    promise.resolve(false)
                    return
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val packages = pm.getInstalledPackages(PackageManager.GET_META_DATA)
            val appList = WritableNativeArray()

            for (pkgInfo in packages) {
                val appInfo = pkgInfo.applicationInfo ?: continue
                val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                val isUpdatedSystem = (appInfo.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0

                val launchIntent = pm.getLaunchIntentForPackage(pkgInfo.packageName)
                if (launchIntent != null || (!isSystem || isUpdatedSystem)) {
                    if (pkgInfo.packageName == reactApplicationContext.packageName) continue

                    val appName = pm.getApplicationLabel(appInfo).toString()
                    val iconDrawable = pm.getApplicationIcon(appInfo)

                    val map = WritableNativeMap().apply {
                        putString("packageName", pkgInfo.packageName)
                        putString("appName", appName)
                        putString("icon", drawableToBase64(iconDrawable))
                    }
                    appList.pushMap(map)
                }
            }
            promise.resolve(appList)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    private fun drawableToBase64(drawable: Drawable?): String? {
        if (drawable == null) return null
        try {
            val size = 48
            val bitmap = if (drawable is BitmapDrawable && drawable.bitmap.width <= size && drawable.bitmap.height <= size) {
                drawable.bitmap
            } else {
                val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bmp)
                drawable.setBounds(0, 0, canvas.width, canvas.height)
                drawable.draw(canvas)
                bmp
            }
            val outputStream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 70, outputStream)
            return Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            return null
        }
    }

    @ReactMethod
    fun saveAllowedApps(apps: ReadableArray, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val maxApps = if (isProActive(prefs)) 6 else 2
            val appSet = LinkedHashSet<String>()
            val limit = minOf(apps.size(), maxApps)
            for (i in 0 until limit) {
                val pkg = apps.getString(i)?.trim()
                if (!pkg.isNullOrEmpty()) appSet.add(pkg)
            }
            saveAllowedAppsToPrefs(prefs, appSet)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun saveAllowedDomains(domains: ReadableArray, promise: Promise) {
        try {
            val list = ArrayList<String>()
            for (i in 0 until domains.size()) {
                val d = domains.getString(i)?.trim()?.lowercase()
                if (!d.isNullOrEmpty()) list.add(d)
            }
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            saveAllowedDomainsToPrefs(prefs, list)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setYouTubeLimitMinutes(limitMinutes: Int, promise: Promise) {
        try {
            val safeGeneral = limitMinutes.coerceIn(15, 45)
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit().putInt("YT_LIMIT_MINUTES", safeGeneral).commit()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setStudyYouTubeConfig(
        studyLimitMinutes: Int,
        channels: ReadableArray,
        videosJson: String,
        promise: Promise
    ) {
        try {
            val safeStudyLimit = studyLimitMinutes.coerceIn(90, 210)
            val channelList = ArrayList<String>()
            for (i in 0 until minOf(channels.size(), 5)) {
                val ch = channels.getString(i)?.trim()
                if (!ch.isNullOrEmpty()) channelList.add(ch)
            }
            val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit()
                .putInt("YT_STUDY_LIMIT_MINUTES", safeStudyLimit)
                .putString("STUDY_YT_CHANNELS_CSV", channelList.joinToString(","))
                .putString("STUDY_YT_VIDEOS_JSON", videosJson)
                .putString("STUDY_YT_VIDEOS_DATE", todayStr)
                .commit()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STUDY_YT_CONFIG_ERROR", e.message)
        }
    }

    @ReactMethod
    fun openStudyYouTubeItem(urlOrQuery: String, promise: Promise) {
        try {
            val clean = urlOrQuery.trim()
            val ytPkg = "com.google.android.youtube"
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()

            val targetUri = if (clean.startsWith("http://") || clean.startsWith("https://")) {
                Uri.parse(clean)
            } else if (clean.contains("youtu.be/") || clean.contains("youtube.com/")) {
                Uri.parse("https://$clean")
            } else {
                Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(clean)}")
            }

            prefs.edit()
                .putString("LAST_LAUNCHED_ALLOWED_APP", ytPkg)
                .putLong("WHITELIST_GRACE_UNTIL", now + 1500L)
                .putLong("LAST_LAUNCHED_STUDY_YT_UNTIL", now + 15 * 60 * 1000L)
                .commit()

            reactApplicationContext.sendBroadcast(
                Intent(FocusBlockerService.ACTION_START_YT_TRACKER)
                    .setPackage(reactApplicationContext.packageName)
            )

            val intent = Intent(Intent.ACTION_VIEW, targetUri).apply {
                setPackage(ytPkg)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                reactApplicationContext.startActivity(intent)
            } catch (_: Exception) {
                val fallback = reactApplicationContext.packageManager.getLaunchIntentForPackage(ytPkg)
                if (fallback != null) {
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    reactApplicationContext.startActivity(fallback)
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_STUDY_YT_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setScheduleBreakEnabled(enabled: Boolean, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit().putBoolean("SCHEDULE_BREAK_ENABLED", enabled).commit()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun openPdfUri(uriString: String, promise: Promise) {
        try {
            val parsedUri = if (uriString.startsWith("file://")) {
                val file = File(Uri.parse(uriString).path ?: "")
                FileProvider.getUriForFile(
                    reactApplicationContext,
                    "${reactApplicationContext.packageName}.provider",
                    file
                )
            } else {
                Uri.parse(uriString)
            }

            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(parsedUri, "application/pdf")
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }

            val chooser = Intent.createChooser(viewIntent, "Read Study PDF").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_PDF_ERROR", e.message)
        }
    }

    @ReactMethod
    fun openUrlInChrome(domainOrUrl: String, promise: Promise) {
        try {
            val clean = domainOrUrl.trim().lowercase()
                .removePrefix("https://")
                .removePrefix("http://")
            val fullUrl = "https://$clean"
            val chromePkg = "com.android.chrome"

            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val existingCsv = prefs.getString("ALLOWED_APPS_CSV", "") ?: ""
            val updatedSet = existingCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toMutableSet()
            updatedSet.add(chromePkg)

            prefs.edit()
                .putString("LAST_LAUNCHED_ALLOWED_APP", chromePkg)
                .putLong("WHITELIST_GRACE_UNTIL", System.currentTimeMillis() + 1200L)
                .putString("ALLOWED_APPS_CSV", updatedSet.joinToString(","))
                .putStringSet("ALLOWED_APPS", HashSet(updatedSet))
                .commit()

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(fullUrl)).apply {
                setPackage(chromePkg)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                reactApplicationContext.startActivity(intent)
            } catch (_: Exception) {
                val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse(fullUrl)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(fallbackIntent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_URL_ERROR", e.message)
        }
    }

    @ReactMethod
    fun openApp(packageName: String, promise: Promise) {
        try {
            val cleanPkg = packageName.trim()
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)

            val existingCsv = prefs.getString("ALLOWED_APPS_CSV", "") ?: ""
            val updatedSet = existingCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toMutableSet()
            updatedSet.add(cleanPkg)

            prefs.edit()
                .putString("LAST_LAUNCHED_ALLOWED_APP", cleanPkg)
                .putLong("WHITELIST_GRACE_UNTIL", System.currentTimeMillis() + 1200L)
                .putString("ALLOWED_APPS_CSV", updatedSet.joinToString(","))
                .putStringSet("ALLOWED_APPS", HashSet(updatedSet))
                .commit()

            if (cleanPkg == "com.google.android.youtube") {
                reactApplicationContext.sendBroadcast(
                    Intent(FocusBlockerService.ACTION_START_YT_TRACKER)
                        .setPackage(reactApplicationContext.packageName)
                )
            }

            if (cleanPkg == "com.android.chrome") {
                val domainsCsv = prefs.getString("ALLOWED_DOMAINS_CSV", "") ?: ""
                val firstDomain = domainsCsv.split(",").map { it.trim() }.firstOrNull { it.isNotEmpty() }
                if (!firstDomain.isNullOrEmpty()) {
                    openUrlInChrome(firstDomain, promise)
                    return
                }
            }

            val pm = reactApplicationContext.packageManager
            val intent = pm.getLaunchIntentForPackage(cleanPkg)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun startQuickFocus(
        durationMinutes: Int,
        allowedPackages: ReadableArray,
        ytLimitMinutes: Int,
        pomodoroEnabled: Boolean,
        promise: Promise
    ) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val pro = isProActive(prefs)
            val maxSessionMins = if (pro) PRO_MAX_SESSION_MINUTES else FREE_MAX_SESSION_MINUTES
            val maxApps = if (pro) 6 else 2

            val safeDurationMinutes = durationMinutes.coerceIn(1, maxSessionMins)
            val safeGeneralYtLimit = ytLimitMinutes.coerceIn(15, 45)

            val pkgSet = LinkedHashSet<String>()
            val limit = minOf(allowedPackages.size(), maxApps)
            for (i in 0 until limit) {
                val pkg = allowedPackages.getString(i)?.trim()
                if (!pkg.isNullOrEmpty()) pkgSet.add(pkg)
            }

            val now = System.currentTimeMillis()
            val nowRealtime = SystemClock.elapsedRealtime()
            val sessionEndTime = now + (safeDurationMinutes * 60 * 1000L)

            saveAllowedAppsToPrefs(prefs, pkgSet)

            prefs.edit().apply {
                putBoolean("IS_SESSION_ACTIVE", true)
                putString("LOCK_MODE", "SESSION")
                putBoolean("POMODORO_ENABLED", pomodoroEnabled)
                putInt("YT_LIMIT_MINUTES", safeGeneralYtLimit)
                putLong("SESSION_START_TIME", now)
                putLong("SESSION_START_REALTIME", nowRealtime)
                putLong("SESSION_END_TIME", sessionEndTime)
                putLong("SESSION_PLANNED_DURATION", safeDurationMinutes * 60 * 1000L)
            }.commit()

            val alarmManager = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val endIntent = Intent(reactApplicationContext, SessionTriggerReceiver::class.java).apply {
                action = "END_SESSION"
                putExtra("ACTION_TYPE", "END_SESSION")
            }
            val endPendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext,
                1003,
                endIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
            if (canScheduleExact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, sessionEndTime, endPendingIntent)
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, sessionEndTime, endPendingIntent)
            }

            reactApplicationContext.sendBroadcast(
                Intent(FocusBlockerService.ACTION_REDIRECT_MAIN_APP)
                    .setPackage(reactApplicationContext.packageName)
            )

            promise.resolve("Session Lock Started!")
        } catch (e: Exception) {
            promise.reject("QUICK_FOCUS_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setFocusSchedule(
        startHour: Int,
        startMinute: Int,
        endHour: Int,
        endMinute: Int,
        enabled: Boolean,
        allowedPackages: ReadableArray?,
        ytLimitMinutes: Int,
        activeDays: ReadableArray?,
        sessionEndTimeMillis: Double,
        promise: Promise
    ) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val maxApps = if (isProActive(prefs)) 6 else 2
            if (allowedPackages != null) {
                val pkgSet = LinkedHashSet<String>()
                val limit = minOf(allowedPackages.size(), maxApps)
                for (i in 0 until limit) {
                    val pkg = allowedPackages.getString(i)?.trim()
                    if (!pkg.isNullOrEmpty()) pkgSet.add(pkg)
                }
                saveAllowedAppsToPrefs(prefs, pkgSet)
            }

            val editor = prefs.edit()
                .putInt("START_HOUR", startHour)
                .putInt("START_MINUTE", startMinute)
                .putInt("END_HOUR", endHour)
                .putInt("END_MINUTE", endMinute)
                .putBoolean("IS_FOCUS_ENABLED", enabled)
                .putInt("YT_LIMIT_MINUTES", ytLimitMinutes.coerceIn(15, 45))

            if (activeDays != null) {
                val daySet = HashSet<String>()
                for (i in 0 until activeDays.size()) {
                    daySet.add(activeDays.getInt(i).toString())
                }
                editor.putStringSet("ACTIVE_DAYS", daySet)
            }

            editor.commit()
            FocusScheduler.scheduleAlarms(reactApplicationContext)
            promise.resolve("Schedule Saved!")
        } catch (e: Exception) {
            promise.reject("SCHEDULE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setAdvancedSchedules(
        schedulesJson: String,
        globalEnabled: Boolean,
        allowedPackages: ReadableArray,
        ytLimitMinutes: Int,
        promise: Promise
    ) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val maxApps = if (isProActive(prefs)) 6 else 2
            val packagesSet = LinkedHashSet<String>()
            val limit = minOf(allowedPackages.size(), maxApps)
            for (i in 0 until limit) {
                val pkg = allowedPackages.getString(i)?.trim()
                if (!pkg.isNullOrEmpty()) packagesSet.add(pkg)
            }

            saveAllowedAppsToPrefs(prefs, packagesSet)

            prefs.edit()
                .putString("MULTI_SCHEDULES_JSON", schedulesJson)
                .putBoolean("SCHEDULE_ENABLED", globalEnabled)
                .putInt("YT_LIMIT_MINUTES", ytLimitMinutes.coerceIn(15, 45))
                .commit()

            FocusScheduler.scheduleAlarms(reactApplicationContext)
            promise.resolve("Advanced schedules saved successfully")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getFocusSessionState(promise: Promise) {
        try {
            applyDarkNavBarInternal()
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val active = prefs.getBoolean("IS_SESSION_ACTIVE", false)
            val startTimeMillis = prefs.getLong("SESSION_START_TIME", 0L)
            val endTimeMillis = prefs.getLong("SESSION_END_TIME", 0L)
            val lockMode = prefs.getString("LOCK_MODE", "SESSION") ?: "SESSION"
            val pomodoroEnabled = prefs.getBoolean("POMODORO_ENABLED", true)
            val scheduleBreakEnabled = prefs.getBoolean("SCHEDULE_BREAK_ENABLED", true)

            var isBreakActive = false
            var cycleRemainingMillis = 0L
            var noMoreBreaks = false

            if (active && endTimeMillis > now) {
                val totalRemainingMillis = endTimeMillis - now
                val useCycle = (lockMode == "SESSION" && pomodoroEnabled) ||
                    (lockMode == "SCHEDULE" && scheduleBreakEnabled)

                if (useCycle && startTimeMillis > 0L && now >= startTimeMillis) {
                    val focusMillis = if (lockMode == "SCHEDULE") SCHEDULE_FOCUS_MILLIS else SESSION_FOCUS_MILLIS
                    val cycleMillis = if (lockMode == "SCHEDULE") SCHEDULE_CYCLE_MILLIS else SESSION_CYCLE_MILLIS
                    val elapsed = now - startTimeMillis
                    val cyclePos = elapsed % cycleMillis
                    if (cyclePos >= focusMillis) {
                        isBreakActive = true
                        cycleRemainingMillis = minOf(cycleMillis - cyclePos, totalRemainingMillis)
                    } else {
                        isBreakActive = false
                        val timeUntilNextBreak = focusMillis - cyclePos
                        if (totalRemainingMillis <= timeUntilNextBreak) {
                            cycleRemainingMillis = totalRemainingMillis
                            noMoreBreaks = true
                        } else {
                            cycleRemainingMillis = timeUntilNextBreak
                            noMoreBreaks = false
                        }
                    }
                } else {
                    cycleRemainingMillis = totalRemainingMillis
                    noMoreBreaks = true
                }
            }

            val totalEarned = prefs.getInt("TOTAL_PASSES_EARNED", prefs.getInt("EMERGENCY_PASSES", 0))
            val totalUsed = prefs.getInt("TOTAL_PASSES_USED", 0)
            val emergencyPasses = (totalEarned - totalUsed).coerceIn(0, 15)
            val streakDays = prefs.getInt("STREAK_DAYS", 0).coerceIn(0, 99)
            val totalCompleted = prefs.getInt("TOTAL_COMPLETED_SESSIONS", 0)

            val proExpiresAt = prefs.getLong("PRO_EXPIRES_AT", 0L)
            val isPro = prefs.getBoolean("IS_PRO_USER", false) && proExpiresAt > now
            val proPlanName = prefs.getString("PRO_PLAN_NAME", "") ?: ""

            val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val savedYtDate = prefs.getString("YT_USAGE_DATE", "") ?: ""
            val ytUsedMillis = if (savedYtDate == todayStr) {
                prefs.getLong("YT_USED_MILLIS", 0L)
            } else {
                0L
            }
            val ytStudyUsedMillis = if (savedYtDate == todayStr) {
                prefs.getLong("YT_STUDY_USED_MILLIS", 0L)
            } else {
                0L
            }

            val savedVideosDate = prefs.getString("STUDY_YT_VIDEOS_DATE", "") ?: ""
            val studyVideosJson = if (savedVideosDate == todayStr) {
                prefs.getString("STUDY_YT_VIDEOS_JSON", "[]") ?: "[]"
            } else {
                if (savedVideosDate.isNotEmpty()) {
                    prefs.edit()
                        .putString("STUDY_YT_VIDEOS_JSON", "[]")
                        .putString("STUDY_YT_VIDEOS_DATE", todayStr)
                        .apply()
                }
                "[]"
            }

            val ytUsedSeconds = (ytUsedMillis / 1000L).toInt()
            val ytUsedMinutes = (ytUsedMillis / 60000L).toInt()
            val ytLimitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 30).coerceIn(15, 45)

            val ytStudyUsedSeconds = (ytStudyUsedMillis / 1000L).toInt()
            val ytStudyLimitMinutes = prefs.getInt("YT_STUDY_LIMIT_MINUTES", 210).coerceIn(90, 210)
            val studyChannelsCsv = prefs.getString("STUDY_YT_CHANNELS_CSV", "") ?: ""

            val lastCompletedDate = prefs.getString("LAST_COMPLETED_DATE", "") ?: ""
            val completedHistoryJson = prefs.getString("COMPLETED_HISTORY_JSON", "{}") ?: "{}"

            val map = WritableNativeMap().apply {
                putBoolean("active", active && endTimeMillis > now)
                putDouble("startTimeMillis", startTimeMillis.toDouble())
                putDouble("endTimeMillis", endTimeMillis.toDouble())
                putString("lockMode", lockMode)
                putBoolean("pomodoroEnabled", pomodoroEnabled)
                putBoolean("scheduleBreakEnabled", scheduleBreakEnabled)
                putBoolean("isBreakActive", isBreakActive)
                putBoolean("noMoreBreaks", noMoreBreaks)
                putDouble("cycleRemainingMillis", cycleRemainingMillis.toDouble())
                putInt("emergencyPasses", emergencyPasses)
                putInt("totalPassesEarned", totalEarned)
                putInt("totalPassesUsed", totalUsed)
                putInt("streakDays", streakDays)
                putInt("totalCompleted", totalCompleted)
                putBoolean("isPro", isPro)
                putDouble("proExpiresAt", proExpiresAt.toDouble())
                putString("proPlanName", proPlanName)
                putInt("ytUsedSeconds", ytUsedSeconds)
                putInt("ytUsedMinutes", ytUsedMinutes)
                putInt("ytLimitMinutes", ytLimitMinutes)
                putInt("ytStudyUsedSeconds", ytStudyUsedSeconds)
                putInt("ytStudyLimitMinutes", ytStudyLimitMinutes)
                putString("studyChannelsCsv", studyChannelsCsv)
                putString("studyVideosJson", studyVideosJson)
                putString("ytUsageDate", todayStr)
                putString("lastCompletedDate", lastCompletedDate)
                putString("completedHistoryJson", completedHistoryJson)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun useEmergencyPass(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val totalEarned = prefs.getInt("TOTAL_PASSES_EARNED", prefs.getInt("EMERGENCY_PASSES", 0))
            val totalUsed = prefs.getInt("TOTAL_PASSES_USED", 0)
            val currentPasses = (totalEarned - totalUsed).coerceIn(0, 15)

            if (currentPasses <= 0) {
                promise.resolve(false)
                return
            }

            val nextUsed = totalUsed + 1
            val newPasses = (totalEarned - nextUsed).coerceIn(0, 15)

            prefs.edit()
                .putInt("TOTAL_PASSES_EARNED", totalEarned)
                .putInt("TOTAL_PASSES_USED", nextUsed)
                .putInt("EMERGENCY_PASSES", newPasses)
                .putBoolean("IS_SESSION_ACTIVE", false)
                .remove("SESSION_END_TIME")
                .remove("SESSION_START_TIME")
                .remove("SESSION_START_REALTIME")
                .remove("SESSION_PLANNED_DURATION")
                .commit()

            FocusScheduler.cancelSessionAlarms(reactApplicationContext)
            reactApplicationContext.sendBroadcast(
                Intent(FocusBlockerService.ACTION_STOP_SESSION)
                    .setPackage(reactApplicationContext.packageName)
            )

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("EMERGENCY_PASS_ERROR", e.message)
        }
    }

    @ReactMethod
    fun syncPassAndStreakFromCloud(
        cloudPasses: Int,
        cloudStreakDays: Int,
        cloudLastDate: String,
        cloudEarned: Int,
        cloudUsed: Int,
        cloudHistoryJson: String,
        cloudTotalCompleted: Int,
        cloudYtUsageDate: String,
        cloudYtUsedSeconds: Int,
        cloudYtStudyUsedSeconds: Int,
        cloudProExpiresAt: Double,
        cloudProPlanName: String,
        promise: Promise
    ) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val localEarned = prefs.getInt("TOTAL_PASSES_EARNED", prefs.getInt("EMERGENCY_PASSES", 0))
            val localUsed = prefs.getInt("TOTAL_PASSES_USED", 0)
            val localStreak = prefs.getInt("STREAK_DAYS", 0)
            val localLastDate = prefs.getString("LAST_COMPLETED_DATE", "") ?: ""
            val localHistoryStr = prefs.getString("COMPLETED_HISTORY_JSON", "{}") ?: "{}"
            val localCompleted = prefs.getInt("TOTAL_COMPLETED_SESSIONS", 0)
            val localProExpiry = prefs.getLong("PRO_EXPIRES_AT", 0L)
            val localProPlan = prefs.getString("PRO_PLAN_NAME", "") ?: ""

            val effectiveCloudEarned = if (cloudEarned > 0) cloudEarned else cloudPasses + cloudUsed
            val mergedEarned = maxOf(localEarned, effectiveCloudEarned)
            val mergedUsed = maxOf(localUsed, cloudUsed)
            val mergedPasses = (mergedEarned - mergedUsed).coerceIn(0, 15)

            val mergedLastDate: String
            val mergedStreak: Int
            if (localLastDate >= cloudLastDate && localLastDate.isNotEmpty()) {
                mergedLastDate = localLastDate
                mergedStreak = if (localLastDate == cloudLastDate) maxOf(localStreak, cloudStreakDays) else localStreak
            } else {
                mergedLastDate = cloudLastDate
                mergedStreak = cloudStreakDays
            }

            val mergedProExpiry = maxOf(localProExpiry, cloudProExpiresAt.toLong())
            val mergedProPlan = if (cloudProExpiresAt.toLong() >= localProExpiry && cloudProPlanName.isNotEmpty()) {
                cloudProPlanName
            } else {
                localProPlan
            }
            val isProActiveNow = mergedProExpiry > System.currentTimeMillis()

            val mergedHistory = JSONObject()
            try {
                val localObj = JSONObject(localHistoryStr)
                val keys = localObj.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    mergedHistory.put(k, localObj.optInt(k, 45))
                }
            } catch (_: Exception) {}
            try {
                if (cloudHistoryJson.isNotEmpty()) {
                    val cloudObj = JSONObject(cloudHistoryJson)
                    val keys = cloudObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val cVal = cloudObj.optInt(k, 45)
                        val lVal = mergedHistory.optInt(k, 0)
                        mergedHistory.put(k, maxOf(lVal, cVal))
                    }
                }
            } catch (_: Exception) {}

            val mergedTotalCompleted = maxOf(localCompleted, cloudTotalCompleted, mergedHistory.length())

            val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val localYtDate = prefs.getString("YT_USAGE_DATE", "") ?: ""
            val localYtMillis = if (localYtDate == todayStr) prefs.getLong("YT_USED_MILLIS", 0L) else 0L
            val cloudYtMillis = if (cloudYtUsageDate == todayStr) (cloudYtUsedSeconds.toLong() * 1000L) else 0L
            val mergedYtMillis = maxOf(localYtMillis, cloudYtMillis)

            val localStudyMillis = if (localYtDate == todayStr) prefs.getLong("YT_STUDY_USED_MILLIS", 0L) else 0L
            val cloudStudyMillis = if (cloudYtUsageDate == todayStr) (cloudYtStudyUsedSeconds.toLong() * 1000L) else 0L
            val mergedStudyMillis = maxOf(localStudyMillis, cloudStudyMillis)

            prefs.edit()
                .putInt("TOTAL_PASSES_EARNED", mergedEarned)
                .putInt("TOTAL_PASSES_USED", mergedUsed)
                .putInt("EMERGENCY_PASSES", mergedPasses)
                .putInt("STREAK_DAYS", mergedStreak.coerceIn(0, 98))
                .putInt("TOTAL_COMPLETED_SESSIONS", mergedTotalCompleted)
                .putBoolean("IS_PRO_USER", isProActiveNow)
                .putLong("PRO_EXPIRES_AT", mergedProExpiry)
                .putString("PRO_PLAN_NAME", mergedProPlan)
                .putString("LAST_COMPLETED_DATE", mergedLastDate)
                .putString("COMPLETED_HISTORY_JSON", mergedHistory.toString())
                .putString("YT_USAGE_DATE", todayStr)
                .putLong("YT_USED_MILLIS", mergedYtMillis)
                .putLong("YT_STUDY_USED_MILLIS", mergedStudyMillis)
                .commit()

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SYNC_ERROR", e.message)
        }
    }
}