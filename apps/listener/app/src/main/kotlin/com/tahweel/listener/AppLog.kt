package com.tahweel.listener

import android.content.Context
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object AppLog {
    private const val LOGCAT_TAG = "Tahweel"
    @Volatile private var store: Store? = null

    fun init(context: Context) {
        store = Store.get(context)
    }

    fun i(tag: String, message: String) = write("I", tag, message)
    fun w(tag: String, message: String) = write("W", tag, message)
    fun e(tag: String, message: String, error: Throwable? = null) {
        val text = if (error != null) "$message: ${error.javaClass.simpleName}: ${error.message}" else message
        write("E", tag, text)
    }

    private fun write(level: String, tag: String, message: String) {
        when (level) {
            "E" -> Log.e(LOGCAT_TAG, "[$tag] $message")
            "W" -> Log.w(LOGCAT_TAG, "[$tag] $message")
            else -> Log.i(LOGCAT_TAG, "[$tag] $message")
        }
        try {
            store?.log(level, tag, message)
        } catch (_: Exception) {
        }
    }

    fun render(lines: List<LogLine>): String {
        val fmt = SimpleDateFormat("MM-dd HH:mm:ss", Locale.US)
        return lines.joinToString("\n") { "${fmt.format(Date(it.atMs))} ${it.level} [${it.tag}] ${it.message}" }
    }
}

object Clock {
    private val isoUtcFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    private val localFormat = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)

    @Synchronized
    fun iso(ms: Long = System.currentTimeMillis()): String = isoUtcFormat.format(Date(ms))

    @Synchronized
    fun local(ms: Long): String = localFormat.format(Date(ms))
}
