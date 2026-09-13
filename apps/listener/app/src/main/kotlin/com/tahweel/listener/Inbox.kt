package com.tahweel.listener

import android.content.Context
import android.provider.Telephony

data class InboxSms(
    val id: Long,
    val address: String,
    val body: String,
    val dateMs: Long,
) {
    val fingerprint: String get() = Fingerprint.of(address, body, dateMs)
}

object Inbox {
    fun read(context: Context, limit: Int): List<InboxSms> {
        val out = ArrayList<InboxSms>()
        val projection = arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
        )
        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            projection,
            null,
            null,
            "${Telephony.Sms.DATE} DESC LIMIT $limit",
        )?.use { c ->
            val idIdx = c.getColumnIndexOrThrow(Telephony.Sms._ID)
            val addrIdx = c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIdx = c.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIdx = c.getColumnIndexOrThrow(Telephony.Sms.DATE)
            while (c.moveToNext()) {
                out.add(
                    InboxSms(
                        id = c.getLong(idIdx),
                        address = c.getString(addrIdx) ?: "",
                        body = c.getString(bodyIdx) ?: "",
                        dateMs = c.getLong(dateIdx),
                    )
                )
            }
        }
        return out
    }

    fun enqueueAll(context: Context, limit: Int): Int {
        val store = Store.get(context)
        var queued = 0
        for (sms in read(context, limit)) {
            if (store.enqueue(QueueItem(sms.fingerprint, sms.address, sms.body, sms.dateMs))) queued += 1
        }
        AppLog.i("inbox", "import: queued $queued of last $limit")
        if (queued > 0) ForwarderService.start(context, "import")
        return queued
    }
}
