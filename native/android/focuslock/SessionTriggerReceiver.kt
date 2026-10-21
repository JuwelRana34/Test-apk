package com.juwel522.myapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import java.util.Calendar

class SessionTriggerReceiver : BroadcastReceiver() {
    companion object {
        private const val CHANNEL_ID = "focus_schedule_channel"
        private const val NOTIF_ID = 523
    }

    override fun onReceive(context: Context, intent: Intent) {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "Jnuits:FocusSessionWakeLock"
        )
        wakeLock.acquire(5000L)

        val action = intent.action ?: intent.getStringExtra("ACTION_TYPE")
        val prefs = context.getSharedPreferences("FocusModePrefs", Context.MODE_PRIVATE)

        try {
            val calendar = Calendar.getInstance()
            val activeDaysArray = intent.getIntArrayExtra("ACTIVE_DAYS")
            val activeDays = activeDaysArray?.map { it.toString() }?.toSet()
                ?: prefs.getStringSet("ACTIVE_DAYS", emptySet()) ?: emptySet()

            val dayId = (calendar.get(Calendar.DAY_OF_WEEK) + 6) % 7

            if (action == "START_SESSION" && !activeDays.contains(dayId.toString())) return

            if (action == "START_SESSION") {
                val endHour = intent.getIntExtra("END_HOUR", prefs.getInt("END_HOUR", 14))
                val endMinute = intent.getIntExtra("END_MINUTE", prefs.getInt("END_MINUTE", 0))
                val lockMode = intent.getStringExtra("LOCK_MODE") ?: "SCHEDULE"

                val endCalendar = Calendar.getInstance().apply {
                    set(Calendar.HOUR_OF_DAY, endHour)
                    set(Calendar.MINUTE, endMinute)
                    set(Calendar.SECOND, 0)
                    set(Calendar.MILLISECOND, 0)
                    if (!after(calendar)) add(Calendar.DATE, 1)
                }

                val now = System.currentTimeMillis()
                val plannedDuration = (endCalendar.timeInMillis - now).coerceAtLeast(0L)

                prefs.edit()
                    .putBoolean("IS_SESSION_ACTIVE", true)
                    .putString("LOCK_MODE", lockMode)
                    .putLong("SESSION_START_TIME", now)
                    .putLong("SESSION_END_TIME", endCalendar.timeInMillis)
                    .putLong("SESSION_PLANNED_DURATION", plannedDuration)
                    .commit()

                FocusScheduler.scheduleAlarms(context)

                val mainIntent = Intent(context, MainActivity::class.java).apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                    putExtra("FROM_FOCUS_LOCK", true)
                }

                val fullScreenIntent = PendingIntent.getActivity(
                    context,
                    0,
                    mainIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                val notifManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val channel = NotificationChannel(
                        CHANNEL_ID,
                        "Focus Alarms",
                        NotificationManager.IMPORTANCE_HIGH
                    )
                    channel.setBypassDnd(true)
                    notifManager.createNotificationChannel(channel)
                }

                val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_lock_lock)
                    .setContentTitle("Strict Schedule Lock Active 🔒")
                    .setContentText("Your scheduled lock has started automatically.")
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setFullScreenIntent(fullScreenIntent, true)
                    .setAutoCancel(true)
                    .build()

                notifManager.notify(NOTIF_ID, notification)

                try {
                    context.startActivity(mainIntent)
                } catch (_: Exception) {}

                context.sendBroadcast(
                    Intent(FocusBlockerService.ACTION_REDIRECT_MAIN_APP)
                        .setPackage(context.packageName)
                )
            } else if (action == "END_SESSION") {
                val wasActive = prefs.getBoolean("IS_SESSION_ACTIVE", false)
                val startTime = prefs.getLong("SESSION_START_TIME", 0L)
                val plannedDuration = prefs.getLong("SESSION_PLANNED_DURATION", 0L)
                val now = System.currentTimeMillis()
                val actualElapsed = if (startTime > 0L) (now - startTime) else plannedDuration
                val completedDuration = minOf(
                    if (plannedDuration > 0L) plannedDuration else actualElapsed,
                    actualElapsed
                )

                prefs.edit()
                    .putBoolean("IS_SESSION_ACTIVE", false)
                    .remove("SESSION_END_TIME")
                    .remove("SESSION_START_TIME")
                    .remove("SESSION_PLANNED_DURATION")
                    .commit()

                if (wasActive) {
                    FocusScheduler.recordSuccessfulLockDay(context, completedDuration)
                }

                FocusScheduler.scheduleAlarms(context)

                val notifManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notifManager.cancel(NOTIF_ID)

                context.sendBroadcast(Intent("com.juwel522.myapp.CLOSE_LOCK_SCREEN"))
                context.sendBroadcast(
                    Intent(FocusBlockerService.ACTION_STOP_SESSION)
                        .setPackage(context.packageName)
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            if (wakeLock.isHeld) wakeLock.release()
        }
    }
}