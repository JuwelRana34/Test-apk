package com.juwel522.myapp

import android.animation.ValueAnimator // 🌟 সাউন্ড আস্তে আস্তে বাড়ানোর জন্য
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import kotlin.random.Random
import android.view.KeyEvent

class RingActivity : AppCompatActivity() {

    private var mediaPlayer: MediaPlayer? = null
    private var volumeAnimator: ValueAnimator? = null // 🌟 Fade-in অ্যানিমেশন ভেরিয়েবল
    private var wakeLock: PowerManager.WakeLock? = null
    private var correctAnswer: Int = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setupWindowFlags()
        acquireWakeLock()
        setContentView(buildRootView())
        hideSystemUI()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                Toast.makeText(this@RingActivity, "Solve the puzzle to stop the alarm!", Toast.LENGTH_SHORT).show()
            }
        })

        playAlarmSound(intent.getStringExtra("soundUri"))
    }

    private fun setupWindowFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        )
    }

    private fun acquireWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
            PowerManager.ACQUIRE_CAUSES_WAKEUP or
            PowerManager.ON_AFTER_RELEASE,
            "AlarmApp::RingActivityWakeLock"
        )
        wakeLock?.acquire(10 * 60 * 1000L)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(android.view.WindowInsets.Type.systemBars())
                controller.systemBarsBehavior =
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val relaunch = Intent(this, RingActivity::class.java).apply {
            putExtras(intent)
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_NO_ANIMATION
            )
        }
        startActivity(relaunch)
    }

// 🌟 ইউজারের ভলিউম বাটন প্রেস কন্ট্রোল করার ম্যাজিক
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            val minVolume = Math.ceil(maxVolume * 0.70).toInt() // ৭০% ভলিউম
            val currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)

            // যদি বর্তমান ভলিউম ৭০% এর সমান বা কম হয়, তবে আর কমানো যাবে না!
            if (currentVolume <= minVolume) {
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, minVolume, 0)
                Toast.makeText(this, "Alarm volume cannot be lower than 70%!", Toast.LENGTH_SHORT).show()
                return true // true রিটার্ন করার মানে হলো বাটন প্রেসটা এখানেই ব্লক করে দেওয়া
            }
        }
        return super.onKeyDown(keyCode, event)
    }
    
    // 🌟 সাউন্ড আস্তে আস্তে বাড়ানোর ম্যাজিক ফাংশন
    private fun startVolumeFadeIn() {
        volumeAnimator?.cancel()
        // ০ থেকে শুরু হয়ে ১ (১০০%) পর্যন্ত যাবে
        volumeAnimator = ValueAnimator.ofFloat(0.1f, 1f).apply {
            duration = 10000 // ১৫ সেকেন্ড ধরে সাউন্ড বাড়বে
            addUpdateListener { animation ->
                val volume = animation.animatedValue as Float
                mediaPlayer?.setVolume(volume, volume)
            }
            start()
        }
    }

