package com.tahweel.listener.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.tahweel.listener.Api
import com.tahweel.listener.AppLog
import com.tahweel.listener.Clock
import com.tahweel.listener.Fingerprint
import com.tahweel.listener.Inbox
import com.tahweel.listener.InboxSms
import com.tahweel.listener.IngestResult
import com.tahweel.listener.Permissions
import com.tahweel.listener.QueueItem
import com.tahweel.listener.Store
import com.tahweel.listener.databinding.ActivityDebugBinding
import com.tahweel.listener.databinding.ItemSmsBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class DebugActivity : AppCompatActivity() {
    private lateinit var b: ActivityDebugBinding
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val adapter = SmsAdapter { sendItem(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityDebugBinding.inflate(layoutInflater)
        setContentView(b.root)
        b.list.layoutManager = LinearLayoutManager(this)
        b.list.adapter = adapter
        b.sendCustomBtn.setOnClickListener { sendCustom() }
    }

    override fun onResume() {
        super.onResume()
        loadInbox()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun loadInbox() {
        if (!Permissions.hasSms(this)) {
            b.inboxHint.text = "SMS permission missing — grant it on the main screen."
            Permissions.requestSms(this)
            return
        }
        scope.launch {
            val store = Store.get(this@DebugActivity)
            val rows = withContext(Dispatchers.IO) {
                Inbox.read(this@DebugActivity, 100).map { sms ->
                    val fp = sms.fingerprint
                    val sent = store.sentRecord(fp)
                    val status = when {
                        sent != null -> "sent ${Clock.local(sent.sentAtMs)} → ${sent.result}"
                        store.isQueued(fp) -> "queued, waiting for upload"
                        else -> "not sent"
                    }
                    SmsRow(sms, status)
                }
            }
            adapter.submit(rows)
            b.inboxHint.text = "Inbox: last ${rows.size} messages. Tap Send to push one to the server now and see how it was parsed."
        }
    }

    private fun sendItem(row: SmsRow) {
        val item = QueueItem(row.sms.fingerprint, row.sms.address, row.sms.body, row.sms.dateMs)
        post(listOf(item), "inbox #${row.sms.id}")
    }

    private fun sendCustom() {
        val address = b.customAddress.text?.toString()?.trim().orEmpty().ifBlank { "e& money" }
        val body = b.customBody.text?.toString()?.trim().orEmpty()
        if (body.isBlank()) {
            Toast.makeText(this, "Enter a message body", Toast.LENGTH_SHORT).show()
            return
        }
        val now = System.currentTimeMillis()
        post(listOf(QueueItem(Fingerprint.of(address, body, now), address, body, now)), "custom")
    }

    private fun post(items: List<QueueItem>, label: String) {
        scope.launch {
            val outcome = withContext(Dispatchers.IO) {
                try {
                    Result.success(Api(this@DebugActivity).postSms(items))
                } catch (e: Exception) {
                    Result.failure(e)
                }
            }
            outcome.fold(
                onSuccess = { result ->
                    val store = Store.get(this@DebugActivity)
                    for (item in items) {
                        val r = result.results.firstOrNull { it.fingerprint == item.fingerprint }
                        store.markSent(listOf(item.fingerprint), r?.status ?: "accepted")
                    }
                    AppLog.i("debug", "$label sent: created ${result.created}, matched ${result.matched}")
                    showResult(result)
                    loadInbox()
                },
                onFailure = { e ->
                    AppLog.e("debug", "$label send failed", e)
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

data class SmsRow(val sms: InboxSms, val status: String)

class SmsAdapter(private val onSend: (SmsRow) -> Unit) : RecyclerView.Adapter<SmsAdapter.Holder>() {
    private var rows: List<SmsRow> = emptyList()

    fun submit(next: List<SmsRow>) {
        rows = next
        notifyDataSetChanged()
    }

    class Holder(val b: ItemSmsBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
        Holder(ItemSmsBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount(): Int = rows.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val row = rows[position]
        holder.b.smsHeader.text = "${row.sms.address} · ${Clock.local(row.sms.dateMs)}"
        holder.b.smsBody.text = row.sms.body
        holder.b.smsStatus.text = row.status
        holder.b.smsSendBtn.setOnClickListener { onSend(row) }
    }
}
