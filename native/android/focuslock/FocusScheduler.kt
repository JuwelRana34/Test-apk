package com.juwel522.myapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object FocusScheduler {

    // কমপক্ষে ৩০ মিনিটের লক পূর্ণ না হলে স্ট্রিক বাড়বে না (29m 50s threshold to allow slight alarm jitter)
    private const val MIN_VALID_LOCK_DURATION_MILLIS = (30 * 60 * 1000L) - 10_000L

    /**
     * 🌟 Earned Emergency Pass & Daily Streak Algorithm:
     * ১. লকের সময় কমপক্ষে ৩০ মিনিট (MIN_VALID_LOCK_DURATION_MILLIS) হতে হবে। ২ মিনিট বা ১ মিনিটের লকে স্ট্রিক বাড়বে না!
     * ২. একই দিনে (Same Calendar Date: yyyy-MM-dd) সর্বোচ্চ ১ বারই স্ট্রিক বাড়বে (দিনে ১০ বার লক করলেও ১ স্ট্রিকই যোগ হবে)।
     * ৩. টানা ৩ দিন সফলভাবে লক পূর্ণ করলে +1 Emergency Pass যোগ হবে (সর্বোচ্চ ৫টি, সর্বনিম্ন ০টি)।
     */
    @Synchronized
    fun recordSuccessfulLockDay(context: Context, completedDurationMillis: Long) {
        val prefs = context.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val mainHandler = Handler(Looper.getMainLooper())

        // শর্ত ১: কমপক্ষে ৩০ মিনিট পূর্ণ হয়েছে কি না চেক করো
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

        // শর্ত ২: আজকে যদি ইতিমধ্যেই ১ স্ট্রিক যোগ হয়ে থাকে, তবে আজ আর বাড়বে না!
        if (lastDate == todayStr) {
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
            1 // মাঝখানে দিন গ্যাপ গেলে আবার ১ থেকে শুরু
        }

        var currentPasses = prefs.getInt("EMERGENCY_PASSES", 0).coerceIn(0, 5)
        var earnedNewPass = false

        // টানা ৩ দিন পূর্ণ হলে +1 Emergency Pass (সর্বোচ্চ ৫টি)
        if (currentStreak >= 3) {
            if (currentPasses < 5) {
                currentPasses += 1
                earnedNewPass = true
            }
            currentStreak = 0
        }

        // Synchronous commit() যাতে সাথে সাথে ডিস্কে সেভ হয় এবং ডাবল কাউন্ট না হয়
        prefs.edit()
            .putInt("TOTAL_COMPLETED_SESSIONS", totalCompleted)
            .putInt("STREAK_DAYS", currentStreak)
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