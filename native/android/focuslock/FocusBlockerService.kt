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
import android.telecom.TelecomManager
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
import org.json.JSONArray
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
    private var lastDeepScanAt = 0L
    private var cachedStudyMatch = false
    private var lastStudyScanAt = 0L

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

    private fun isProActive(prefs: android.content.SharedPreferences): Boolean {
        val activeEmail = (prefs.getString("ACTIVE_USER_EMAIL", "") ?: "").trim().lowercase(Locale.US)
        if (activeEmail == "juwelrana3426@gmail.com") return true
        val proFlag = prefs.getBoolean("IS_PRO_USER", false)
        val expiresAt = prefs.getLong("PRO_EXPIRES_AT", 0L)
        if (!proFlag || expiresAt <= 0L) return false

        val now = System.currentTimeMillis()
        val maxSeen = prefs.getLong("MAX_SEEN_WALL_TIME", 0L)
        // Anti-Time-Cheat: If user rolled phone clock backward by > 10 minutes offline, block Pro!
        if (maxSeen > 0L && now < maxSeen - 10 * 60 * 1000L) {
            return false
        }
        if (now > maxSeen) {
            prefs.edit().putLong("MAX_SEEN_WALL_TIME", now).apply()
        }
        if (now >= expiresAt) return false

        val savedSeal = prefs.getString("PRO_SECURITY_SEAL", "") ?: ""
        val expectedSeal = FocusScheduler.computeProSecuritySeal(this, expiresAt)
        if (savedSeal.isNotEmpty() && expectedSeal.isNotEmpty() && savedSeal != expectedSeal) {
            return false
        }
        return true
    }

    // 🌟 Default Whitelisted Essential Apps: Phone/Dialer, bKash, and Nagad (Outside 2/6 App Quota!)
    private fun isDefaultEssentialWhitelistedPackage(pkg: String): Boolean {
        if (pkg.isEmpty()) return false
        val lower = pkg.lowercase(Locale.US)
        if (pkg == "com.bKash.customerapp" ||
            lower == "com.bkash.customerapp" ||
            pkg == "com.konasl.nagad" ||
            lower == "com.konasl.nagad" ||
            lower.contains("dialer") ||
            lower.contains("incallui") ||
            lower == "com.android.phone" ||
            lower == "com.android.server.telecom" ||
            lower == "com.google.android.dialer" ||
            lower == "com.samsung.android.dialer" ||
            lower == "com.samsung.android.incallui" ||
            lower == "com.oplus.dialer" ||
            lower == "com.coloros.phonemanager" ||
            lower == "com.truecaller"
        ) {
            return true
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val tm = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
                val defDialer = tm?.defaultDialerPackage
                if (!defDialer.isNullOrEmpty() && defDialer == pkg) return true
            }
        } catch (_: Exception) {}
        return false
    }

    // Discovers News Plus & Drive PDF Viewer packages on Realme/Android
    private fun getPdfReaderPackages(): Set<String> {
        cachedNewsPlusPackages?.let { if (it.isNotEmpty()) return it }
        val result = HashSet<String>()
        result.add("com.google.android.apps.docs") // Google Drive PDF Viewer
        result.add("cn.wps.moffice_eng")
        result.add("com.adobe.reader")
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
                    pkgName.contains("pdf") ||
                    (label.contains("pdf") && (label.contains("viewer") || label.contains("reader")))
                ) {
                    result.add(pkg.packageName)
                }
            }
        } catch (_: Exception) {}
        cachedNewsPlusPackages = result
        return result
    }

    private fun isHomeLauncherPackage(pkg: String): Boolean {
        val lower = pkg.lowercase()
        return lower.contains("launcher") ||
            lower == "com.android.home" ||
            lower == "com.oppo.launcher" ||
            lower == "com.realme.launcher" ||
            lower == "com.coloros.launcher" ||
            lower == "com.sec.android.app.launcher" ||
            lower == "com.miui.home" ||
            lower == "com.google.android.apps.nexuslauncher"
    }

    private fun isKeyboardOrSystemOverlayPackage(pkg: String, cls: String = ""): Boolean {
        val lowerPkg = pkg.lowercase()
        val lowerCls = cls.lowercase()
        return lowerPkg.contains("inputmethod") ||
            lowerPkg.contains("keyboard") ||
            lowerPkg.contains("honeyboard") ||
            lowerPkg.contains("gboard") ||
            lowerPkg.contains("ridmik") ||
            lowerPkg.contains("swiftkey") ||
            lowerPkg.contains("touchtype") ||
            lowerPkg.contains("fleksy") ||
            lowerPkg.contains("latin") ||
            lowerPkg.contains("autofill") ||
            lowerPkg.contains("credentialmanager") ||
            lowerPkg == "com.google.android.tts" ||
            lowerPkg == "com.google.android.as" ||
            lowerPkg.contains("permissioncontroller") ||
            lowerPkg.contains("packageinstaller") ||
            lowerPkg.contains("intentresolver") ||
            lowerPkg.contains("documentsui") ||
            lowerPkg == "android" ||
            lowerCls.contains("inputmethod") ||
            lowerCls.contains("keyboard") ||
            lowerCls.contains("resolveractivity") ||
            lowerCls.contains("chooseractivity")
    }

    private fun getAllowedAppsSet(prefs: android.content.SharedPreferences): Set<String> {
        val maxApps = if (isProActive(prefs)) 6 else 2
        val result = LinkedHashSet<String>()
        val csv = prefs.getString("ALLOWED_APPS_CSV", "") ?: ""
        if (csv.isNotEmpty()) {
            csv.split(",").forEach { item ->
                val clean = item.trim()
                if (clean.isNotEmpty() && result.size < maxApps) result.add(clean)
            }
        }
        val setVal = prefs.getStringSet("ALLOWED_APPS", null)
        if (setVal != null) {
            for (pkg in setVal) {
                if (result.size >= maxApps) break
                result.add(pkg)
            }
        }
        return result
    }

    private fun getAllowedDomainsSet(prefs: android.content.SharedPreferences): Set<String> {
        val maxSites = if (isProActive(prefs)) 5 else 2
        val result = LinkedHashSet<String>()
        val csv = prefs.getString("ALLOWED_DOMAINS_CSV", "") ?: ""
        if (csv.isNotEmpty()) {
            csv.split(",").forEach { item ->
                val clean = item.trim().lowercase()
                if (clean.isNotEmpty() && !clean.contains("youtube.") && !clean.contains("youtu.be") && result.size < maxSites) {
                    result.add(clean)
                }
            }
        }
        val setVal = prefs.getStringSet("ALLOWED_DOMAINS", null)
        if (setVal != null) {
            setVal.forEach { d ->
                val clean = d.trim().lowercase()
                if (clean.isNotEmpty() && !clean.contains("youtube.") && !clean.contains("youtu.be") && result.size < maxSites) {
                    result.add(clean)
                }
            }
        }
        return result
    }

    // Extracts user's whitelisted Study Channels + Today's Study Video keywords/titles (Only for Toki Pro!)
    private fun getStudyKeywordsList(prefs: android.content.SharedPreferences): List<String> {
        if (!isProActive(prefs)) return emptyList()
        val list = ArrayList<String>()
        val channelsCsv = prefs.getString("STUDY_YT_CHANNELS_CSV", "") ?: ""
        if (channelsCsv.isNotEmpty()) {
            channelsCsv.split(",").forEach { ch ->
                val clean = ch.trim().lowercase()
                if (clean.length >= 2) list.add(clean)
            }
        }

        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val videosDate = prefs.getString("STUDY_YT_VIDEOS_DATE", "") ?: ""
        if (videosDate == todayStr) {
            val videosJson = prefs.getString("STUDY_YT_VIDEOS_JSON", "[]") ?: "[]"
            try {
                val arr = JSONArray(videosJson)
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val title = obj.optString("title", "").trim().lowercase()
                    val raw = obj.optString("raw", "").trim().lowercase()
                    if (title.length >= 2 && !title.startsWith("http")) {
                        list.add(title)
                    }
                    if (raw.length >= 2 && !raw.startsWith("http")) {
                        list.add(raw)
                    }
                }
            } catch (_: Exception) {}
        }
        return list
    }

    private fun isWatchingStudyChannelOrVideo(
        rootNode: AccessibilityNodeInfo?,
        prefs: android.content.SharedPreferences
    ): Boolean {
        if (!isProActive(prefs)) return false
        val keywords = getStudyKeywordsList(prefs)
        if (keywords.isEmpty()) return false

        val now = System.currentTimeMillis()
        val studyLaunchUntil = prefs.getLong("LAST_LAUNCHED_STUDY_YT_UNTIL", 0L)
        val stickyActive = prefs.getBoolean("STUDY_SESSION_STICKY_ACTIVE", false)

        if (now < studyLaunchUntil) {
            cachedStudyMatch = true
            lastStudyScanAt = now
            return true
        }

        if (rootNode == null) return cachedStudyMatch || stickyActive
        if (now - lastStudyScanAt < 950L) {
            return cachedStudyMatch
        }
        lastStudyScanAt = now

        // 1. Fast C++ Native Search across the entire YouTube screen for any Study Channel or Study Video keyword!
        var foundStudyKeywordOnScreen = false
        try {
            for (kw in keywords) {
                val cleanKw = kw.removePrefix("@").trim()
                if (cleanKw.length >= 2) {
                    val matches = rootNode.findAccessibilityNodeInfosByText(cleanKw)
                    if (!matches.isNullOrEmpty()) {
                        foundStudyKeywordOnScreen = true
                        break
                    }
                }
            }
        } catch (_: Throwable) {}

        if (foundStudyKeywordOnScreen) {
            if (!stickyActive) {
                prefs.edit().putBoolean("STUDY_SESSION_STICKY_ACTIVE", true).apply()
            }
            cachedStudyMatch = true
            return true
        }

        // 2. If user is already in a Sticky Study Session (e.g., watching a study video where title overlay auto-hid),
        // keep allowing UNLESS they switched to YouTube Home / Subscriptions / Trending tab or searched something else!
        if (stickyActive) {
            val leftStudyContext = isOnDisallowedYouTubeFeedOrSearch(rootNode, keywords)
            if (leftStudyContext) {
                prefs.edit().putBoolean("STUDY_SESSION_STICKY_ACTIVE", false).apply()
                cachedStudyMatch = false
                return false
            }
            cachedStudyMatch = true
            return true
        }

        cachedStudyMatch = false
        return false
    }

    private fun isOnDisallowedYouTubeFeedOrSearch(
        rootNode: AccessibilityNodeInfo,
        keywords: List<String>
    ): Boolean {
        try {
            // Check if bottom navigation "Home" or "Subscriptions" tab is selected
            for (tabWord in listOf("Home", "হোম", "Subscriptions")) {
                val tabNodes = rootNode.findAccessibilityNodeInfosByText(tabWord)
                if (!tabNodes.isNullOrEmpty()) {
                    for (n in tabNodes) {
                        if (n.isSelected && n.isVisibleToUser) {
                            return true
                        }
                    }
                }
            }
            // Check if search bar has non-study text
            val searchNodes = rootNode.findAccessibilityNodeInfosByViewId("com.google.android.youtube:id/search_edit_text")
            if (!searchNodes.isNullOrEmpty()) {
                val queryTxt = searchNodes[0].text?.toString()?.trim()?.lowercase() ?: ""
                if (queryTxt.length >= 2) {
                    val matchesStudy = keywords.any { kw ->
                        val c = kw.removePrefix("@").trim()
                        c.isNotEmpty() && (queryTxt.contains(c) || c.contains(queryTxt))
                    }
                    if (!matchesStudy) return true
                }
            }
        } catch (_: Throwable) {}
        return false
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
                vm.defaultVibrator.vibrate(VibrationEffect.createOneShot(80, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val vib = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vib.vibrate(VibrationEffect.createOneShot(80, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vib.vibrate(80)
                }
            }
        } catch (_: Exception) {}
    }

    private fun stopAllBackgroundMediaAndPiP() {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val attrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                    .build()
                val focusReq = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener {}
                    .build()
                audioManager.requestAudioFocus(focusReq)
                mainHandler.postDelayed({
                    try {
                        audioManager.abandonAudioFocusRequest(focusReq)
                    } catch (_: Exception) {}
                }, 400L)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                )
            }

            if (audioManager.isMusicActive) {
                val downEvent = KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE)
                val upEvent = KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE)
                audioManager.dispatchMediaKeyEvent(downEvent)
                audioManager.dispatchMediaKeyEvent(upEvent)

                val stopDown = KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_STOP)
                val stopUp = KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_STOP)
                audioManager.dispatchMediaKeyEvent(stopDown)
                audioManager.dispatchMediaKeyEvent(stopUp)
            }
        } catch (_: Exception) {}
    }

    private fun checkAndCloseDisallowedPiPWindows(
        prefs: android.content.SharedPreferences,
        allowedApps: Set<String>
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
        try {
            val winList = windows ?: return
            val dm = resources.displayMetrics
            val screenArea = dm.widthPixels * dm.heightPixels
            if (screenArea <= 0) return

            for (win in winList) {
                if (win.type == android.view.accessibility.AccessibilityWindowInfo.TYPE_INPUT_METHOD ||
                    win.type == android.view.accessibility.AccessibilityWindowInfo.TYPE_SYSTEM ||
                    win.type == android.view.accessibility.AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY
                ) {
                    continue
                }
                val root = win.root ?: continue
                val pkg = root.packageName?.toString() ?: continue
                if (pkg == applicationContext.packageName ||
                    pkg == "com.android.systemui" ||
                    isKeyboardOrSystemOverlayPackage(pkg) ||
                    isDefaultEssentialWhitelistedPackage(pkg)
                ) {
                    continue
                }

                val bounds = android.graphics.Rect()
                win.getBoundsInScreen(bounds)
                val winArea = bounds.width() * bounds.height()
                // Keyboards span full screen width at the bottom; PiP windows are narrower than 82% of screen width
                val isFullWidthKeyboardLike = bounds.width() >= (dm.widthPixels * 85 / 100) && bounds.bottom >= (dm.heightPixels - 160)
                if (isFullWidthKeyboardLike) continue

                val isFloatingPiP = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && win.isInPictureInPictureMode) ||
                    (winArea in 1000..(screenArea * 35 / 100) && bounds.width() < (dm.widthPixels * 82 / 100))
                if (isFloatingPiP) {
                    if (!allowedApps.contains(pkg) || pkg == "com.google.android.youtube") {
                        stopAllBackgroundMediaAndPiP()
                        performGlobalAction(GLOBAL_ACTION_BACK)
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun ensureAnchorOverlay() {
        if (anchorOverlayView != null) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !android.provider.Settings.canDrawOverlays(this)) {
            return
        }
        try {
            val view = View(this).apply {
                setBackgroundColor(Color.TRANSPARENT)
            }
            val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
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

    private fun getActiveCycleParameters(prefs: android.content.SharedPreferences): Pair<Long, Long>? {
        if (!isProActive(prefs)) return null
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
                    val remainingBreakMillis = minOf(cycleMillis - cyclePos, endTime - now)

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
                } else if (!inBreak) {
                    // Continuous 1s Watchdog: Ensures lock is strictly enforced even if an AccessibilityEvent was skipped
                    try {
                        val currentRoot = rootInActiveWindow
                        val currentPkg = currentRoot?.packageName?.toString() ?: ""
                        val graceUntil = prefs.getLong("WHITELIST_GRACE_UNTIL", 0L)
                        if (currentPkg.isNotEmpty() &&
                            currentPkg != applicationContext.packageName &&
                            currentPkg != "com.android.systemui" &&
                            !isKeyboardOrSystemOverlayPackage(currentPkg) &&
                            now >= graceUntil
                        ) {
                            val isEssentialAllowed = isDefaultEssentialWhitelistedPackage(currentPkg)
                            val isPdfAllowed = isProActive(prefs) && (getPdfReaderPackages().contains(currentPkg) || currentPkg.lowercase().contains("pdf"))
                            val isStudyYtAllowed = isProActive(prefs) &&
                                currentPkg == "com.google.android.youtube" &&
                                (now < prefs.getLong("LAST_LAUNCHED_STUDY_YT_UNTIL", 0L) || getStudyKeywordsList(prefs).isNotEmpty())
                            if (!isEssentialAllowed && !allowedApps.contains(currentPkg) && !isPdfAllowed && !isStudyYtAllowed) {
                                stopYouTubeTracker()
                                stopAllBackgroundMediaAndPiP()
                                redirectToMainActivity(force = true)
                            }
                        }
                    } catch (_: Throwable) {}
                }

                sessionTickHandler.postDelayed(this, 1000L)
            }
        })
    }

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
        if (node == null || depth > 8 || !node.isVisibleToUser) return false
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

        val count = minOf(node.childCount, 10)
        for (i in 0 until count) {
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
        val eventClassName = event.className?.toString() ?: ""
        val lowerClass = eventClassName.lowercase()

        // 0.01s Instant Pull-Back on Recents / Overview Button Press
        if (eventPackageName == "com.android.systemui") {
            val isRecentsOpened = eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
                (lowerClass.contains("recents") ||
                    lowerClass.contains("overview") ||
                    lowerClass.contains("quicksettings"))
            if (isRecentsOpened && !inBreak) {
                stopYouTubeTracker()
                stopAllBackgroundMediaAndPiP()
                prefs.edit()
                    .putLong("WHITELIST_GRACE_UNTIL", 0L)
                    .putLong("LAST_LAUNCHED_STUDY_YT_UNTIL", 0L)
                    .apply()
                performGlobalAction(GLOBAL_ACTION_BACK)
                redirectToMainActivity(force = true)
            }
            return
        }

        // 0.01s Instant Pull-Back on Home Button / Gesture to Launcher
        if (!inBreak && eventPackageName != null && isHomeLauncherPackage(eventPackageName)) {
            val graceUntil = prefs.getLong("WHITELIST_GRACE_UNTIL", 0L)
            if (now >= graceUntil) {
                stopYouTubeTracker()
                stopAllBackgroundMediaAndPiP()
                prefs.edit().putLong("LAST_LAUNCHED_STUDY_YT_UNTIL", 0L).apply()
                redirectToMainActivity(force = true)
                return
            }
        }

        val packageName = eventPackageName ?: rootPackageName ?: return
        val ownPackage = applicationContext.packageName

        if (packageName == ownPackage || rootPackageName == ownPackage) {
            stopYouTubeTracker()
            return
        }

        // Always allow Essential Default Whitelisted Apps: Phone/Dialer, bKash, and Nagad (Outside 2/6 quota!)
        if (isDefaultEssentialWhitelistedPackage(packageName) ||
            (rootPackageName != null && isDefaultEssentialWhitelistedPackage(rootPackageName))
        ) {
            stopYouTubeTracker()
            if (prefs.getLong("WHITELIST_GRACE_UNTIL", 0L) > 0L) {
                prefs.edit().putLong("WHITELIST_GRACE_UNTIL", 0L).apply()
            }
            return
        }

        val lowerPkg = packageName.lowercase()

        if (isKeyboardOrSystemOverlayPackage(packageName, eventClassName) ||
            (rootPackageName != null && isKeyboardOrSystemOverlayPackage(rootPackageName))
        ) {
            return
        }

        // ALWAYS BLOCK SHORTS & REELS (Even during the 5m / 10m Break Phase!)
        if (packageName == "com.google.android.youtube" ||
            packageName == "com.instagram.android" ||
            packageName == "com.facebook.katana" ||
            rootPackageName == "com.google.android.youtube" ||
            rootPackageName == "com.instagram.android" ||
            rootPackageName == "com.facebook.katana"
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
            val shouldDeepScanShorts = eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || (now - lastDeepScanAt >= 750L)
            if (shouldDeepScanShorts) {
                lastDeepScanAt = now
            }
            if (caughtShorts || (shouldDeepScanShorts && rootNode != null && containsShortsContent(rootNode, 0, intArrayOf(0)))) {
                performGlobalAction(GLOBAL_ACTION_BACK)
                showInstantAlert("🚫 Focus & Break চলাকালীন Shorts এবং Reels সম্পূর্ণ নিষিদ্ধ!")
                return
            }
        }

        if (inBreak) {
            stopYouTubeTracker()
            if (packageName == "com.android.settings" && rootNode != null && isTamperingWithSettings(rootNode)) {
                performGlobalAction(GLOBAL_ACTION_BACK)
                redirectToMainActivity(force = true)
            }
            return
        }

        // Default PDF Readers (Only for Toki Pro!)
        if (isProActive(prefs)) {
            val pdfReaders = getPdfReaderPackages()
            val isPdfReaderActive = pdfReaders.contains(packageName) ||
                (rootPackageName != null && pdfReaders.contains(rootPackageName) && !isHomeLauncherPackage(packageName)) ||
                lowerClass.contains("pdf") ||
                lowerPkg.contains("pdf")

            if (isPdfReaderActive) {
                stopYouTubeTracker()
                prefs.edit().putLong("WHITELIST_GRACE_UNTIL", 0L).apply()
                if (containsVideoOrDisallowedFeedInPdfReader(rootNode, eventClassName)) {
                    stopAllBackgroundMediaAndPiP()
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    showInstantAlert("🚫 শুধুমাত্র PDF পড়া যাবে, ভিডিও দেখা নিষিদ্ধ!")
                    redirectToMainActivity(force = true)
                }
                return
            }
        }

        // WHITELISTED APPS & STUDY YOUTUBE HANDLING
        val isStudyYtLaunchActive = isProActive(prefs) &&
            (packageName == "com.google.android.youtube" || rootPackageName == "com.google.android.youtube") &&
            (now < prefs.getLong("LAST_LAUNCHED_STUDY_YT_UNTIL", 0L) || getStudyKeywordsList(prefs).isNotEmpty())

        val isAllowedApp = allowedApps.contains(packageName) ||
            (rootPackageName != null && allowedApps.contains(rootPackageName) && !isHomeLauncherPackage(packageName)) ||
            isStudyYtLaunchActive

        if (isAllowedApp) {
            val activeAllowedPkg = if (packageName == "com.google.android.youtube" || rootPackageName == "com.google.android.youtube") {
                "com.google.android.youtube"
            } else if (allowedApps.contains(packageName)) {
                packageName
            } else {
                rootPackageName ?: packageName
            }

            if (prefs.getLong("WHITELIST_GRACE_UNTIL", 0L) > 0L) {
                prefs.edit().putLong("WHITELIST_GRACE_UNTIL", 0L).apply()
            }

            if (activeAllowedPkg == "com.google.android.youtube") {
                resetDailyYouTubeQuotaIfNeeded(prefs)
                val generalUsedMillis = prefs.getLong("YT_USED_MILLIS", 0L)
                val generalLimitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 30).coerceIn(15, 45)
                val generalLimitMillis = generalLimitMinutes * 60 * 1000L

                val studyUsedMillis = prefs.getLong("YT_STUDY_USED_MILLIS", 0L)
                val studyLimitMinutes = prefs.getInt("YT_STUDY_LIMIT_MINUTES", 210).coerceIn(90, 210)
                val studyLimitMillis = studyLimitMinutes * 60 * 1000L

                val isStudyMatch = isWatchingStudyChannelOrVideo(rootNode, prefs)

                if (isStudyMatch) {
                    if (studyUsedMillis >= studyLimitMillis) {
                        stopYouTubeTracker()
                        stopAllBackgroundMediaAndPiP()
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        showInstantAlert("⏳ আজকের ক্লাস/স্টাডি YouTube-এর সময়সীমা ($studyLimitMinutes মিনিট) শেষ!")
                        redirectToMainActivity(force = true)
                        return
                    }
                } else {
                    val isGeneralYtWhitelisted = allowedApps.contains("com.google.android.youtube")
                    if (!isGeneralYtWhitelisted || generalUsedMillis >= generalLimitMillis) {
                        val hasStudyItems = getStudyKeywordsList(prefs).isNotEmpty()
                        stopYouTubeTracker()
                        stopAllBackgroundMediaAndPiP()
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        if (hasStudyItems && studyUsedMillis < studyLimitMillis) {
                            showInstantAlert("🎓 সাধারণ YouTube ($generalLimitMinutes মিনিট) শেষ! এখন শুধু আপনার সেভ করা ক্লাসের চ্যানেল বা ভিডিও দেখা যাবে।")
                        } else {
                            showInstantAlert("⏳ আজকের সাধারণ YouTube লং ভিডিওর সময়সীমা ($generalLimitMinutes মিনিট) শেষ!")
                        }
                        redirectToMainActivity(force = true)
                        return
                    }
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

        val lastLaunchedApp = prefs.getString("LAST_LAUNCHED_ALLOWED_APP", "") ?: ""
        val graceUntil = prefs.getLong("WHITELIST_GRACE_UNTIL", 0L)
        if (now < graceUntil && lastLaunchedApp.isNotEmpty()) {
            if (isHomeLauncherPackage(packageName) || lowerPkg.contains("systemui")) {
                return
            }
        }

        val isWindowTransition = eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED
        if (!isWindowTransition) return

        stopYouTubeTracker()
        stopAllBackgroundMediaAndPiP()

        if (lowerPkg.contains("systemui") ||
            lowerPkg.contains("recents") ||
            lowerPkg.contains("overview") ||
            lowerClass.contains("recents")
        ) {
            performGlobalAction(GLOBAL_ACTION_BACK)
        }

        redirectToMainActivity(force = true)
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
            showInstantAlert("🚫 শুধু আপনার অনুমোদিত ওয়েবসাইট চালানো যাবে!")
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
        val tokiMatches = rootNode.findAccessibilityNodeInfosByText("Toki")
        if (!tokiMatches.isNullOrEmpty()) return true
        val jnuitsMatches = rootNode.findAccessibilityNodeInfosByText("Jnuits")
        if (!jnuitsMatches.isNullOrEmpty()) return true
        return false
    }

    private fun redirectToMainActivity(force: Boolean) {
        val now = System.currentTimeMillis()
        if (now - lastRedirectAt < 350L) return
        try {
            val activeRootPkg = rootInActiveWindow?.packageName?.toString()
            if (activeRootPkg == applicationContext.packageName) {
                return
            }
        } catch (_: Throwable) {}
        lastRedirectAt = now

        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION
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
            val editor = prefs.edit()
                .putString("YT_USAGE_DATE", todayStr)
                .putLong("YT_USED_MILLIS", 0L)
                .putLong("YT_STUDY_USED_MILLIS", 0L)

            val videosDate = prefs.getString("STUDY_YT_VIDEOS_DATE", "") ?: ""
            if (videosDate.isNotEmpty() && videosDate != todayStr) {
                editor.putString("STUDY_YT_VIDEOS_JSON", "[]")
                editor.putString("STUDY_YT_VIDEOS_DATE", todayStr)
            }
            editor.commit()
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

                val rootNode = rootInActiveWindow
                val currentRootPkg = rootNode?.packageName?.toString() ?: ""
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

                val isStudyMatch = isWatchingStudyChannelOrVideo(rootNode, prefs)

                if (isStudyMatch) {
                    val studyUsed = prefs.getLong("YT_STUDY_USED_MILLIS", 0L) + delta
                    prefs.edit().putLong("YT_STUDY_USED_MILLIS", studyUsed).commit()

                    val studyLimitMinutes = prefs.getInt("YT_STUDY_LIMIT_MINUTES", 210).coerceIn(90, 210)
                    val studyLimitMillis = studyLimitMinutes * 60 * 1000L
                    if (studyUsed >= studyLimitMillis) {
                        stopYouTubeTracker()
                        stopAllBackgroundMediaAndPiP()
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        showInstantAlert("⏳ আজকের ক্লাস/স্টাডি YouTube-এর সময়সীমা ($studyLimitMinutes মিনিট) শেষ!")
                        redirectToMainActivity(force = true)
                        return
                    }
                } else {
                    val allowedAppsNow = getAllowedAppsSet(prefs)
                    val isGeneralYtWhitelisted = allowedAppsNow.contains("com.google.android.youtube")
                    val generalUsed = prefs.getLong("YT_USED_MILLIS", 0L) + delta
                    prefs.edit().putLong("YT_USED_MILLIS", generalUsed).commit()

                    val generalLimitMinutes = prefs.getInt("YT_LIMIT_MINUTES", 30).coerceIn(15, 45)
                    val generalLimitMillis = generalLimitMinutes * 60 * 1000L
                    if (!isGeneralYtWhitelisted || generalUsed >= generalLimitMillis) {
                        val hasStudyItems = getStudyKeywordsList(prefs).isNotEmpty()
                        val studyUsed = prefs.getLong("YT_STUDY_USED_MILLIS", 0L)
                        val studyLimitMillis = prefs.getInt("YT_STUDY_LIMIT_MINUTES", 210).coerceIn(90, 210) * 60 * 1000L

                        stopYouTubeTracker()
                        stopAllBackgroundMediaAndPiP()
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        if (hasStudyItems && studyUsed < studyLimitMillis) {
                            showInstantAlert("🎓 সাধারণ YouTube ($generalLimitMinutes মিনিট) শেষ! এখন শুধু আপনার সেভ করা ক্লাসের চ্যানেল বা ভিডিও দেখা যাবে।")
                        } else {
                            showInstantAlert("⏳ আজকের সাধারণ YouTube লং ভিডিওর সময়সীমা ($generalLimitMinutes মিনিট) শেষ!")
                        }
                        redirectToMainActivity(force = true)
                        return
                    }
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
            .putLong("LAST_LAUNCHED_STUDY_YT_UNTIL", 0L)
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

    private fun containsShortsContent(node: AccessibilityNodeInfo?, depth: Int = 0, budget: IntArray = intArrayOf(0)): Boolean {
        if (node == null || depth > 8 || budget[0] > 55 || !node.isVisibleToUser) return false
        budget[0]++
        if (isShortsNode(node)) return true
        val count = minOf(node.childCount, 10)
        for (index in 0 until count) {
            if (containsShortsContent(node.getChild(index), depth + 1, budget)) return true
        }
        return false
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Toki Focus Mode", NotificationManager.IMPORTANCE_LOW),
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
                "Toki Schedule Lock (50m/10m)"
            } else {
                "Toki Session Lock (25m/5m)"
            }
            builder.setContentTitle(modeTitle)
            builder.setContentText("Only whitelisted apps, sites & study classes allowed.")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                builder.setUsesChronometer(true)
                builder.setChronometerCountDown(true)
                builder.setWhen(endTime)
            }
        } else {
            builder.setContentTitle("Toki Focus Mode")
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