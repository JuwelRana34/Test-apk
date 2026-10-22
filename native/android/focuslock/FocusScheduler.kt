package com.juwel522.myapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object FocusScheduler {

    private const val MIN_VALID_LOCK_DURATION_MILLIS = (30 * 60 * 1000L) - 10_000L

    /**
     * 🌟 Anti-Cheat Earned Emergency Pass & Daily Streak Engine:
     * ১. ফোনের Automatic Date & Time (Settings.Global.AUTO_TIME) অন থাকতে হবে—হাত দিয়ে তারিখ পাল্টালে স্ট্রিক যোগ হবে না!
     * ২. হার্ডওয়্যার ঘড়ি ও আসল সময় অনুযায়ী কমপক্ষে ৩০ মিনিটের লক পূর্ণ হতে হবে।
     * ৩. একই তারিখে সর্বোচ্চ ১টি স্ট্রিক যোগ হবে।
     * ৪. টানা ৩ দিন পূর্ণ হলে TOTAL_PASSES_EARNED বাড়বে এবং অ্যাপ থেকে বের হলেও চিরস্থায়ীভাবে সেভ থাকবে।
     */
    @Synchronized
    fun recordSuccessfulLockDay(context: Context, completedDurationMillis: Long) {
        val prefs = context.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val mainHandler = Handler(Looper.getMainLooper())

        // Anti-Cheat 1: Check if user disabled Automatic Date & Time in phone settings
        val isAutoTimeEnabled = try {
            Settings.Global.getInt(context.contentResolver, Settings.Global.AUTO_TIME, 1) == 1
        } catch (_: Exception) {
            true
        }

        if (!isAutoTimeEnabled) {
            mainHandler.post {
                Toast.makeText(
                    context.applicationContext,
                    "⚠️ স্ট্রিক পেতে ফোনের Automatic Date & Time অন রাখুন!",
                    Toast.LENGTH_LONG
                ).show()
            }
            return
        }

        // Anti-Cheat 2: Must complete at least 30 minutes (verified against monotonic hardware clock)
        if (completedDurationMillis < MIN_VALID_LOCK_DURATION_MILLIS) {
            mainHandler.post {
                Toast.makeText(
                    context.applicationContext,
                    "ℹ️ লক শেষ হয়েছে! (১ স্ট্রিক পেতে কমপক্ষে ৩০ মিনিটের লক পূর্ণ করতে হবে)",
                    Toast.LENGTH_LONG
                ).show()
            }
            return
        }

        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val lastDate = prefs.getString("LAST_COMPLETED_DATE", "") ?: ""

        // Anti-Cheat 3: Prevent backwards date travel or duplicate streak on the same day
        if (lastDate.isNotEmpty() && todayStr <= lastDate) {
            mainHandler.post {
                Toast.makeText(
                    context.applicationContext,
                    "🎉 লক সম্পন্ন! (আজকের ১ স্ট্রিক আগেই যোগ হয়েছে)",
                    Toast.LENGTH_SHORT
                ).show()
            }
            return
        }

        val totalCompleted = prefs.getInt("TOTAL_COMPLETED_SESSIONS", 0) + 1
        val yesterdayCal = Calendar.getInstance().apply { add(Calendar.DATE, -1) }
        val yesterdayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(yesterdayCal.time)

        var currentStreak = if (lastDate == yesterdayStr || lastDate.isEmpty()) {
            prefs.getInt("STREAK_DAYS", 0) + 1
        } else {
            1
        }

        var totalEarned = prefs.getInt("TOTAL_PASSES_EARNED", prefs.getInt("EMERGENCY_PASSES", 0))
        val totalUsed = prefs.getInt("TOTAL_PASSES_USED", 0)
        var currentPasses = (totalEarned - totalUsed).coerceIn(0, 5)
        var earnedNewPass = false

        if (currentStreak >= 3) {
            if (currentPasses < 5) {
                totalEarned += 1
                currentPasses = (totalEarned - totalUsed).coerceIn(0, 5)
                earnedNewPass = true
            }
            currentStreak = 0
        }

        prefs.edit()
            .putInt("TOTAL_COMPLETED_SESSIONS", totalCompleted)
            .putInt("STREAK_DAYS", currentStreak)
            .putInt("TOTAL_PASSES_EARNED", totalEarned)
            .putInt("TOTAL_PASSES_USED", totalUsed)
            .putInt("EMERGENCY_PASSES", currentPasses)
            .putString("LAST_COMPLETED_DATE", todayStr)
            .commit()

        val finalPassCount = currentPasses
        val finalStreakCount = currentStreak
        mainHandler.post {
            if (earnedNewPass) {
                Toast.makeText(
                    context.applicationContext,
                    "🎟️ অভিনন্দন! টানা ৩ দিন লক পূর্ণ করায় +1 Emergency Pass পেয়েছেন! (মোট: $finalPassCount/5)",
                    Toast.LENGTH_LONG
                ).show()
            } else {
                Toast.makeText(
                    context.applicationContext,
                    "🔥 আজকের স্ট্রিক সম্পন্ন! ($finalStreakCount/3 দিন)",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    fun cancelSessionAlarms(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val endIntent = Intent(context, SessionTriggerReceiver::class.java).apply { action = "END_SESSION" }
        val endPending = PendingIntent.getBroadcast(
            context,
            1003,
            endIntent,
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(endPending)
        scheduleAlarms(context)
    }

    fun scheduleAlarms(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val prefs = context.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)

        for (i in 0..10) {
            val startIntent = Intent(context, SessionTriggerReceiver::class.java).apply { action = "START_SESSION" }
            val startPending = PendingIntent.getBroadcast(
                context,
                1000 + i,
                startIntent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (startPending != null) {
                alarmManager.cancel(startPending)
                startPending.cancel()
            }

            val endIntent = Intent(context, SessionTriggerReceiver::class.java).apply { action = "END_SESSION" }
            val endPending = PendingIntent.getBroadcast(
                context,
                2000 + i,
                endIntent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (endPending != null) {
                alarmManager.cancel(endPending)
                endPending.cancel()
            }
        }

        val isGlobalEnabled = prefs.getBoolean("SCHEDULE_ENABLED", false)
        if (!isGlobalEnabled) return

        val schedulesJsonStr = prefs.getString("MULTI_SCHEDULES_JSON", "[]")
        if (schedulesJsonStr == "[]") return

        val showIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        try {
            val schedulesArray = JSONArray(schedulesJsonStr)
            val canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

            for (i in 0 until schedulesArray.length()) {
                val schedule = schedulesArray.getJSONObject(i)
                if (!schedule.getBoolean("isEnabled")) continue

                val startHour = schedule.getInt("startHour")
                val startMinute = schedule.getInt("startMinute")
                val endHour = schedule.getInt("endHour")
                val endMinute = schedule.getInt("endMinute")

                val activeDaysArr = schedule.getJSONArray("activeDays")
                val activeDays = IntArray(activeDaysArr.length()) { activeDaysArr.getInt(it) }

                val startCalendar = Calendar.getInstance().apply {
                    set(Calendar.HOUR_OF_DAY, startHour)
                    set(Calendar.MINUTE, startMinute)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                    if (before(Calendar.getInstance())) add(Calendar.DATE, 1)
                }

                val startIntent = Intent(context, SessionTriggerReceiver::class.java).apply {
                    action = "START_SESSION"
                    putExtra("END_HOUR", endHour)
                    putExtra("END_MINUTE", endMinute)
                    putExtra("ACTIVE_DAYS", activeDays)
                    putExtra("LOCK_MODE", "SCHEDULE")
                }
                val startPending = PendingIntent.getBroadcast(
                    context,
                    1000 + i,
                    startIntent,
                    PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                val endCalendar = Calendar.getInstance().apply {
                    set(Calendar.HOUR_OF_DAY, endHour)
                    set(Calendar.MINUTE, endMinute)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                    if (before(Calendar.getInstance())) add(Calendar.DATE, 1)
                }

                val endIntent = Intent(context, SessionTriggerReceiver::class.java).apply { action = "END_SESSION" }
                val endPending = PendingIntent.getBroadcast(
                    context,
                    2000 + i,
                    endIntent,
                    PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                if (canScheduleExact) {
                    alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(startCalendar.timeInMillis, showIntent), startPending)
                    alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(endCalendar.timeInMillis, showIntent), endPending)
                } else {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, startCalendar.timeInMillis, startPending)
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endCalendar.timeInMillis, endPending)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}