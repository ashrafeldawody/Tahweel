package com.tahweel.listener

import android.content.Context
import android.os.Build
import android.provider.Settings

class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("tahweel-listener", Context.MODE_PRIVATE)
    private val appContext = context.applicationContext

    var serverUrl: String
        get() = sp.getString("server_url", "")?.trimEnd('/') ?: ""
        set(value) = sp.edit().putString("server_url", value.trim().trimEnd('/')).apply()

    var token: String
        get() = sp.getString("token", "") ?: ""
        set(value) = sp.edit().putString("token", value.trim()).apply()

    var deviceName: String
        get() = sp.getString("device_name", "") ?: ""
        set(value) = sp.edit().putString("device_name", value.trim()).apply()

    val deviceId: String
        get() {
            val existing = sp.getString("device_id", null)
            if (existing != null) return existing
            val android = Settings.Secure.getString(appContext.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"
            val id = "${Build.MODEL.replace(' ', '-').lowercase()}-${android.takeLast(6)}"
            sp.edit().putString("device_id", id).apply()
            return id
        }

    val configured: Boolean
        get() = serverUrl.startsWith("http") && token.isNotBlank()

    fun effectiveDeviceName(): String = deviceName.ifBlank { "${Build.MANUFACTURER} ${Build.MODEL}" }
}
