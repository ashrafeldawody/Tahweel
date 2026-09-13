package com.tahweel.listener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = try {
            Telephony.Sms.Intents.getMessagesFromIntent(intent)
        } catch (e: Exception) {
            AppLog.e("sms", "could not read PDUs", e)
            return
        }
        if (messages == null || messages.isEmpty()) return

        val store = Store.get(context)
        var queued = 0
        for ((address, parts) in messages.groupBy { it.originatingAddress ?: "" }) {
            val body = parts.joinToString("") { it.messageBody ?: "" }
            val ts = parts.first().timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()
            val item = QueueItem(Fingerprint.of(address, body, ts), address, body, ts)
            if (store.enqueue(item)) queued += 1
            store.setStat("last_sms_at", ts.toString())
            AppLog.i("sms", "received from '$address' (${body.length} chars, ${parts.size} part(s))")
        }
        if (queued > 0) ForwarderService.start(context, "sms")
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        AppLog.i("boot", "received ${intent.action}")
        KeepAliveWorker.schedule(context)
        ForwarderService.start(context, "boot")
    }
}
