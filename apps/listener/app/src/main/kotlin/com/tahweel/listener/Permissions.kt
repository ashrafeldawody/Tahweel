package com.tahweel.listener

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Permissions {
    const val REQUEST_SMS = 11
    const val REQUEST_NOTIFICATIONS = 12

    val smsPermissions = arrayOf(Manifest.permission.RECEIVE_SMS)

    fun hasSms(context: Context): Boolean =
        smsPermissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    fun hasNotifications(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
                NotificationManagerCompat.from(context).areNotificationsEnabled()
        } else {
            NotificationManagerCompat.from(context).areNotificationsEnabled()
        }

    fun ignoresBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun requestSms(activity: Activity) {
        ActivityCompat.requestPermissions(activity, smsPermissions, REQUEST_SMS)
    }

    fun requestNotifications(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        } else {
            openAppNotificationSettings(activity)
        }
    }

    fun requestIgnoreBatteryOptimizations(activity: Activity) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${activity.packageName}")
        }
        try {
            activity.startActivity(direct)
        } catch (_: ActivityNotFoundException) {
            try {
                activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: ActivityNotFoundException) {
                openAppDetails(activity)
            }
        }
    }

    fun openAppNotificationSettings(activity: Activity) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
        }
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            openAppDetails(activity)
        }
    }

    fun openAppDetails(activity: Activity) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${activity.packageName}")
        }
        activity.startActivity(intent)
    }

    fun openBackgroundSettings(activity: Activity) {
        val candidates = listOf(
            Intent().setClassName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
            Intent().setClassName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
            Intent().setClassName("com.samsung.android.sm_cn", "com.samsung.android.sm.ui.battery.BatteryActivity"),
            Intent("android.settings.BATTERY_SAVER_SETTINGS"),
        )
        for (intent in candidates) {
            try {
                if (intent.resolveActivity(activity.packageManager) != null) {
                    activity.startActivity(intent)
                    return
                }
            } catch (_: Exception) {
            }
        }
        openAppDetails(activity)
    }
}
