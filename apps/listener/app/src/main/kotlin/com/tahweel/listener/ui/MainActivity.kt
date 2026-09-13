package com.tahweel.listener.ui

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.tahweel.listener.AppLog
import com.tahweel.listener.BuildConfig
import com.tahweel.listener.Clock
import com.tahweel.listener.ForwarderService
import com.tahweel.listener.Inbox
import com.tahweel.listener.Permissions
import com.tahweel.listener.Prefs
import com.tahweel.listener.R
import com.tahweel.listener.Store
import com.tahweel.listener.Uploader
import com.tahweel.listener.databinding.ActivityMainBinding
import com.tahweel.listener.databinding.RowPermissionBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private lateinit var prefs: Prefs
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 5_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        prefs = Prefs(this)
        title = "${getString(R.string.app_name)} v${BuildConfig.VERSION_NAME}"

        b.serverUrl.setText(prefs.serverUrl)
        b.token.setText(prefs.token)
        b.deviceName.setText(prefs.effectiveDeviceName())

        b.saveBtn.setOnClickListener { save() }
        b.testBtn.setOnClickListener { save(); testConnection() }
        b.startServiceBtn.setOnClickListener {
            ForwarderService.start(this, "manual")
            toast("Service start requested")
            handler.postDelayed({ renderStatus() }, 800)
        }
        b.importBtn.setOnClickListener { importInbox() }
        b.debugBtn.setOnClickListener { startActivity(Intent(this, DebugActivity::class.java)) }
        b.logsBtn.setOnClickListener { startActivity(Intent(this, LogsActivity::class.java)) }
        b.grantAllBtn.setOnClickListener { grantNext() }

        bindPermissionRow(b.permSms, R.string.perm_sms) { Permissions.requestSms(this) }
        bindPermissionRow(b.permNotifications, R.string.perm_notifications) { Permissions.requestNotifications(this) }
        bindPermissionRow(b.permBattery, R.string.perm_battery) { Permissions.requestIgnoreBatteryOptimizations(this) }
        bindPermissionRow(b.permBackground, R.string.perm_background, openLabel = true) { Permissions.openBackgroundSettings(this) }
    }

    override fun onResume() {
        super.onResume()
        renderPermissions()
        renderStatus()
        handler.postDelayed(refresh, 5_000)
        if (prefs.configured && Permissions.hasSms(this)) ForwarderService.start(this, "activity")
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        renderPermissions()
        AppLog.i("perm", "request $requestCode → ${grantResults.joinToString()}")
        if (requestCode == Permissions.REQUEST_SMS && Permissions.hasSms(this) && prefs.configured) {
            ForwarderService.start(this, "permission")
        }
    }

    private fun bindPermissionRow(row: RowPermissionBinding, label: Int, openLabel: Boolean = false, action: () -> Unit) {
        row.permLabel.setText(label)
        row.permBtn.setText(if (openLabel) R.string.btn_open else R.string.btn_grant)
        row.permBtn.setOnClickListener { action() }
    }

    private fun renderPermissions() {
        setRow(b.permSms, Permissions.hasSms(this))
        setRow(b.permNotifications, Permissions.hasNotifications(this))
        setRow(b.permBattery, Permissions.ignoresBatteryOptimizations(this))
        setRow(b.permBackground, null)
    }

    private fun setRow(row: RowPermissionBinding, ok: Boolean?) {
        val color = when (ok) {
            true -> R.color.ok
            false -> R.color.bad
            null -> R.color.muted
        }
        row.permDot.setTextColor(ContextCompat.getColor(this, color))
    }

    private fun grantNext() {
        when {
            !Permissions.hasSms(this) -> Permissions.requestSms(this)
            !Permissions.hasNotifications(this) -> Permissions.requestNotifications(this)
            !Permissions.ignoresBatteryOptimizations(this) -> Permissions.requestIgnoreBatteryOptimizations(this)
            else -> {
                toast("Core permissions granted — now check the Samsung background settings")
                Permissions.openBackgroundSettings(this)
            }
        }
    }

    private fun save() {
        prefs.serverUrl = b.serverUrl.text?.toString() ?: ""
        prefs.token = b.token.text?.toString() ?: ""
        prefs.deviceName = b.deviceName.text?.toString() ?: ""
        AppLog.i("ui", "settings saved (server=${prefs.serverUrl}, device=${prefs.deviceId})")
        toast("Saved")
        if (prefs.configured) ForwarderService.start(this, "settings")
        renderStatus()
    }

    private fun testConnection() {
        b.testBtn.isEnabled = false
        scope.launch {
            val result = withContext(Dispatchers.IO) { Uploader.heartbeat(this@MainActivity) }
            b.testBtn.isEnabled = true
            result.fold(
                onSuccess = { toast("Connected — server time $it") },
                onFailure = { toast("Failed: ${it.message}") },
            )
            renderStatus()
        }
    }

    private fun importInbox() {
        if (!Permissions.hasSms(this)) {
            Permissions.requestSms(this)
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Import inbox?")
            .setMessage("Uploads the last 200 messages already on this phone. The server keeps them for the record but only auto-matches receipts newer than its max-age setting (default 48 hours); older ones are stored as stale. Use this after downtime, not as a test.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Import") { _, _ -> runImport() }
            .show()
    }

    private fun runImport() {
        b.importBtn.isEnabled = false
        scope.launch {
            val queued = withContext(Dispatchers.IO) { Inbox.enqueueAll(this@MainActivity, 200) }
            b.importBtn.isEnabled = true
            toast("Queued $queued new message(s)")
            renderStatus()
        }
    }

    private fun renderStatus() {
        val store = Store.get(this)
        b.serviceState.text = if (ForwarderService.running) "Running" else "Not running"
        b.serviceState.setTextColor(ContextCompat.getColor(this, if (ForwarderService.running) R.color.ok else R.color.bad))
        fun at(key: String): String = store.stat(key)?.toLongOrNull()?.let { Clock.local(it) } ?: "—"
        b.statusText.text = listOf(
            "device id      : ${prefs.deviceId}",
            "configured     : ${prefs.configured}",
            "queued         : ${store.pendingCount()}",
            "last sms       : ${at("last_sms_at")}",
            "last upload    : ${at("last_upload_at")} ${store.stat("last_upload_result") ?: ""}",
            "last heartbeat : ${at("last_heartbeat_at")} ${store.stat("last_heartbeat_result") ?: ""}",
            "last error     : ${store.stat("last_error") ?: "—"}",
        ).joinToString("\n")
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
