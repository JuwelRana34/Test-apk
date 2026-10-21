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

    // =========================================================================
    // 1. PERMISSION CHECKS & SETTINGS INTENTS (Accessibility, Overlay, Admin, Battery)
    // =========================================================================

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

    // =========================================================================
    // 2. INSTALLED APPS & WHITELIST CONFIGURATION (MAX 6 APPS + CHROME DOMAINS)
    // =========================================================================

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
                val pkg = apps.getString(i)
                if (pkg != null) appSet.add(pkg)
            }
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit().putStringSet("ALLOWED_APPS", appSet).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun saveAllowedDomains(domains: ReadableArray, promise: Promise) {
        try {
            val domainSet = HashSet<String>()
            for (i in 0 until domains.size()) {
                val d = domains.getString(i)?.trim()?.lowercase()
                if (!d.isNullOrEmpty()) domainSet.add(d)
            }
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit().putStringSet("ALLOWED_DOMAINS", domainSet).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setYouTubeLimitMinutes(limitMinutes: Int, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit().putInt("YT_LIMIT_MINUTES", limitMinutes).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun openApp(packageName: String, promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val intent = pm.getLaunchIntentForPackage(packageName)
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

    // =========================================================================
    // 3. SESSION LOCK (25m FOCUS + 5m BREAK) & SCHEDULE LOCK
    // =========================================================================

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
                val pkg = allowedPackages.getString(i)
                if (pkg != null) pkgSet.add(pkg)
            }

            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            val sessionEndTime = now + (durationMinutes * 60 * 1000L)

            prefs.edit().apply {
                putBoolean("IS_SESSION_ACTIVE", true)
                putString("LOCK_MODE", "SESSION")
                putBoolean("POMODORO_ENABLED", pomodoroEnabled)
                putStringSet("ALLOWED_APPS", pkgSet)
                putInt("YT_LIMIT_MINUTES", ytLimitMinutes)
                putLong("SESSION_START_TIME", now)
                putLong("SESSION_END_TIME", sessionEndTime)
            }.apply()

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
            val editor = prefs.edit()
                .putInt("START_HOUR", startHour)
                .putInt("START_MINUTE", startMinute)
                .putInt("END_HOUR", endHour)
                .putInt("END_MINUTE", endMinute)
                .putBoolean("IS_FOCUS_ENABLED", enabled)
                .putInt("YT_LIMIT_MINUTES", ytLimitMinutes)

            if (allowedPackages != null) {
                val pkgSet = HashSet<String>()
                val limit = minOf(allowedPackages.size(), 6)
                for (i in 0 until limit) {
                    val pkg = allowedPackages.getString(i)
                    if (pkg != null) pkgSet.add(pkg)
                }
                editor.putStringSet("ALLOWED_APPS", pkgSet)
            }

            if (activeDays != null) {
                val daySet = HashSet<String>()
                for (i in 0 until activeDays.size()) {
                    daySet.add(activeDays.getInt(i).toString())
                }
                editor.putStringSet("ACTIVE_DAYS", daySet)
            }

            editor.apply()
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
            val packagesSet = mutableSetOf<String>()
            val limit = minOf(allowedPackages.size(), 6)
            for (i in 0 until limit) {
                allowedPackages.getString(i)?.let { packagesSet.add(it) }
            }

            prefs.edit()
                .putString("MULTI_SCHEDULES_JSON", schedulesJson)
                .putBoolean("SCHEDULE_ENABLED", globalEnabled)
                .putStringSet("ALLOWED_APPS", packagesSet)
                .putInt("YT_LIMIT_MINUTES", ytLimitMinutes)
                .apply()

            FocusScheduler.scheduleAlarms(reactApplicationContext)
            promise.resolve("Advanced schedules saved successfully")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    // =========================================================================
    // 4. STATE SYNC & EARNED EMERGENCY PASS SYSTEM (0 TO 5 PASSES, 3-DAY STREAK)
    // =========================================================================

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

            val emergencyPasses = prefs.getInt("EMERGENCY_PASSES", 0).coerceIn(0, 5)
            val streakDays = prefs.getInt("STREAK_DAYS", 0).coerceIn(0, 3)
            val totalCompleted = prefs.getInt("TOTAL_COMPLETED_SESSIONS", 0)
            val ytUsedMinutes = (prefs.getLong("YT_USED_MILLIS", 0L) / 60000L).toInt()
            val ytLimitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 90)

            val map = WritableNativeMap().apply {
                putBoolean("active", active && endTimeMillis > now)
                putDouble("startTimeMillis", startTimeMillis.toDouble())
                putDouble("endTimeMillis", endTimeMillis.toDouble())
                putString("lockMode", lockMode)
                putBoolean("pomodoroEnabled", pomodoroEnabled)
                putBoolean("isBreakActive", isBreakActive)
                putDouble("cycleRemainingMillis", cycleRemainingMillis.toDouble())
                putInt("emergencyPasses", emergencyPasses)
                putInt("streakDays", streakDays)
                putInt("totalCompleted", totalCompleted)
                putInt("ytUsedMinutes", ytUsedMinutes)
                putInt("ytLimitMinutes", ytLimitMinutes)
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
            val currentPasses = prefs.getInt("EMERGENCY_PASSES", 0).coerceIn(0, 5)

            if (currentPasses <= 0) {
                promise.resolve(false)
                return
            }

            val newPasses = (currentPasses - 1).coerceAtLeast(0)
            prefs.edit()
                .putInt("EMERGENCY_PASSES", newPasses)
                .putInt("STREAK_DAYS", 0) // Reset 3-day progress toward next pass when breaking lock
                .putBoolean("IS_SESSION_ACTIVE", false)
                .remove("SESSION_END_TIME")
                .remove("SESSION_START_TIME")
                .apply()

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
    fun syncPassAndStreakFromCloud(passes: Int, streakDays: Int, lastDate: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
            prefs.edit()
                .putInt("EMERGENCY_PASSES", passes.coerceIn(0, 5))
                .putInt("STREAK_DAYS", streakDays.coerceIn(0, 2))
                .putString("LAST_COMPLETED_DATE", lastDate)
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SYNC_ERROR", e.message)
        }
    }
}