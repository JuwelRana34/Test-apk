package com.juwel522.myapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object FocusScheduler {

    // 🌟 Earned Emergency Pass Algorithm:
    // Complete lock sessions for 3 consecutive days without breaking -> +1 Emergency Pass (Max 5, Min 0)
    fun recordSuccessfulLockDay(context: Context) {
        val prefs = context.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)
        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val lastDate = prefs.getString("LAST_COMPLETED_DATE", "") ?: ""

        val totalCompleted = prefs.getInt("TOTAL_COMPLETED_SESSIONS", 0) + 1
        val editor = prefs.edit().putInt("TOTAL_COMPLETED_SESSIONS", totalCompleted)

        // Only count 1 streak day per calendar date
        if (lastDate != todayStr) {
            val yesterdayCal = Calendar.getInstance().apply { add(Calendar.DATE, -1) }
            val yesterdayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(yesterdayCal.time)

            var currentStreak = if (lastDate == yesterdayStr || lastDate.isEmpty()) {
                prefs.getInt("STREAK_DAYS", 0) + 1
            } else {
                1 // Missed a day, restart 3-day counter from 1
            }

            var currentPasses = prefs.getInt("EMERGENCY_PASSES", 0).coerceIn(0, 5)

            // Every 3 consecutive days -> +1 Emergency Pass (capped at maximum 5)
            if (currentStreak >= 3) {
                if (currentPasses < 5) {
                    currentPasses += 1
                }
                currentStreak = 0
            }

            editor.putInt("STREAK_DAYS", currentStreak)
                .putInt("EMERGENCY_PASSES", currentPasses)
                .putString("LAST_COMPLETED_DATE", todayStr)
        }

        editor.apply()
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