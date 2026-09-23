package com.tahweel.listener

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class IngestResult(
    val accepted: List<String>,
    val created: Int,
    val matched: Int,
    val results: List<IngestRowResult>,
    val raw: String,
)

data class IngestRowResult(
    val fingerprint: String,
    val status: String,
    val parsed: Boolean,
    val amountCents: Int?,
    val senderPhone: String?,
    val wallet: String?,
    val note: String?,
)

class ApiException(val status: Int, val code: String, message: String) : Exception(message)

object Fingerprint {
    fun of(address: String, body: String, timestampMs: Long): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest("$address|$body|$timestampMs".toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

class Api(private val context: Context) {
    private val prefs = Prefs(context)
    private val json = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private fun request(path: String, body: JSONObject): Request =
        Request.Builder()
            .url(prefs.serverUrl + path)
            .header("Authorization", "Bearer ${prefs.token}")
            .header("Accept", "application/json")
            .header("X-Tahweel-App-Version", BuildConfig.VERSION_NAME)
            .post(body.toString().toRequestBody(json))
            .build()

    private fun execute(path: String, body: JSONObject): JSONObject {
        if (!prefs.configured) throw ApiException(0, "not_configured", "Server URL or token missing")
        client.newCall(request(path, body)).execute().use { res ->
            val text = res.body?.string() ?: ""
            val parsed = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
            if (!res.isSuccessful) {
                val code = parsed.optString("error", "http_${res.code}")
                throw ApiException(res.code, code, "HTTP ${res.code} $code")
            }
            return parsed
        }
    }

    fun postSms(items: List<QueueItem>): IngestResult {
        val messages = JSONArray()
        for (item in items) {
            messages.put(
                JSONObject()
                    .put("fingerprint", item.fingerprint)
                    .put("address", item.address.take(80))
                    .put("body", item.body.take(4000))
                    .put("received_at", Clock.iso(item.receivedAtMs))
            )
        }
        val body = JSONObject().put("device_id", prefs.deviceId).put("messages", messages)
        val res = execute("/ingest/sms", body)
        val accepted = ArrayList<String>()
        res.optJSONArray("accepted")?.let { arr -> for (i in 0 until arr.length()) accepted.add(arr.getString(i)) }
        val results = ArrayList<IngestRowResult>()
        res.optJSONArray("results")?.let { arr ->
            for (i in 0 until arr.length()) {
                val r = arr.getJSONObject(i)
                results.add(
                    IngestRowResult(
                        fingerprint = r.optString("fingerprint"),
                        status = r.optString("status", "?"),
                        parsed = r.optBoolean("parsed", false),
                        amountCents = if (r.isNull("amount_cents")) null else r.optInt("amount_cents"),
                        senderPhone = if (r.isNull("sender_phone")) null else r.optString("sender_phone"),
                        wallet = if (r.isNull("wallet")) null else r.optString("wallet"),
                        note = if (r.isNull("note")) null else r.optString("note"),
                    )
                )
            }
        }
        return IngestResult(accepted, res.optInt("created", 0), res.optInt("matched", 0), results, res.toString())
    }

    fun heartbeat(pendingCount: Int, lastSmsAtMs: Long?): String {
        val body = JSONObject()
            .put("device_id", prefs.deviceId)
            .put("name", prefs.effectiveDeviceName())
            .put("app_version", BuildConfig.VERSION_NAME)
            .put("battery", batteryPercent())
            .put("network", networkKind())
            .put("pending_count", pendingCount)
        if (lastSmsAtMs != null) body.put("last_sms_at", Clock.iso(lastSmsAtMs)) else body.put("last_sms_at", JSONObject.NULL)
        val res = execute("/ingest/heartbeat", body)
        ForwardRules.from(res.optJSONObject("forwarding"))?.let { ForwardFilter.save(Store.get(context), it) }
        return res.optString("server_time", "ok")
    }

    private fun batteryPercent(): Int? {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return null
        return (level * 100) / scale
    }

    private fun networkKind(): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return "unknown"
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "offline"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
    }
}
