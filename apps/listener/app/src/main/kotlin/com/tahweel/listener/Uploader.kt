package com.tahweel.listener

import android.content.Context

data class DrainOutcome(val sent: Int, val failed: Int, val remaining: Int, val error: String?)

object Uploader {
    private const val BATCH = 50

    fun drain(context: Context): DrainOutcome {
        val store = Store.get(context)
        val api = Api(context)
        var sent = 0
        var failed = 0
        var lastError: String? = null
        while (true) {
            val batch = store.pending(BATCH)
            if (batch.isEmpty()) break
            try {
                val result = api.postSms(batch)
                val accepted = result.accepted.toSet()
                val ok = batch.filter { it.fingerprint in accepted }
                val notAccepted = batch.filter { it.fingerprint !in accepted }
                val summary = result.results.associateBy { it.fingerprint }
                for (item in ok) {
                    val row = summary[item.fingerprint]
                    store.markSent(listOf(item.fingerprint), row?.let { "${it.status}${if (it.amountCents != null) " ${it.amountCents / 100.0} EGP" else ""}${if (it.senderPhone != null) " from ${it.senderPhone}" else ""}" } ?: "accepted")
                }
                if (notAccepted.isNotEmpty()) {
                    store.markFailed(notAccepted.map { it.fingerprint }, "not_accepted")
                    failed += notAccepted.size
                }
                sent += ok.size
                store.setStat("last_upload_at", System.currentTimeMillis().toString())
                store.setStat("last_upload_result", "sent ${ok.size}, created ${result.created}, matched ${result.matched}")
                AppLog.i("upload", "sent ${ok.size}/${batch.size} (created ${result.created}, matched ${result.matched})")
                if (notAccepted.isNotEmpty()) break
            } catch (e: ApiException) {
                lastError = e.code
                store.markFailed(batch.map { it.fingerprint }, e.code)
                store.setStat("last_error", "${Clock.local(System.currentTimeMillis())} upload: ${e.message}")
                AppLog.e("upload", "server rejected batch of ${batch.size}", e)
                failed += batch.size
                break
            } catch (e: Exception) {
                lastError = e.message ?: e.javaClass.simpleName
                store.markFailed(batch.map { it.fingerprint }, lastError)
                store.setStat("last_error", "${Clock.local(System.currentTimeMillis())} upload: $lastError")
                AppLog.e("upload", "network failure for batch of ${batch.size}", e)
                failed += batch.size
                break
            }
        }
        return DrainOutcome(sent, failed, store.pendingCount(), lastError)
    }

    fun heartbeat(context: Context): Result<String> {
        val store = Store.get(context)
        return try {
            val serverTime = Api(context).heartbeat(store.pendingCount(), store.stat("last_sms_at")?.toLongOrNull())
            store.setStat("last_heartbeat_at", System.currentTimeMillis().toString())
            store.setStat("last_heartbeat_result", "ok ($serverTime)")
            Result.success(serverTime)
        } catch (e: Exception) {
            val msg = (e as? ApiException)?.code ?: (e.message ?: e.javaClass.simpleName)
            store.setStat("last_heartbeat_result", "failed: $msg")
            store.setStat("last_error", "${Clock.local(System.currentTimeMillis())} heartbeat: $msg")
            AppLog.w("heartbeat", "failed: $msg")
            Result.failure(e)
        }
    }
}
