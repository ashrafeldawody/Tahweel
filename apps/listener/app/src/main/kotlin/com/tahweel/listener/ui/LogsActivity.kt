package com.tahweel.listener.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.tahweel.listener.AppLog
import com.tahweel.listener.BuildConfig
import com.tahweel.listener.Prefs
import com.tahweel.listener.Store
import com.tahweel.listener.databinding.ActivityLogsBinding

class LogsActivity : AppCompatActivity() {
    private lateinit var b: ActivityLogsBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityLogsBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.refreshBtn.setOnClickListener { render() }
        b.clearBtn.setOnClickListener {
            Store.get(this).clearLogs()
            AppLog.i("logs", "cleared by user")
            render()
        }
        b.shareBtn.setOnClickListener {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "Tahweel listener logs")
                putExtra(Intent.EXTRA_TEXT, report())
            }
            startActivity(Intent.createChooser(intent, "Share logs"))
        }
        b.copyBtn.setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("tahweel-listener logs", report()))
            Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun report(): String {
        val prefs = Prefs(this)
        val store = Store.get(this)
        val header = listOf(
            "app v${BuildConfig.VERSION_NAME}",
            "device ${prefs.deviceId} (${prefs.effectiveDeviceName()})",
            "server ${prefs.serverUrl}",
            "queued ${store.pendingCount()}",
            "last error ${store.stat("last_error") ?: "—"}",
            "",
        ).joinToString("\n")
        return header + AppLog.render(store.logs(500))
    }

    private fun render() {
        b.logText.text = AppLog.render(Store.get(this).logs(500)).ifBlank { "(no logs yet)" }
        b.scroll.post { b.scroll.fullScroll(android.view.View.FOCUS_DOWN) }
    }
}
