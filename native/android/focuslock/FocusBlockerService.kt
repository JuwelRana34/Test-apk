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
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class FocusBlockerService : AccessibilityService() {
    companion object {
        const val ACTION_STOP_SESSION = "com.juwel522.myapp.STOP_FOCUS_SESSION"
        const val ACTION_REDIRECT_MAIN_APP = "com.juwel522.myapp.REDIRECT_MAIN_APP"
        const val ACTION_SYNC_STATE = "com.juwel522.myapp.SYNC_FOCUS_STATE"
        const val ACTION_START_YT_TRACKER = "com.juwel522.myapp.START_YT_TRACKER"
        private const val CHANNEL_ID = "focus_mode"
        private const val NOTIFICATION_ID = 522

        // Session Lock Cycle: 25m Focus + 5m Break = 30m
        private const val SESSION_FOCUS_MILLIS = 25 * 60 * 1000L
        private const val SESSION_BREAK_MILLIS = 5 * 60 * 1000L
        private const val SESSION_CYCLE_MILLIS = SESSION_FOCUS_MILLIS + SESSION_BREAK_MILLIS

        // Schedule Lock Cycle: 50m Focus + 10m Break = 60m
        private const val SCHEDULE_FOCUS_MILLIS = 50 * 60 * 1000L
        private const val SCHEDULE_BREAK_MILLIS = 10 * 60 * 1000L
        private const val SCHEDULE_CYCLE_MILLIS = SCHEDULE_FOCUS_MILLIS + SCHEDULE_BREAK_MILLIS
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ytHandler = Handler(Looper.getMainLooper())
    private val sessionTickHandler = Handler(Looper.getMainLooper())
    private val bannerHandler = Handler(Looper.getMainLooper())

    private var isYtForeground = false
    private var lastYtTickRealtime = 0L
    private var lastRedirectAt = 0L
    private var lastBannerAt = 0L
    private var foregroundStarted = false
    private var wasInBreakPhase = false
    private var breakWarningShownForCycle = -1L

    private var anchorOverlayView: View? = null
    private var instantBannerView: TextView? = null
    private var windowManager: WindowManager? = null
    private var cachedNewsPlusPackages: Set<String>? = null

    private val hideBannerRunnable = Runnable {
        removeInstantBanner()
    }

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
                ACTION_START_YT_TRACKER -> {
                    val prefs = getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
                    if (prefs.getBoolean("IS_SESSION_ACTIVE", false)) {
                        startYouTubeTracker(prefs)
                    }
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
            addAction(ACTION_START_YT_TRACKER)
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

    // Discovers News Plus & Drive PDF Viewer packages on Realme/Android
    private fun getPdfReaderPackages(): Set<String> {
        cachedNewsPlusPackages?.let { if (it.isNotEmpty()) return it }
        val result = HashSet<String>()
        result.add("com.google.android.apps.docs") // Google Drive PDF Viewer
        try {
            val pm = packageManager
            val packages = pm.getInstalledPackages(PackageManager.GET_META_DATA)
            for (pkg in packages) {
                val appInfo = pkg.applicationInfo ?: continue
                val label = pm.getApplicationLabel(appInfo).toString().lowercase()
                val pkgName = pkg.packageName.lowercase()
                if (label.contains("news plus") ||
                    label.contains("newsplus") ||
                    pkgName.contains("newsplus") ||
                    (label.contains("pdf") && label.contains("viewer"))
                ) {
                    result.add(pkg.packageName)
                }
            }
        } catch (_: Exception) {}
        cachedNewsPlusPackages = result
        return result
    }

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

    private fun getAllowedDomainsSet(prefs: android.content.SharedPreferences): Set<String> {
        val result = LinkedHashSet<String>()
        val csv = prefs.getString("ALLOWED_DOMAINS_CSV", "") ?: ""
        if (csv.isNotEmpty()) {
            csv.split(",").forEach { item ->
                val clean = item.trim().lowercase()
                if (clean.isNotEmpty() && !clean.contains("youtube.") && !clean.contains("youtu.be")) {
                    result.add(clean)
                }
            }
        }
        val setVal = prefs.getStringSet("ALLOWED_DOMAINS", null)
        if (setVal != null) {
            setVal.forEach { d ->
                val clean = d.trim().lowercase()
                if (clean.isNotEmpty() && !clean.contains("youtube.") && !clean.contains("youtu.be")) {
                    result.add(clean)
                }
            }
        }
        return result
    }

    private fun showInstantAlert(message: String) {
        val now = System.currentTimeMillis()
        if (now - lastBannerAt < 900L) return
        lastBannerAt = now

        triggerShortHaptic()

        mainHandler.post {
            try {
                bannerHandler.removeCallbacks(hideBannerRunnable)
                removeInstantBanner()

                val tv = TextView(this).apply {
                    text = message
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                    gravity = Gravity.CENTER
                    setPadding(44, 26, 44, 26)
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.RECTANGLE
                        cornerRadius = 48f
                        setColor(Color.parseColor("#E61E293B"))
                        setStroke(3, Color.parseColor("#F43F5E"))
                    }
                }

                val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
                } else {
                    @Suppress("DEPRECATION")
                    WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
                }

                val params = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    layoutType,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                    y = 180
                }

                windowManager?.addView(tv, params)
                instantBannerView = tv
                bannerHandler.postDelayed(hideBannerRunnable, 1800L)
            } catch (_: Exception) {}
        }
    }

    private fun removeInstantBanner() {
        val v = instantBannerView ?: return
        try {
            windowManager?.removeView(v)
        } catch (_: Exception) {}
        instantBannerView = null
    }

    private fun triggerShortHaptic() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator.vibrate(VibrationEffect.createOneShot(55, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val vib = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vib.vibrate(VibrationEffect.createOneShot(55, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vib.vibrate(55)
                }
            }
        } catch (_: Exception) {}
    }

    private fun stopAllBackgroundMediaAndPiP() {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager

            val downPause = KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE)
            val upPause = KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE)
            audioManager.dispatchMediaKeyEvent(downPause)
            audioManager.dispatchMediaKeyEvent(upPause)

            val downStop = KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_STOP)
            val upStop = KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_STOP)
            audioManager.dispatchMediaKeyEvent(downStop)
            audioManager.dispatchMediaKeyEvent(upStop)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val focusReq = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                            .build()
                    )
                    .setOnAudioFocusChangeListener {}
                    .build()
                audioManager.requestAudioFocus(focusReq)
                mainHandler.postDelayed({
                    try {
                        audioManager.abandonAudioFocusRequest(focusReq)
                    } catch (_: Exception) {}
                }, 1200L)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
                )
            }
        } catch (_: Exception) {}
    }

    private fun checkAndCloseDisallowedPiPWindows(
        prefs: android.content.SharedPreferences,
        allowedApps: Set<String>
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try {
            val windowList = windows ?: return
            val usedMillis = prefs.getLong("YT_USED_MILLIS", 0L)
            val limitMillis = prefs.getInt("YT_LIMIT_MINUTES", 90) * 60 * 1000L
            val isYtExhausted = usedMillis >= limitMillis

            for (win in windowList) {
                if (win.isInPictureInPictureMode) {
                    val winPkg = win.root?.packageName?.toString() ?: ""
                    val isDisallowedPiP = winPkg.isEmpty() ||
                        !allowedApps.contains(winPkg) ||
                        (winPkg == "com.google.android.youtube" && isYtExhausted)

                    if (isDisallowedPiP) {
                        stopAllBackgroundMediaAndPiP()
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        showInstantAlert("🚫 ভাসমান ভিডিও প্লেয়ার (PiP) ব্লক করা হয়েছে!")
                        break
                    }
                }
            }
        } catch (_: Exception) {}
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

    // 🌟 Unified Cycle Timing:
    // SESSION Lock -> 25m Focus + 5m Break (30m cycle)
    // SCHEDULE Lock -> 50m Focus + 10m Break (60m cycle)
    private fun getActiveCycleParameters(prefs: android.content.SharedPreferences): Pair<Long, Long>? {
        val lockMode = prefs.getString("LOCK_MODE", "SESSION") ?: "SESSION"
        return if (lockMode == "SESSION") {
            if (prefs.getBoolean("POMODORO_ENABLED", true)) {
                Pair(SESSION_FOCUS_MILLIS, SESSION_CYCLE_MILLIS)
            } else null
        } else {
            if (prefs.getBoolean("SCHEDULE_BREAK_ENABLED", true)) {
                Pair(SCHEDULE_FOCUS_MILLIS, SCHEDULE_CYCLE_MILLIS)
            } else null
        }
    }

    private fun isCurrentlyInBreakPhase(prefs: android.content.SharedPreferences, now: Long): Boolean {
        val cycleParams = getActiveCycleParameters(prefs) ?: return false
        val focusMillis = cycleParams.first
        val cycleMillis = cycleParams.second

        val startTime = prefs.getLong("SESSION_START_TIME", 0L)
        if (startTime <= 0L || now <= startTime) return false

        val elapsed = now - startTime
        val cyclePos = elapsed % cycleMillis
        return cyclePos >= focusMillis
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

                val allowedApps = getAllowedAppsSet(prefs)
                val inBreak = isCurrentlyInBreakPhase(prefs, now)

                if (!inBreak) {
                    checkAndCloseDisallowedPiPWindows(prefs, allowedApps)
                }

                val cycleParams = getActiveCycleParameters(prefs)
                if (inBreak && cycleParams != null) {
                    val cycleMillis = cycleParams.second
                    val startTime = prefs.getLong("SESSION_START_TIME", 0L)
                    val elapsed = now - startTime
                    val currentCycleIndex = elapsed / cycleMillis
                    val cyclePos = elapsed % cycleMillis
                    val remainingBreakMillis = cycleMillis - cyclePos

                    if (remainingBreakMillis in 1..30000L && breakWarningShownForCycle != currentCycleIndex) {
                        breakWarningShownForCycle = currentCycleIndex
                        showInstantAlert("⏳ আর ৩০ সেকেন্ড পর আবার ফোকাস লক শুরু হবে!")
                    }
                    wasInBreakPhase = true
                } else if (wasInBreakPhase) {
                    wasInBreakPhase = false
                    ensureForegroundNotification()
                    val currentPkg = rootInActiveWindow?.packageName?.toString() ?: ""
                    if (currentPkg.isNotEmpty() &&
                        currentPkg != applicationContext.packageName &&
                        !allowedApps.contains(currentPkg)
                    ) {
                        stopAllBackgroundMediaAndPiP()
                        showInstantAlert("🔒 ব্রেক শেষ! আবার ফোকাস লক শুরু হয়েছে।")
                        redirectToMainActivity(force = true)
                    }
                }

                sessionTickHandler.postDelayed(this, 1000L)
            }
        })
    }

    // 🌟 PDF-Only Guard for News Plus & Google Drive PDF Viewer:
    // Allows reading .pdf files, but blocks video players or non-PDF feeds inside News Plus!
    private fun containsVideoOrDisallowedFeedInPdfReader(
        node: AccessibilityNodeInfo?,
        className: String
    ): Boolean {
        if (node == null) return false
        val lowerClass = className.lowercase()
        if (lowerClass.contains("video") || lowerClass.contains("exoplayer")) {
            return true
        }
        return checkNodeTreeForVideo(node, 0)
    }

    private fun checkNodeTreeForVideo(node: AccessibilityNodeInfo?, depth: Int): Boolean {
        if (node == null || depth > 12 || !node.isVisibleToUser) return false
        val viewId = node.viewIdResourceName?.lowercase() ?: ""
        val cls = node.className?.toString()?.lowercase() ?: ""

        if (viewId.contains("video_player") ||
            viewId.contains("exoplayer") ||
            viewId.contains("reel_player") ||
            viewId.contains("shorts_player") ||
            cls.contains("videoview")
        ) {
            return true
        }

        for (i in 0 until node.childCount) {
            if (checkNodeTreeForVideo(node.getChild(i), depth + 1)) return true
        }
        return false
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

        val allowedApps = getAllowedAppsSet(prefs)
        val inBreak = isCurrentlyInBreakPhase(prefs, now)

        if (!inBreak && eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            checkAndCloseDisallowedPiPWindows(prefs, allowedApps)
        }

        val rootNode = rootInActiveWindow
        val rootPackageName = rootNode?.packageName?.toString()
        val eventPackageName = event.packageName?.toString()

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

        val packageName = rootPackageName ?: eventPackageName ?: return
        val ownPackage = applicationContext.packageName

        if (packageName == ownPackage) {
            stopYouTubeTracker()
            return
        }

        val lowerPkg = packageName.lowercase()
        val eventClassName = event.className?.toString() ?: ""
        val lowerClass = eventClassName.lowercase()

        // 🌟 Allow Android & Realme "Open with..." Chooser / Intent Resolver & File Picker so PDF opening works seamlessly!
        if (lowerPkg.contains("inputmethod") ||
            lowerPkg.contains("keyboard") ||
            lowerPkg.contains("honeyboard") ||
            lowerPkg.contains("gboard") ||
            lowerPkg.contains("ridmik") ||
            lowerPkg.contains("permissioncontroller") ||
            lowerPkg.contains("packageinstaller") ||
            lowerPkg.contains("intentresolver") ||
            lowerPkg.contains("documentsui") ||
            lowerPkg == "android" ||
            lowerClass.contains("resolveractivity") ||
            lowerClass.contains("chooseractivity")
        ) {
            return
        }

        // 🌟 ALWAYS BLOCK SHORTS & REELS (Even during the 5m / 10m Break Phase!)
        if (packageName == "com.google.android.youtube" ||
            packageName == "com.instagram.android" ||
            packageName == "com.facebook.katana"
        ) {
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
                showInstantAlert("🚫 Focus & Break চলাকালীন Shorts এবং Reels সম্পূর্ণ নিষিদ্ধ!")
                return
            }
        }

        // During Break Phase: allow normal apps (except Shorts/Reels handled above & Settings tampering)
        if (inBreak) {
            stopYouTubeTracker()
            if (packageName == "com.android.settings" && rootNode != null && isTamperingWithSettings(rootNode)) {
                performGlobalAction(GLOBAL_ACTION_BACK)
                redirectToMainActivity(force = true)
            }
            return
        }

        // 🌟 Default PDF Readers (News Plus PDF Viewer + Google Drive PDF Viewer) with PDF-Only Guard!
        val pdfReaders = getPdfReaderPackages()
        if (pdfReaders.contains(packageName) || (eventPackageName != null && pdfReaders.contains(eventPackageName))) {
            stopYouTubeTracker()
            if (containsVideoOrDisallowedFeedInPdfReader(rootNode, eventClassName)) {
                stopAllBackgroundMediaAndPiP()
                performGlobalAction(GLOBAL_ACTION_BACK)
                showInstantAlert("🚫 শুধুমাত্র PDF পড়া যাবে, ভিডিও দেখা নিষিদ্ধ!")
                redirectToMainActivity(force = true)
            }
            return
        }

        // 🌟 WHITELISTED APPS HANDLING
        val isAllowedApp = allowedApps.contains(packageName) ||
            (eventPackageName != null && allowedApps.contains(eventPackageName))

        if (isAllowedApp) {
            val activeAllowedPkg = if (allowedApps.contains(packageName)) packageName else eventPackageName!!

            // If user opens a PDF from Telegram/WhatsApp, extend PDF reading grace
            if (activeAllowedPkg.contains("telegram") || activeAllowedPkg.contains("whatsapp")) {
                prefs.edit().putLong("PDF_OPEN_GRACE_UNTIL", now + 8000L).apply()
            }

            if (activeAllowedPkg == "com.google.android.youtube") {
                resetDailyYouTubeQuotaIfNeeded(prefs)
                val usedMillis = prefs.getLong("YT_USED_MILLIS", 0L)
                val limitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 90)
                val limitMillis = limitMinutes * 60 * 1000L

                if (usedMillis >= limitMillis) {
                    stopYouTubeTracker()
                    stopAllBackgroundMediaAndPiP()
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    showInstantAlert("⏳ আজকের YouTube লং ভিডিওর সময়সীমা ($limitMinutes মিনিট) শেষ!")
                    redirectToMainActivity(force = true)
                    return
                }

                startYouTubeTracker(prefs)
                return
            }

            if (activeAllowedPkg == "com.android.chrome" ||
                activeAllowedPkg == "com.brave.browser" ||
                activeAllowedPkg == "com.sec.android.app.sbrowser"
            ) {
                stopYouTubeTracker()
                val allowedDomains = getAllowedDomainsSet(prefs)
                if (rootNode != null) {
                    checkBrowserUrlAndBlock(rootNode, activeAllowedPkg, allowedDomains)
                }
                return
            }

            stopYouTubeTracker()
            return
        }

        // Allow Realme/Android PDF viewer activity launched directly from Telegram or Read Study PDF button
        val pdfGraceUntil = prefs.getLong("PDF_OPEN_GRACE_UNTIL", 0L)
        if (now < pdfGraceUntil || lowerClass.contains("pdf") || lowerPkg.contains("pdf")) {
            if (!containsVideoOrDisallowedFeedInPdfReader(rootNode, eventClassName)) {
                return
            }
        }

        val lastLaunchedApp = prefs.getString("LAST_LAUNCHED_ALLOWED_APP", "") ?: ""
        val graceUntil = prefs.getLong("WHITELIST_GRACE_UNTIL", 0L)
        if (now < graceUntil && lastLaunchedApp.isNotEmpty()) {
            if (lowerPkg.contains("launcher") || lowerPkg.contains("systemui")) {
                return
            }
        }

        val isWindowTransition = eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED
        if (!isWindowTransition) return

        if (rootPackageName != null &&
            (rootPackageName == ownPackage ||
                allowedApps.contains(rootPackageName) ||
                pdfReaders.contains(rootPackageName))
        ) {
            return
        }

        stopYouTubeTracker()
        stopAllBackgroundMediaAndPiP()

        if (lowerPkg.contains("systemui") ||
            lowerPkg.contains("recents") ||
            lowerPkg.contains("overview") ||
            lowerClass.contains("recents")
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

        if (rawText.contains("youtube.com") || rawText.contains("youtu.be")) {
            stopAllBackgroundMediaAndPiP()
            redirectChromeToSafeSite(packageName, allowedDomains)
            showInstantAlert("🚫 Chrome-এ YouTube চালানো নিষিদ্ধ! YouTube অ্যাপ ব্যবহার করুন।")
            return
        }

        if (allowedDomains.isEmpty()) return

        val isAllowed = allowedDomains.any { domain ->
            val cleanDomain = domain.trim().lowercase()
                .removePrefix("https://")
                .removePrefix("http://")
                .removePrefix("www.")
                .trimEnd('/')
            cleanDomain.isNotEmpty() && rawText.contains(cleanDomain)
        }

        if (!isAllowed) {
            redirectChromeToSafeSite(packageName, allowedDomains)
            showInstantAlert("🚫 শুধু আপনার সিলেক্ট করা ৫টি ওয়েবসাইট চালানো যাবে!")
        }
    }

    private fun redirectChromeToSafeSite(packageName: String, allowedDomains: Set<String>) {
        val firstAllowed = allowedDomains.firstOrNull() ?: "www.google.com"
        val safeUrl = if (firstAllowed.startsWith("http")) firstAllowed else "https://$firstAllowed"
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(safeUrl)).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (_: Exception) {
            performGlobalAction(GLOBAL_ACTION_BACK)
        }
    }

    private fun isTamperingWithSettings(rootNode: AccessibilityNodeInfo): Boolean {
        val textMatches = rootNode.findAccessibilityNodeInfosByText("Jnuits")
        if (!textMatches.isNullOrEmpty()) return true
        return false
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
                .commit()
        }
    }

    private fun startYouTubeTracker(prefs: android.content.SharedPreferences) {
        if (isYtForeground) return
        isYtForeground = true
        lastYtTickRealtime = SystemClock.elapsedRealtime()
        ytHandler.removeCallbacksAndMessages(null)
        ytHandler.postDelayed(object : Runnable {
            override fun run() {
                if (!isYtForeground) return

                val currentRootPkg = rootInActiveWindow?.packageName?.toString() ?: ""
                val graceUntil = prefs.getLong("WHITELIST_GRACE_UNTIL", 0L)
                if (currentRootPkg.isNotEmpty() &&
                    currentRootPkg != "com.google.android.youtube" &&
                    System.currentTimeMillis() > graceUntil &&
                    !currentRootPkg.contains("inputmethod") &&
                    !currentRootPkg.contains("keyboard")
                ) {
                    stopYouTubeTracker()
                    return
                }

                resetDailyYouTubeQuotaIfNeeded(prefs)
                val nowRealtime = SystemClock.elapsedRealtime()
                val delta = (nowRealtime - lastYtTickRealtime).coerceIn(500L, 2500L)
                lastYtTickRealtime = nowRealtime

                val usedMillis = prefs.getLong("YT_USED_MILLIS", 0L) + delta
                prefs.edit().putLong("YT_USED_MILLIS", usedMillis).commit()

                val limitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 90)
                val limitMillis = limitMinutes * 60 * 1000L
                if (usedMillis >= limitMillis) {
                    stopYouTubeTracker()
                    stopAllBackgroundMediaAndPiP()
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    showInstantAlert("⏳ আজকের YouTube লং ভিডিওর সময়সীমা শেষ!")
                    redirectToMainActivity(force = true)
                    return
                }
                ytHandler.postDelayed(this, 1000L)
            }
        }, 1000L)
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
        removeInstantBanner()

        val prefs = getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val wasActive = prefs.getBoolean("IS_SESSION_ACTIVE", false)
        val startTime = prefs.getLong("SESSION_START_TIME", 0L)
        val startRealtime = prefs.getLong("SESSION_START_REALTIME", 0L)
        val plannedDuration = prefs.getLong("SESSION_PLANNED_DURATION", 0L)

        val now = System.currentTimeMillis()
        val wallElapsed = if (startTime > 0L) (now - startTime) else plannedDuration
        val hardwareElapsed = if (startRealtime > 0L) (SystemClock.elapsedRealtime() - startRealtime) else wallElapsed

        var completedDuration = minOf(wallElapsed, hardwareElapsed)
        if (plannedDuration > 0L) {
            completedDuration = minOf(completedDuration, plannedDuration)
        }

        prefs.edit()
            .putBoolean("IS_SESSION_ACTIVE", false)
            .remove("SESSION_END_TIME")
            .remove("SESSION_START_TIME")
            .remove("SESSION_START_REALTIME")
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
                "Schedule Lock (50m/10m) Active"
            } else {
                "Session Lock (25m/5m) Active"
            }
            builder.setContentTitle(modeTitle)
            builder.setContentText("Only whitelisted apps, sites & study PDFs allowed.")

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
        bannerHandler.removeCallbacksAndMessages(null)
        stopYouTubeTracker()
        removeAnchorOverlay()
        removeInstantBanner()
        try {
            unregisterReceiver(sessionReceiver)
        } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}