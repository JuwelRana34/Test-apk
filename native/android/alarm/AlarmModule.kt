// package com.juwel522.myapp

// import android.app.AlarmManager
// import android.app.PendingIntent
// import android.content.ComponentName
// import android.content.Context
// import android.content.Intent
// import android.content.pm.PackageManager
// import android.net.Uri
// import android.os.Build
// import android.provider.Settings
// import com.facebook.react.bridge.ReactApplicationContext
// import com.facebook.react.bridge.ReactContextBaseJavaModule
// import com.facebook.react.bridge.ReactMethod

// class AlarmModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

//     override fun getName(): String {
//         return "AlarmModule"
//     }

//     @ReactMethod
//     fun setAlarm(timeInMillis: Double, message: String, soundUri: String?) {
//         val context = reactApplicationContext
//         val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

//         val intent = Intent(context, RingActivity::class.java).apply {
//             flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
//             putExtra("message", message)
//             putExtra("soundUri", soundUri)
//         }

//         val pendingIntent = PendingIntent.getActivity(
//             context,
//             1001, 
//             intent,
//             PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
//         )

//         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
//             val alarmClockInfo = AlarmManager.AlarmClockInfo(timeInMillis.toLong(), pendingIntent)
//             alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)
//         } else {
//             alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timeInMillis.toLong(), pendingIntent)
//         }
//     }

//     @ReactMethod
//     fun cancelAlarm() {
//         val context = reactApplicationContext
//         val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

//         val intent = Intent(context, RingActivity::class.java).apply {
//             flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
//         }
        
//         val pendingIntent = PendingIntent.getActivity(
//             context,
//             1001,
//             intent,
//             PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
//         )
        
//         alarmManager.cancel(pendingIntent)
//     }

//     // 🌟 ব্যাটারি সেভার সেটিংসে নিয়ে যাওয়ার ফাংশন
//     @ReactMethod
//     fun openBatterySettings() {
//         val context = reactApplicationContext
//         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
//             try {
//                 val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
//                 intent.data = Uri.parse("package:${context.packageName}")
//                 intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
//                 context.startActivity(intent)
//             } catch (e: Exception) {
//                 fallbackToAppSettings(context)
//             }
//         }
//     }

//     // 🌟 ফোনের ব্র্যান্ড অনুযায়ী Autostart সেটিংসে নিয়ে যাওয়ার ফাংশন
//     @ReactMethod
//     fun openAutostartSettings() {
//         val context = reactApplicationContext
//         try {
//             val intent = Intent()
//             val manufacturer = Build.MANUFACTURER.lowercase()

//             when {
//                 manufacturer.contains("xiaomi") || manufacturer.contains("poco") || manufacturer.contains("redmi") -> 
//                     intent.component = ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
//                 manufacturer.contains("oppo") || manufacturer.contains("realme") -> 
//                     intent.component = ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
//                 manufacturer.contains("vivo") -> 
//                     intent.component = ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
//                 manufacturer.contains("huawei") || manufacturer.contains("honor") -> 
//                     intent.component = ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
//                 manufacturer.contains("samsung") -> 
//                     intent.component = ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")
//                 else -> {
//                     fallbackToAppSettings(context)
//                     return
//                 }
//             }
            
//             intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
//             val list = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            
//             if (list.isNotEmpty()) {
//                 context.startActivity(intent)
//             } else {
//                 fallbackToAppSettings(context)
//             }
//         } catch (e: Exception) {
//             fallbackToAppSettings(context)
//         }
//     }

//     // যদি কোনো কারণে স্পেসিফিক সেটিংস না পাওয়া যায়, তবে সাধারণ App Info পেজে নিয়ে যাবে
//     private fun fallbackToAppSettings(context: Context) {
//         val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
//         intent.data = Uri.parse("package:${context.packageName}")
//         intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
//         context.startActivity(intent)
//     }
// }




package com.juwel522.myapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class AlarmModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "AlarmModule"
    }

    @ReactMethod
    fun setAlarm(timeInMillis: Double, message: String, soundUri: String?) {
        val context = reactApplicationContext
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val intent = Intent(context, RingActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("message", message)
            putExtra("soundUri", soundUri)
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            1001, 
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            val alarmClockInfo = AlarmManager.AlarmClockInfo(timeInMillis.toLong(), pendingIntent)
            alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)
        } else {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timeInMillis.toLong(), pendingIntent)
        }
    }

    @ReactMethod
    fun cancelAlarm() {
        val context = reactApplicationContext
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val intent = Intent(context, RingActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        
        val pendingIntent = PendingIntent.getActivity(
            context,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        alarmManager.cancel(pendingIntent)
    }

    // 🌟 ১. Display Over Other Apps (Overlay) পারমিশন পেজে নিয়ে যাওয়ার ফাংশন
    @ReactMethod
    fun requestOverlayPermission() {
        val context = reactApplicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(context)) {
                val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                context.startActivity(intent)
            }
        }
    }

    // 🌟 ২. Auto Launch (Autostart) সেটিংসে নিয়ে যাওয়ার ফাংশন
    @ReactMethod
    fun openAutostartSettings() {
        val context = reactApplicationContext
        try {
            val intent = Intent()
            val manufacturer = Build.MANUFACTURER.lowercase()

            when {
                manufacturer.contains("xiaomi") || manufacturer.contains("poco") || manufacturer.contains("redmi") -> 
                    intent.component = ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
                manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") -> 
                    intent.component = ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
                manufacturer.contains("vivo") -> 
                    intent.component = ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
                manufacturer.contains("huawei") || manufacturer.contains("honor") -> 
                    intent.component = ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
                manufacturer.contains("samsung") -> 
                    intent.component = ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")
                else -> {
                    fallbackToAppSettings(context)
                    return
                }
            }
            
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            val list = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            
            if (list.isNotEmpty()) {
                context.startActivity(intent)
            } else {
                fallbackToAppSettings(context)
            }
        } catch (e: Exception) {
            fallbackToAppSettings(context)
        }
    }

    // 🌟 পারমিশন চেক করার ফাংশন
    @ReactMethod
    fun checkOverlayPermission(promise: Promise) {
        val context = reactApplicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            promise.resolve(Settings.canDrawOverlays(context))
        } else {
            promise.resolve(true)
        }
    }

    private fun fallbackToAppSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        intent.data = Uri.parse("package:${context.packageName}")
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        context.startActivity(intent)
    }
}