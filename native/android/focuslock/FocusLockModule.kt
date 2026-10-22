package com.juwel522.myapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.text.TextUtils
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream
import java.util.HashSet

class FocusLockModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val POMODORO_FOCUS_MILLIS = 25 * 60 * 1000L
        private const val POMODORO_BREAK_MILLIS = 5 * 60 * 1000L
        private const val POMODORO_CYCLE_MILLIS = POMODORO_FOCUS_MILLIS + POMODORO_BREAK_MILLIS
    }

    override fun getName(): String {
        return "FocusLock"
    }

    private fun saveAllowedAppsToPrefs(prefs: android.content.SharedPreferences, pkgSet: Set<String>) {
        prefs.edit().remove("ALLOWED_APPS").apply()
        prefs.edit()
            .putStringSet("ALLOWED_APPS", HashSet(pkgSet))
            .putString("ALLOWED_APPS_CSV", pkgSet.joinToString(","))
            .commit()
    }

    private fun saveAllowedDomainsToPrefs(prefs: android.content.SharedPreferences, domainList: List<String>) {
        // Max 5 sites & strictly filter out YouTube domains
        val cleanList = domainList
            .map { it.trim().lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.").trimEnd('/') }
            .filter { it.isNotEmpty() && !it.contains("youtube.") && !it.contains("youtu.be") }
            .distinct()
            .take(5)

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
            val appSet = HashSet<String>()
            val maxApps = minOf(apps.size(), 6)
            for (i in 0 until maxApps) {
                val pkg = apps.getString(i)?.trim()
                if (!pkg.isNullOrEmpty()) appSet.add(pkg)
            }
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
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
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit().putInt("YT_LIMIT_MINUTES", limitMinutes).commit()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    // 🌟 Opens a specific whitelisted website directly inside Google Chrome so old blocked tabs never kick the user out!
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
                .putLong("WHITELIST_GRACE_UNTIL", System.currentTimeMillis() + 2500L)
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
                .putLong("WHITELIST_GRACE_UNTIL", System.currentTimeMillis() + 2500L)
                .putString("ALLOWED_APPS_CSV", updatedSet.joinToString(","))
                .putStringSet("ALLOWED_APPS", HashSet(updatedSet))
                .commit()

            // 🌟 If opening YouTube, immediately start the YouTube timer from second 1!
            if (cleanPkg == "com.google.android.youtube") {
                reactApplicationContext.sendBroadcast(
                    Intent(FocusBlockerService.ACTION_START_YT_TRACKER)
                        .setPackage(reactApplicationContext.packageName)
                )
            }

            // 🌟 If opening Chrome via its app icon, open the first allowed website so an old blocked tab doesn't kick user out!
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
            val pkgSet = HashSet<String>()
            val limit = minOf(allowedPackages.size(), 6)
            for (i in 0 until limit) {
                val pkg = allowedPackages.getString(i)?.trim()
                if (!pkg.isNullOrEmpty()) pkgSet.add(pkg)
            }

            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val nowRealtime = SystemClock.elapsedRealtime()
            val sessionEndTime = now + (durationMinutes * 60 * 1000L)

            saveAllowedAppsToPrefs(prefs, pkgSet)

            prefs.edit().apply {
                putBoolean("IS_SESSION_ACTIVE", true)
                putString("LOCK_MODE", "SESSION")
                putBoolean("POMODORO_ENABLED", pomodoroEnabled)
                putInt("YT_LIMIT_MINUTES", ytLimitMinutes)
                putLong("SESSION_START_TIME", now)
                putLong("SESSION_START_REALTIME", nowRealtime)
                putLong("SESSION_END_TIME", sessionEndTime)
                putLong("SESSION_PLANNED_DURATION", durationMinutes * 60 * 1000L)
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
            if (allowedPackages != null) {
                val pkgSet = HashSet<String>()
                val limit = minOf(allowedPackages.size(), 6)
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
                .putInt("YT_LIMIT_MINUTES", ytLimitMinutes)

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
            val packagesSet = HashSet<String>()
            val limit = minOf(allowedPackages.size(), 6)
            for (i in 0 until limit) {
                val pkg = allowedPackages.getString(i)?.trim()
                if (!pkg.isNullOrEmpty()) packagesSet.add(pkg)
            }

            saveAllowedAppsToPrefs(prefs, packagesSet)

            prefs.edit()
                .putString("MULTI_SCHEDULES_JSON", schedulesJson)
                .putBoolean("SCHEDULE_ENABLED", globalEnabled)
                .putInt("YT_LIMIT_MINUTES", ytLimitMinutes)
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
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val active = prefs.getBoolean("IS_SESSION_ACTIVE", false)
            val startTimeMillis = prefs.getLong("SESSION_START_TIME", 0L)
            val endTimeMillis = prefs.getLong("SESSION_END_TIME", 0L)
            val lockMode = prefs.getString("LOCK_MODE", "SESSION") ?: "SESSION"
            val pomodoroEnabled = prefs.getBoolean("POMODORO_ENABLED", true)

            var isBreakActive = false
            var cycleRemainingMillis = 0L

            if (active && endTimeMillis > now) {
                if (lockMode == "SESSION" && pomodoroEnabled && startTimeMillis > 0L && now > startTimeMillis) {
                    val elapsed = now - startTimeMillis
                    val cyclePos = elapsed % POMODORO_CYCLE_MILLIS
                    if (cyclePos >= POMODORO_FOCUS_MILLIS) {
                        isBreakActive = true
                        cycleRemainingMillis = POMODORO_CYCLE_MILLIS - cyclePos
                    } else {
                        isBreakActive = false
                        cycleRemainingMillis = POMODORO_FOCUS_MILLIS - cyclePos
                    }
                } else {
                    cycleRemainingMillis = endTimeMillis - now
                }
            }

            val totalEarned = prefs.getInt("TOTAL_PASSES_EARNED", prefs.getInt("EMERGENCY_PASSES", 0))
            val totalUsed = prefs.getInt("TOTAL_PASSES_USED", 0)
            val emergencyPasses = (totalEarned - totalUsed).coerceIn(0, 5)
            val streakDays = prefs.getInt("STREAK_DAYS", 0).coerceIn(0, 3)
            val totalCompleted = prefs.getInt("TOTAL_COMPLETED_SESSIONS", 0)

            val ytUsedMillis = prefs.getLong("YT_USED_MILLIS", 0L)
            val ytUsedSeconds = (ytUsedMillis / 1000L).toInt()
            val ytUsedMinutes = (ytUsedMillis / 60000L).toInt()
            val ytLimitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 90)
            val lastCompletedDate = prefs.getString("LAST_COMPLETED_DATE", "") ?: ""

            val map = WritableNativeMap().apply {
                putBoolean("active", active && endTimeMillis > now)
                putDouble("startTimeMillis", startTimeMillis.toDouble())
                putDouble("endTimeMillis", endTimeMillis.toDouble())
                putString("lockMode", lockMode)
                putBoolean("pomodoroEnabled", pomodoroEnabled)
                putBoolean("isBreakActive", isBreakActive)
                putDouble("cycleRemainingMillis", cycleRemainingMillis.toDouble())
                putInt("emergencyPasses", emergencyPasses)
                putInt("totalPassesEarned", totalEarned)
                putInt("totalPassesUsed", totalUsed)
                putInt("streakDays", streakDays)
                putInt("totalCompleted", totalCompleted)
                putInt("ytUsedSeconds", ytUsedSeconds)
                putInt("ytUsedMinutes", ytUsedMinutes)
                putInt("ytLimitMinutes", ytLimitMinutes)
                putString("lastCompletedDate", lastCompletedDate)
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
            val currentPasses = (totalEarned - totalUsed).coerceIn(0, 5)

            if (currentPasses <= 0) {
                promise.resolve(false)
                return
            }

            val nextUsed = totalUsed + 1
            val newPasses = (totalEarned - nextUsed).coerceIn(0, 5)

            prefs.edit()
                .putInt("TOTAL_PASSES_EARNED", totalEarned)
                .putInt("TOTAL_PASSES_USED", nextUsed)
                .putInt("EMERGENCY_PASSES", newPasses)
                .putInt("STREAK_DAYS", 0)
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

    // 🌟 Anti-Cheat Cloud Merge: Never overwrites newer local pass/streak with stale cloud values!
    @ReactMethod
    fun syncPassAndStreakFromCloud(
        cloudPasses: Int,
        cloudStreakDays: Int,
        cloudLastDate: String,
        cloudEarned: Int,
        cloudUsed: Int,
        promise: Promise
    ) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val localEarned = prefs.getInt("TOTAL_PASSES_EARNED", prefs.getInt("EMERGENCY_PASSES", 0))
            val localUsed = prefs.getInt("TOTAL_PASSES_USED", 0)
            val localStreak = prefs.getInt("STREAK_DAYS", 0)
            val localLastDate = prefs.getString("LAST_COMPLETED_DATE", "") ?: ""

            // Merge Earned & Used monotonically (highest wins so earned passes are never lost and spent passes never come back!)
            val effectiveCloudEarned = if (cloudEarned > 0) cloudEarned else cloudPasses + cloudUsed
            val mergedEarned = maxOf(localEarned, effectiveCloudEarned)
            val mergedUsed = maxOf(localUsed, cloudUsed)
            val mergedPasses = (mergedEarned - mergedUsed).coerceIn(0, 5)

            // Keep whichever streak belongs to the more recent date
            val mergedLastDate: String
            val mergedStreak: Int
            if (localLastDate >= cloudLastDate && localLastDate.isNotEmpty()) {
                mergedLastDate = localLastDate
                mergedStreak = if (localLastDate == cloudLastDate) maxOf(localStreak, cloudStreakDays) else localStreak
            } else {
                mergedLastDate = cloudLastDate
                mergedStreak = cloudStreakDays
            }

            prefs.edit()
                .putInt("TOTAL_PASSES_EARNED", mergedEarned)
                .putInt("TOTAL_PASSES_USED", mergedUsed)
                .putInt("EMERGENCY_PASSES", mergedPasses)
                .putInt("STREAK_DAYS", mergedStreak.coerceIn(0, 2))
                .putString("LAST_COMPLETED_DATE", mergedLastDate)
                .commit()

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SYNC_ERROR", e.message)
        }
    }
}