private fun playAlarmSound(customUriString: String?) {
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        
        audioManager.setStreamVolume(
            AudioManager.STREAM_ALARM,
            audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM),
            0
        )

        val cleanUriString = if (customUriString.isNullOrBlank() || customUriString == "null") null else customUriString

        mediaPlayer = MediaPlayer().apply {
            try {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )

                val rawId = resources.getIdentifier("default_alarm", "raw", packageName)
                
                // 🌟 FileDescriptor দিয়ে সাউন্ড ফিক্স: customUri না থাকলে সরাসরি raw ফাইল লোড হবে
                if (cleanUriString == null && rawId != 0) {
                    val afd = resources.openRawResourceFd(rawId)
                    setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    afd.close()
                } else {
                    val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    val uri: Uri = cleanUriString?.let { Uri.parse(it) } ?: defaultSoundUri
                    setDataSource(this@RingActivity, uri)
                }

                isLooping = true 
                setOnPreparedListener { mp ->
                    mp.setVolume(0.1f, 0.1f) 
                    mp.start()
                    startVolumeFadeIn() 
                }
                setOnErrorListener { _, _, _ ->
                    fallbackToBundledSound()
                    true
                }
                prepareAsync()
            } catch (e: Exception) {
                fallbackToBundledSound()
            }
        }
    }

    private fun fallbackToBundledSound() {
        try {
            mediaPlayer?.release()
            
            val fallbackUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) 
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            mediaPlayer = MediaPlayer().apply {
                // 🌟 আগে MediaPlayer.create ব্যবহার করায় Media ভলিউম পেতো, এখন বাধ্যতামূলক Alarm ভলিউম পাবে!
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM) 
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@RingActivity, fallbackUri!!)
                isLooping = true 
                prepare()
                setVolume(0.1f, 0.1f)
                start()
            }
            startVolumeFadeIn()
        } catch (_: Exception) {
        }
    }

    // 🎨 UI Design Code 
    private fun buildRootView(): View {
        val num1 = Random.nextInt(10, 50)
        val num2 = Random.nextInt(10, 50)
        val num3 = Random.nextInt(1, 10)
        correctAnswer = num1 + num2 + num3

        val quotes = listOf(
            "Wake up with determination. Go to bed with satisfaction.",
            "Today is a blank canvas. Paint a masterpiece.",
            "Your future is created by what you do today, not tomorrow.",
            "Rise up, start fresh, see the bright opportunity in each day.",
            "Success is the sum of small efforts, repeated day in and day out.",
            "Don't snooze your goals. Get up and grind!",
            "The early bird catches the worm. Be the early bird."
        )
        val randomQuote = quotes.random()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0F172A"))
            setPadding(60, 60, 60, 60)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            )
        }

        val iconText = TextView(this).apply {
            text = "⏰"
            textSize = 72f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 30)
        }

        val messageText = TextView(this).apply {
            text = intent.getStringExtra("message") ?: "Time to Wake Up!"
            textSize = 32f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 20)
        }

        val quoteText = TextView(this).apply {
            text = "\"$randomQuote\""
            textSize = 18f
            setTextColor(Color.parseColor("#94A3B8"))
            gravity = Gravity.CENTER
            setTypeface(null, Typeface.ITALIC)
            setPadding(0, 0, 0, 60)
            setLineSpacing(0f, 1.2f)
        }

        val challengeContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1E293B"))
                cornerRadius = 40f
            }
            setPadding(50, 60, 50, 60)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(20, 0, 20, 0) }
        }

        val puzzleText = TextView(this).apply {
            text = "Brain Test:\n$num1 + $num2 + $num3 = ?"
            textSize = 26f
            setTextColor(Color.parseColor("#F87171"))
            gravity = Gravity.CENTER
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 40)
        }

        val input = EditText(this).apply {
            hint = "Enter answer"
            setHintTextColor(Color.parseColor("#475569"))
            inputType = InputType.TYPE_CLASS_NUMBER
            textSize = 24f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0F172A"))
                cornerRadius = 20f
                setStroke(3, Color.parseColor("#334155"))
            }
            setPadding(30, 30, 30, 30)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, 40) }
        }

        val submitButton = Button(this).apply {
            text = "TURN OFF ALARM"
            textSize = 18f
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#10B981"))
                cornerRadius = 100f
            }
            setPadding(40, 40, 40, 40)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            elevation = 8f

            setOnClickListener {
                val userAnswer = input.text.toString().toIntOrNull()
                if (userAnswer != null && userAnswer == correctAnswer) {
                    Toast.makeText(this@RingActivity, "Good Morning! Have a great day. ☕", Toast.LENGTH_LONG).show()
                    stopAlarmAndFinish()
                } else {
                    Toast.makeText(this@RingActivity, "❌ Wrong answer! Wake up!", Toast.LENGTH_SHORT).show()
                    input.text.clear()
                }
            }
        }

        challengeContainer.addView(puzzleText)
        challengeContainer.addView(input)
        challengeContainer.addView(submitButton)

        root.addView(iconText)
        root.addView(messageText)
        root.addView(quoteText)
        root.addView(challengeContainer)

        return root
    }

    private fun stopAlarmAndFinish() {
        volumeAnimator?.cancel() // 🌟 অ্যালার্ম বন্ধ করার সময় ফেড-ইন অ্যানিমেশনও বন্ধ করতে হবে
        volumeAnimator = null
        try {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (_: Exception) {
        } finally {
            mediaPlayer = null
        }
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        volumeAnimator?.cancel()
        volumeAnimator = null
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {
        }
        mediaPlayer = null

        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
    }
}