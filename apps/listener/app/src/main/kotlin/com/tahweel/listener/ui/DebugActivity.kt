package com.tahweel.listener.ui

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.tahweel.listener.Api
import com.tahweel.listener.AppLog
import com.tahweel.listener.Fingerprint
import com.tahweel.listener.IngestResult
import com.tahweel.listener.QueueItem
import com.tahweel.listener.Store
import com.tahweel.listener.databinding.ActivityDebugBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DebugActivity : AppCompatActivity() {
    private lateinit var b: ActivityDebugBinding
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityDebugBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.sendCustomBtn.setOnClickListener { sendCustom() }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun sendCustom() {
        val address = b.customAddress.text?.toString()?.trim().orEmpty().ifBlank { "e& money" }
        val body = b.customBody.text?.toString()?.trim().orEmpty()
        if (body.isBlank()) {
            Toast.makeText(this, "Enter a message body", Toast.LENGTH_SHORT).show()
            return
        }
        val now = System.currentTimeMillis()
        post(QueueItem(Fingerprint.of(address, body, now), address, body, now))
    }

    private fun post(item: QueueItem) {
        b.sendCustomBtn.isEnabled = false
        scope.launch {
            val outcome = withContext(Dispatchers.IO) {
                try {
                    Result.success(Api(this@DebugActivity).postSms(listOf(item)))
                } catch (e: Exception) {
                    Result.failure(e)
                }
            }
            b.sendCustomBtn.isEnabled = true
            outcome.fold(
                onSuccess = { result ->
                    val r = result.results.firstOrNull { it.fingerprint == item.fingerprint }
                    Store.get(this@DebugActivity).markSent(listOf(item.fingerprint), r?.status ?: "accepted")
                    AppLog.i("debug", "custom sent: created ${result.created}, matched ${result.matched}")
                    showResult(result)
                },
                onFailure = { e ->
                    AppLog.e("debug", "custom send failed", e)
                    AlertDialog.Builder(this@DebugActivity)
                        .setTitle("Send failed")
                        .setMessage(e.message ?: e.javaClass.simpleName)
                        .setPositiveButton("OK", null)
                        .show()
                },
            )
        }
    }

    private fun showResult(result: IngestResult) {
        val lines = ArrayList<String>()
        lines.add("accepted: ${result.accepted.size}, new: ${result.created}, matched now: ${result.matched}")
        for (r in result.results) {
            lines.add("")
            lines.add("status: ${r.status}")
            lines.add("parsed as receipt: ${r.parsed}")
            if (r.wallet != null) lines.add("wallet: ${r.wallet}")
            if (r.amountCents != null) lines.add("amount: ${r.amountCents / 100.0} EGP")
            if (r.senderPhone != null) lines.add("from: ${r.senderPhone}")
            if (r.note != null) lines.add("note: ${r.note}")
        }
        if (result.results.isEmpty()) {
            lines.add("")
            lines.add(result.raw)
        }
        AlertDialog.Builder(this)
            .setTitle("Server response")
            .setMessage(lines.joinToString("\n"))
            .setPositiveButton("OK", null)
            .show()
    }
}
