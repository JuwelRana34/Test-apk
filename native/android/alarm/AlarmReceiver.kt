package com.juwel522.myapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ringIntent = Intent(context, RingActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("message", intent.getStringExtra("message"))
            putExtra("soundUri", intent.getStringExtra("soundUri"))
        }
        context.startActivity(ringIntent)
    }
}