package com.tahweel.listener

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.tahweel.listener.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.min

class ForwarderService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        App.createChannel(this)
        startInForeground(buildNotification("starting…"))
        acquireWakeLock()
        AppLog.i("service", "created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val reason = intent?.getStringExtra(EXTRA_REASON) ?: "system"
        if (loop == null || loop?.isActive != true) {
            loop = scope.launch { runLoop() }
        }
        wake.trySend(Unit)
        AppLog.i("service", "start command ($reason)")
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        AppLog.w("service", "destroyed")
        loop?.cancel()
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        AppLog.w("service", "task removed, rescheduling")
        KeepAliveWorker.schedule(this)
        super.onTaskRemoved(rootIntent)
    }

    private suspend fun runLoop() {
        var lastHeartbeat = 0L
        var backoffUntil = 0L
        while (scope.isActive) {
            val store = Store.get(this)
            val now = System.currentTimeMillis()
            val prefs = Prefs(this)
            if (prefs.configured) {
                if (store.pendingCount() > 0 && now >= backoffUntil) {
                    val outcome = Uploader.drain(this)
                    backoffUntil = if (outcome.error != null) {
                        val attempts = store.maxAttempts()
                        val delayMs = min(5_000L * (1L shl min(attempts, 6)), MAX_BACKOFF_MS)
                        AppLog.w("service", "upload failed (${outcome.error}); retry in ${delayMs / 1000}s")
                        System.currentTimeMillis() + delayMs
                    } else 0L
                }
                if (now - lastHeartbeat >= HEARTBEAT_MS) {
                    Uploader.heartbeat(this)
                    lastHeartbeat = System.currentTimeMillis()
                }
            }
            updateNotification()
            withTimeoutOrNull(TICK_MS) { wake.receive() }
        }
    }

    private fun updateNotification() {
        val store = Store.get(this)
        val prefs = Prefs(this)
        val pending = store.pendingCount()
        val hb = store.stat("last_heartbeat_result") ?: "no heartbeat yet"
        val text = when {
            !prefs.configured -> "Not configured — open the app"
            pending > 0 -> "$pending message(s) waiting · $hb"
            else -> "Listening · $hb"
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, App.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_wallet)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun startInForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tahweel:forwarder").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    companion object {
        const val NOTIFICATION_ID = 1001
        private const val EXTRA_REASON = "reason"
        private const val TICK_MS = 15_000L
        private const val HEARTBEAT_MS = 60_000L
        private const val MAX_BACKOFF_MS = 5 * 60_000L

        @Volatile var running: Boolean = false
            private set

        fun start(context: Context, reason: String) {
            val intent = Intent(context, ForwarderService::class.java).putExtra(EXTRA_REASON, reason)
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (e: Exception) {
                val blocked = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && e is ForegroundServiceStartNotAllowedException
                AppLog.e("service", if (blocked) "foreground start not allowed; falling back to WorkManager" else "start failed", e)
                KeepAliveWorker.uploadNow(context)
            }
        }
    }
}
