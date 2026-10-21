package com.juwel522.myapp

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class FocusBlockerService : AccessibilityService() {
    companion object {
        const val ACTION_STOP_SESSION = "com.juwel522.myapp.STOP_FOCUS_SESSION"
        const val ACTION_REDIRECT_MAIN_APP = "com.juwel522.myapp.REDIRECT_MAIN_APP"
        const val ACTION_SYNC_STATE = "com.juwel522.myapp.SYNC_FOCUS_STATE"
        private const val CHANNEL_ID = "focus_mode"
        private const val NOTIFICATION_ID = 522

        // Pomodoro cycle: 25 minutes strict lock + 5 minutes break = 30 minutes
        private const val POMODORO_FOCUS_MILLIS = 25 * 60 * 1000L
        private const val POMODORO_BREAK_MILLIS = 5 * 60 * 1000L
        private const val POMODORO_CYCLE_MILLIS = POMODORO_FOCUS_MILLIS + POMODORO_BREAK_MILLIS
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ytHandler = Handler(Looper.getMainLooper())
    private val sessionTickHandler = Handler(Looper.getMainLooper())

    private var isYtForeground = false
    private var lastRedirectAt = 0L
    private var lastToastAt = 0L
    private var foregroundStarted = false
    private var wasInBreakPhase = false
    private var breakWarningShownForCycle = -1L

    private var anchorOverlayView: View? = null
    private var windowManager: WindowManager? = null

    private val sessionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_STOP_SESSION -> stopFocusSession(completedNaturally = false)
                ACTION_REDIRECT_MAIN_APP -> {
                    ensureAnchorOverlay()
                    ensureForegroundNotification()
                    startSessionTicker()
                    redirectToMainActivity(force = true)
                }
                ACTION_SYNC_STATE -> {
                    ensureForegroundNotification()
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
        ensureForegroundNotification()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        val filter = IntentFilter().apply {
            addAction(ACTION_STOP_SESSION)
            addAction(ACTION_REDIRECT_MAIN_APP)
            addAction(ACTION_SYNC_STATE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(sessionReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(sessionReceiver, filter)
        }

        val prefs = getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("IS_SESSION_ACTIVE", false)) {
            ensureAnchorOverlay()
            startSessionTicker()
        }
    }

    // Reads allowed apps reliably from both CSV and StringSet so SharedPreferences caching never fails
    private fun getAllowedAppsSet(prefs: android.content.SharedPreferences): Set<String> {
        val result = HashSet<String>()
        val csv = prefs.getString("ALLOWED_APPS_CSV", "") ?: ""
        if (csv.isNotEmpty()) {
            csv.split(",").forEach { item ->
                val clean = item.trim()
                if (clean.isNotEmpty()) result.add(clean)
            }
        }
        val setVal = prefs.getStringSet("ALLOWED_APPS", null)
        if (setVal != null) {
            result.addAll(setVal)
        }
        return result
    }

    private fun ensureAnchorOverlay() {
        if (anchorOverlayView != null) return
        try {
            val view = View(this).apply {
                setBackgroundColor(Color.TRANSPARENT)
            }
            val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
            }
            val params = WindowManager.LayoutParams(
                1,
                1,
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = 0
                y = 0
            }
            windowManager?.addView(view, params)
            anchorOverlayView = view
        } catch (_: Exception) {}
    }

    private fun removeAnchorOverlay() {
        val view = anchorOverlayView ?: return
        try {
            windowManager?.removeView(view)
        } catch (_: Exception) {}
        anchorOverlayView = null
    }

    private fun isCurrentlyInBreakPhase(prefs: android.content.SharedPreferences, now: Long): Boolean {
        val lockMode = prefs.getString("LOCK_MODE", "SESSION") ?: "SESSION"
        val pomodoroEnabled = prefs.getBoolean("POMODORO_ENABLED", true)
        if (lockMode != "SESSION" || !pomodoroEnabled) return false

        val startTime = prefs.getLong("SESSION_START_TIME", 0L)
        if (startTime <= 0L || now <= startTime) return false

        val elapsed = now - startTime
        val cyclePos = elapsed % POMODORO_CYCLE_MILLIS
        return cyclePos >= POMODORO_FOCUS_MILLIS
    }

    private fun startSessionTicker() {
        sessionTickHandler.removeCallbacksAndMessages(null)
        sessionTickHandler.post(object : Runnable {
            override fun run() {
                val prefs = getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
                val active = prefs.getBoolean("IS_SESSION_ACTIVE", false)
                val endTime = prefs.getLong("SESSION_END_TIME", 0L)
                val now = System.currentTimeMillis()

                if (!active) {
                    removeAnchorOverlay()
                    return
                }

                if (endTime in 1..now) {
                    stopFocusSession(completedNaturally = true)
                    return
                }

                val inBreak = isCurrentlyInBreakPhase(prefs, now)
                if (inBreak) {
                    val startTime = prefs.getLong("SESSION_START_TIME", 0L)
                    val elapsed = now - startTime
                    val currentCycleIndex = elapsed / POMODORO_CYCLE_MILLIS
                    val cyclePos = elapsed % POMODORO_CYCLE_MILLIS
                    val remainingBreakMillis = POMODORO_CYCLE_MILLIS - cyclePos

                    if (remainingBreakMillis in 1..30000L && breakWarningShownForCycle != currentCycleIndex) {
                        breakWarningShownForCycle = currentCycleIndex
                        Toast.makeText(
                            applicationContext,
                            "⏳ আর ৩০ সেকেন্ড পর আবার ২৫ মিনিটের ফোকাস লক শুরু হবে!",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                    wasInBreakPhase = true
                } else if (wasInBreakPhase) {
                    wasInBreakPhase = false
                    ensureForegroundNotification()
                    val currentPkg = rootInActiveWindow?.packageName?.toString() ?: ""
                    val allowedApps = getAllowedAppsSet(prefs)
                    if (currentPkg.isNotEmpty() &&
                        currentPkg != applicationContext.packageName &&
                        !allowedApps.contains(currentPkg)
                    ) {
                        Toast.makeText(
                            applicationContext,
                            "🔒 ৫ মিনিটের ব্রেক শেষ! আবার ২৫ মিনিটের ফোকাস লক শুরু হয়েছে।",
                            Toast.LENGTH_SHORT
                        ).show()
                        redirectToMainActivity(force = true)
                    }
                }

                sessionTickHandler.postDelayed(this, 1000L)
            }
        })
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val eventType = event?.eventType ?: return
        val prefs = getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val sessionActive = prefs.getBoolean("IS_SESSION_ACTIVE", false)
        if (!sessionActive) return

        val sessionEnd = prefs.getLong("SESSION_END_TIME", 0L)
        val now = System.currentTimeMillis()

        if (sessionEnd in 1..now) {
            stopFocusSession(completedNaturally = true)
            return
        }

        ensureAnchorOverlay()

        val rootNode = rootInActiveWindow
        val rootPackageName = rootNode?.packageName?.toString()
        val eventPackageName = event.packageName?.toString()

        // 🌟 FIX: Status bar (com.android.systemui) fires TYPE_WINDOW_CONTENT_CHANGED every second
        // for network speed (KB/s) and clock seconds! Ignore systemui unless user actually opened Recents/Overview!
        if (eventPackageName == "com.android.systemui") {
            val className = event.className?.toString()?.lowercase() ?: ""
            val isRecentsOpened = eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
                (className.contains("recents") ||
                    className.contains("overview") ||
                    className.contains(" panel") ||
                    className.contains("quicksettings"))
            if (!isRecentsOpened) {
                return
            }
        }

        // Determine actual foreground package: prefer rootPackageName (the real active app window)
        val packageName = rootPackageName ?: eventPackageName ?: return

        val ownPackage = applicationContext.packageName
        if (packageName == ownPackage) {
            stopYouTubeTracker()
            return
        }

        // Ignore keyboards, input methods, and system permission dialogs
        val lowerPkg = packageName.lowercase()
        if (lowerPkg.contains("inputmethod") ||
            lowerPkg.contains("keyboard") ||
            lowerPkg.contains("honeyboard") ||
            lowerPkg.contains("gboard") ||
            lowerPkg.contains("ridmik") ||
            lowerPkg.contains("permissioncontroller") ||
            lowerPkg.contains("packageinstaller")
        ) {
            return
        }

        // Check if we are in the 5-minute Pomodoro Break Phase
        if (isCurrentlyInBreakPhase(prefs, now)) {
            stopYouTubeTracker()
            if (packageName == "com.android.settings" && rootNode != null && isTamperingWithSettings(rootNode)) {
                performGlobalAction(GLOBAL_ACTION_BACK)
                redirectToMainActivity(force = true)
            }
            return
        }

        val allowedApps = getAllowedAppsSet(prefs)

        // 🌟 FIX: If user just tapped a whitelisted app inside our Lock Screen, allow smooth transition!
        val lastLaunchedApp = prefs.getString("LAST_LAUNCHED_ALLOWED_APP", "") ?: ""
        val graceUntil = prefs.getLong("WHITELIST_GRACE_UNTIL", 0L)
        if (now < graceUntil && lastLaunchedApp.isNotEmpty()) {
            if (packageName == lastLaunchedApp || eventPackageName == lastLaunchedApp) {
                return
            }
            // Also ignore intermediate launcher frame during app-open animation
            if (lowerPkg.contains("launcher") || lowerPkg.contains("systemui")) {
                return
            }
        }

        // 🌟 WHITELISTED APPS HANDLING (NEVER kick user back to Lock Screen when using an allowed app!)
        val isAllowedApp = allowedApps.contains(packageName) ||
            (eventPackageName != null && allowedApps.contains(eventPackageName))

        if (isAllowedApp) {
            val activeAllowedPkg = if (allowedApps.contains(packageName)) packageName else eventPackageName!!

            // 1. YouTube Long Video Quota & Shorts Blocker
            if (activeAllowedPkg == "com.google.android.youtube") {
                resetDailyYouTubeQuotaIfNeeded(prefs)
                val usedMillis = prefs.getLong("YT_USED_MILLIS", 0L)
                val limitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 90)
                val limitMillis = limitMinutes * 60 * 1000L

                if (usedMillis >= limitMillis) {
                    stopYouTubeTracker()
                    showThrottledToast("⏳ আজকের YouTube লং ভিডিওর সময়সীমা ($limitMinutes মিনিট) শেষ!")
                    redirectToMainActivity(force = true)
                    return
                }

                var currentParent = event.source
                var caughtShorts = false
                while (currentParent != null) {
                    if (isShortsNode(currentParent)) {
                        caughtShorts = true
                        break
                    }
                    currentParent = currentParent.parent
                }

                if (caughtShorts || (rootNode != null && containsShortsContent(rootNode))) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    showThrottledToast("🚫 Focus Mode চলাকালীন YouTube Shorts ব্লক করা আছে!")
                    return
                }

                startYouTubeTracker(prefs)
                return
            }

            // 2. Chrome & Browser Allowed Websites Filter
            if (activeAllowedPkg == "com.android.chrome" ||
                activeAllowedPkg == "com.brave.browser" ||
                activeAllowedPkg == "com.sec.android.app.sbrowser"
            ) {
                stopYouTubeTracker()
                val allowedDomains = prefs.getStringSet("ALLOWED_DOMAINS", emptySet()) ?: emptySet()
                if (allowedDomains.isNotEmpty() && rootNode != null) {
                    checkBrowserUrlAndBlock(rootNode, activeAllowedPkg, allowedDomains)
                }
                return
            }

            // 3. Instagram / Facebook Reels Blocker (if whitelisted)
            if (activeAllowedPkg == "com.instagram.android" || activeAllowedPkg == "com.facebook.katana") {
                stopYouTubeTracker()
                if (rootNode != null && containsShortsContent(rootNode)) {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    showThrottledToast("🚫 Focus Mode চলাকালীন Reels ব্লক করা আছে!")
                }
                return
            }

            // 4. All other whitelisted apps: let them run 100% freely!
            stopYouTubeTracker()
            return
        }

        // =====================================================================
        // NON-WHITELISTED APP OR HOME LAUNCHER OR RECENTS
        // Only trigger redirect on actual window state transitions so background
        // system events never falsely pull the user out of a whitelisted app!
        // =====================================================================
        val isWindowTransition = eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED
        if (!isWindowTransition) return

        // Double-check rootInActiveWindow: if the foreground window is still an allowed app or our app, do NOT redirect!
        if (rootPackageName != null && (rootPackageName == ownPackage || allowedApps.contains(rootPackageName))) {
            return
        }

        stopYouTubeTracker()

        val className = event.className?.toString()?.lowercase() ?: ""
        if (lowerPkg.contains("systemui") ||
            lowerPkg.contains("recents") ||
            lowerPkg.contains("overview") ||
            className.contains("recents")
        ) {
            performGlobalAction(GLOBAL_ACTION_BACK)
        }

        redirectToMainActivity(force = false)
    }

    private fun checkBrowserUrlAndBlock(
        rootNode: AccessibilityNodeInfo,
        packageName: String,
        allowedDomains: Set<String>
    ) {
        val possibleUrlIds = listOf(
            "$packageName:id/url_bar",
            "com.android.chrome:id/url_bar",
            "$packageName:id/location_bar_edit_text"
        )

        var urlBarNode: AccessibilityNodeInfo? = null
        for (id in possibleUrlIds) {
            val nodes = rootNode.findAccessibilityNodeInfosByViewId(id)
            if (!nodes.isNullOrEmpty()) {
                urlBarNode = nodes[0]
                break
            }
        }

        val urlBar = urlBarNode ?: return
        if (urlBar.isFocused) return

        val rawText = urlBar.text?.toString()?.trim()?.lowercase() ?: return
        if (rawText.isEmpty() ||
            rawText.contains("search or type") ||
            rawText.contains("newtab") ||
            rawText == "about:blank" ||
            rawText == "google.com" ||
            rawText.startsWith("www.google.com/search")
        ) {
            return
        }

        val isAllowed = allowedDomains.any { domain ->
            val cleanDomain = domain.trim().lowercase()
                .removePrefix("https://")
                .removePrefix("http://")
                .removePrefix("www.")
                .trimEnd('/')
            cleanDomain.isNotEmpty() && rawText.contains(cleanDomain)
        }

        if (!isAllowed) {
            performGlobalAction(GLOBAL_ACTION_BACK)
            showThrottledToast("🚫 Chrome-এ শুধুমাত্র আপনার সিলেক্ট করা ওয়েবসাইট চালানো যাবে!")
        }
    }

    private fun isTamperingWithSettings(rootNode: AccessibilityNodeInfo): Boolean {
        val textMatches = rootNode.findAccessibilityNodeInfosByText("Jnuits")
        if (!textMatches.isNullOrEmpty()) return true
        return false
    }

    private fun showThrottledToast(message: String) {
        val now = System.currentTimeMillis()
        if (now - lastToastAt < 2500L) return
        lastToastAt = now
        mainHandler.post {
            Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
        }
    }

    private fun redirectToMainActivity(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && now - lastRedirectAt < 250L) return
        lastRedirectAt = now

        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            putExtra("FROM_FOCUS_LOCK", true)
        }

        try {
            startActivity(intent)
        } catch (_: Exception) {
            try {
                val pendingIntent = PendingIntent.getActivity(
                    this,
                    999,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                pendingIntent.send()
            } catch (_: Exception) {}
        }
    }

    private fun resetDailyYouTubeQuotaIfNeeded(prefs: android.content.SharedPreferences) {
        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val savedDate = prefs.getString("YT_USAGE_DATE", "") ?: ""
        if (savedDate != todayStr) {
            prefs.edit()
                .putString("YT_USAGE_DATE", todayStr)
                .putLong("YT_USED_MILLIS", 0L)
                .apply()
        }
    }

    private fun startYouTubeTracker(prefs: android.content.SharedPreferences) {
        if (isYtForeground) return
        isYtForeground = true
        ytHandler.post(object : Runnable {
            override fun run() {
                if (!isYtForeground) return
                resetDailyYouTubeQuotaIfNeeded(prefs)
                val usedMillis = prefs.getLong("YT_USED_MILLIS", 0L) + 1000L
                prefs.edit().putLong("YT_USED_MILLIS", usedMillis).apply()
                val limitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 90)
                val limitMillis = limitMinutes * 60 * 1000L
                if (usedMillis >= limitMillis) {
                    stopYouTubeTracker()
                    showThrottledToast("⏳ আজকের YouTube লং ভিডিওর সময়সীমা শেষ!")
                    redirectToMainActivity(force = true)
                    return
                }
                ytHandler.postDelayed(this, 1000L)
            }
        })
    }

    private fun stopYouTubeTracker() {
        isYtForeground = false
        ytHandler.removeCallbacksAndMessages(null)
    }

    private fun stopFocusSession(completedNaturally: Boolean) {
        mainHandler.removeCallbacksAndMessages(null)
        sessionTickHandler.removeCallbacksAndMessages(null)
        stopYouTubeTracker()
        removeAnchorOverlay()

        val prefs = getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val wasActive = prefs.getBoolean("IS_SESSION_ACTIVE", false)
        val startTime = prefs.getLong("SESSION_START_TIME", 0L)
        val plannedDuration = prefs.getLong("SESSION_PLANNED_DURATION", 0L)
        val now = System.currentTimeMillis()
        val actualElapsed = if (startTime > 0L) (now - startTime) else plannedDuration
        val completedDuration = if (plannedDuration > 0L) minOf(plannedDuration, actualElapsed) else actualElapsed

        prefs.edit()
            .putBoolean("IS_SESSION_ACTIVE", false)
            .remove("SESSION_END_TIME")
            .remove("SESSION_START_TIME")
            .remove("SESSION_PLANNED_DURATION")
            .commit()

        if (completedNaturally && wasActive) {
            FocusScheduler.recordSuccessfulLockDay(this, completedDuration)
        }

        FocusScheduler.cancelSessionAlarms(this)

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, buildNotification())
        stopForeground(STOP_FOREGROUND_REMOVE)
        foregroundStarted = false
    }

    private fun isShortsNode(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false
        val viewId = node.viewIdResourceName?.lowercase() ?: ""
        val desc = node.contentDescription?.toString()?.lowercase() ?: ""
        val text = node.text?.toString()?.lowercase() ?: ""

        if (node.isSelected && (desc == "shorts" || text == "shorts" || desc == "reels" || text == "reels")) {
            return true
        }

        if (viewId.contains("reel_watch") ||
            viewId.contains("reel_player") ||
            viewId.contains("reel_playback") ||
            viewId.contains("reel_recycler") ||
            viewId.contains("shorts_player") ||
            viewId.contains("short_video") ||
            viewId.contains("reel_viewer") ||
            viewId.contains("clips_viewer_view_pager")
        ) {
            return true
        }
        return false
    }

    private fun containsShortsContent(node: AccessibilityNodeInfo?): Boolean {
        if (node == null || !node.isVisibleToUser) return false
        if (isShortsNode(node)) return true
        for (index in 0 until node.childCount) {
            if (containsShortsContent(node.getChild(index))) return true
        }
        return false
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Focus Mode", NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    private fun buildNotification(): Notification {
        val prefs = getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val endTime = prefs.getLong("SESSION_END_TIME", 0L)
        val isActive = prefs.getBoolean("IS_SESSION_ACTIVE", false)
        val lockMode = prefs.getString("LOCK_MODE", "SESSION") ?: "SESSION"

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationCompat.Builder(this, CHANNEL_ID)
        } else {
            NotificationCompat.Builder(this)
        }

        builder.setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)

        if (isActive && endTime > System.currentTimeMillis()) {
            val modeTitle = if (lockMode == "SCHEDULE") {
                "Schedule Lock Active 🔒"
            } else {
                "Session Lock (25m/5m) Active 🛡️"
            }
            builder.setContentTitle(modeTitle)
            builder.setContentText("Only whitelisted apps & sites are allowed.")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                builder.setUsesChronometer(true)
                builder.setChronometerCountDown(true)
                builder.setWhen(endTime)
            }
        } else {
            builder.setContentTitle("Focus Mode")
            builder.setContentText("Ready for your next deep work session.")
            builder.setUsesChronometer(false)
        }

        return builder.build()
    }

    private fun ensureForegroundNotification() {
        if (!foregroundStarted) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(
                        NOTIFICATION_ID,
                        buildNotification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                    )
                } else {
                    startForeground(NOTIFICATION_ID, buildNotification())
                }
                foregroundStarted = true
            } catch (_: Exception) {}
        } else {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.notify(NOTIFICATION_ID, buildNotification())
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        sessionTickHandler.removeCallbacksAndMessages(null)
        stopYouTubeTracker()
        removeAnchorOverlay()
        try {
            unregisterReceiver(sessionReceiver)
        } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}