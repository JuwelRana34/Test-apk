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
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object FocusScheduler {

    // 🌟 Minimum 45 minutes daily lock required to earn +1 Streak Day toward the 99-Day Free Pro Reward!
    private const val MIN_VALID_LOCK_DURATION_MILLIS = (45 * 60 * 1000L) - 10_000L
    // Max Schedule Lock Duration = 15 Hours (900 minutes)
    const val MAX_SCHEDULE_DURATION_MILLIS = 15 * 60 * 60 * 1000L
    const val STREAK_TARGET_DAYS = 99
    private const val REWARD_PRO_DAYS_MILLIS = 7L * 24L * 60L * 60L * 1000L

    @Synchronized
    fun recordSuccessfulLockDay(context: Context, completedDurationMillis: Long) {
        val prefs = context.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val mainHandler = Handler(Looper.getMainLooper())

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

        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

        // Always record completed focus minutes (>= 15m) into COMPLETED_HISTORY_JSON for the 60-Day GitHub Heatmap Grid!
        val completedMins = (completedDurationMillis / 60000L).toInt().coerceAtLeast(1)
        val historyStr = prefs.getString("COMPLETED_HISTORY_JSON", "{}") ?: "{}"
        val historyObj = try {
            JSONObject(historyStr)
        } catch (_: Exception) {
            JSONObject()
        }
        val prevMinsToday = historyObj.optInt(todayStr, 0)
        val updatedTodayMins = prevMinsToday + completedMins
        historyObj.put(todayStr, updatedTodayMins)

        if (completedDurationMillis < MIN_VALID_LOCK_DURATION_MILLIS) {
            prefs.edit()
                .putString("COMPLETED_HISTORY_JSON", historyObj.toString())
                .commit()
            mainHandler.post {
                Toast.makeText(
                    context.applicationContext,
                    "ℹ️ লক শেষ হয়েছে! (৯৯ দিনের স্ট্রিক পেতে কমপক্ষে ৪৫ মিনিটের লক পূর্ণ করতে হবে)",
                    Toast.LENGTH_LONG
                ).show()
            }
            return
        }

        val lastDate = prefs.getString("LAST_COMPLETED_DATE", "") ?: ""

        if (lastDate.isNotEmpty() && todayStr <= lastDate) {
            prefs.edit()
                .putString("COMPLETED_HISTORY_JSON", historyObj.toString())
                .commit()
            mainHandler.post {
                Toast.makeText(
                    context.applicationContext,
                    "🎉 ৪৫+ মিনিট লক সম্পন্ন! (আজকের ১ স্ট্রিক আগেই যোগ হয়েছে)",
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

        var unlockedSevenDayPro = false
        val editor = prefs.edit()

        // 🌟 99-Day Consecutive Streak Reward: Unlock 7 Days of Free Toki Pro! (Passes are never given free via streak)
        if (currentStreak >= STREAK_TARGET_DAYS) {
            val now = System.currentTimeMillis()
            val currentProExpiry = prefs.getLong("PRO_EXPIRES_AT", 0L)
            val baseTime = maxOf(now, currentProExpiry)
            val newExpiry = baseTime + REWARD_PRO_DAYS_MILLIS

            editor.putBoolean("IS_PRO_USER", true)
            editor.putLong("PRO_EXPIRES_AT", newExpiry)
            editor.putString("PRO_PLAN_NAME", "99-Day Streak Reward (7 Days Free Pro)")
            currentStreak = 0
            unlockedSevenDayPro = true
        }

        editor
            .putInt("TOTAL_COMPLETED_SESSIONS", totalCompleted)
            .putInt("STREAK_DAYS", currentStreak)
            .putString("LAST_COMPLETED_DATE", todayStr)
            .putString("COMPLETED_HISTORY_JSON", historyObj.toString())
            .commit()

        val finalStreakCount = currentStreak
        mainHandler.post {
            if (unlockedSevenDayPro) {
                Toast.makeText(
                    context.applicationContext,
                    "👑 অভিনন্দন! টানা ৯৯ দিন লক পূর্ণ করায় আপনি ৭ দিনের Toki Pro ফ্রিতে পেয়েছেন!",
                    Toast.LENGTH_LONG
                ).show()
            } else {
                Toast.makeText(
                    context.applicationContext,
                    "🔥 আজকের স্ট্রিক সম্পন্ন! ($finalStreakCount/99 দিন • ৯৯ দিনে ৭ দিন ফ্রি Pro)",
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