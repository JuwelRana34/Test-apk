package com.juwel522.myapp

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast

class LockdownAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Toast.makeText(context, "Strict Focus Mode Secured \uD83D\uDEE1\uFE0F", Toast.LENGTH_SHORT).show()
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        // কেউ আনইনস্টল বা ডিসেবল করতে চাইলে এই ওয়ার্নিং দেখাবে
        return "Focus session is active! You cannot disable this right now."
    }
}