package com.tahweel.listener

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class QueueItem(
    val fingerprint: String,
    val address: String,
    val body: String,
    val receivedAtMs: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)

data class LogLine(val id: Long, val atMs: Long, val level: String, val tag: String, val message: String)

data class SentRecord(val fingerprint: String, val sentAtMs: Long, val result: String)

class Store private constructor(context: Context) : SQLiteOpenHelper(context, "tahweel-listener.db", null, 1) {

    companion object {
        @Volatile private var instance: Store? = null
        private const val MAX_LOGS = 3000

        fun get(context: Context): Store = instance ?: synchronized(this) {
            instance ?: Store(context.applicationContext).also { instance = it }
        }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE queue(
                fingerprint TEXT PRIMARY KEY,
                address TEXT NOT NULL,
                body TEXT NOT NULL,
                received_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE sent(
                fingerprint TEXT PRIMARY KEY,
                sent_at INTEGER NOT NULL,
                result TEXT NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE logs(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at INTEGER NOT NULL,
                level TEXT NOT NULL,
                tag TEXT NOT NULL,
                msg TEXT NOT NULL)"""
        )
        db.execSQL("CREATE TABLE stats(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun enqueue(item: QueueItem): Boolean {
        if (isSent(item.fingerprint)) return false
        val values = ContentValues().apply {
            put("fingerprint", item.fingerprint)
            put("address", item.address)
            put("body", item.body)
            put("received_at", item.receivedAtMs)
            put("attempts", 0)
            put("created_at", System.currentTimeMillis())
        }
        val id = writableDatabase.insertWithOnConflict("queue", null, values, SQLiteDatabase.CONFLICT_IGNORE)
        return id != -1L
    }

    @Synchronized
    fun pending(limit: Int): List<QueueItem> {
        val out = ArrayList<QueueItem>()
        readableDatabase.query(
            "queue", null, null, null, null, null, "received_at ASC", limit.toString()
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    QueueItem(
                        fingerprint = c.getString(c.getColumnIndexOrThrow("fingerprint")),
                        address = c.getString(c.getColumnIndexOrThrow("address")),
                        body = c.getString(c.getColumnIndexOrThrow("body")),
                        receivedAtMs = c.getLong(c.getColumnIndexOrThrow("received_at")),
                        attempts = c.getInt(c.getColumnIndexOrThrow("attempts")),
                        lastError = c.getString(c.getColumnIndexOrThrow("last_error")),
                    )
                )
            }
        }
        return out
    }

    @Synchronized
    fun pendingCount(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM queue", null).use { c ->
            return if (c.moveToFirst()) c.getInt(0) else 0
        }
    }

    @Synchronized
    fun maxAttempts(): Int {
        readableDatabase.rawQuery("SELECT COALESCE(MAX(attempts), 0) FROM queue", null).use { c ->
            return if (c.moveToFirst()) c.getInt(0) else 0
        }
    }

    @Synchronized
    fun markSent(fingerprints: Collection<String>, result: String) {
        if (fingerprints.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            for (fp in fingerprints) {
                db.delete("queue", "fingerprint = ?", arrayOf(fp))
                val values = ContentValues().apply {
                    put("fingerprint", fp)
                    put("sent_at", now)
                    put("result", result)
                }
                db.insertWithOnConflict("sent", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun markFailed(fingerprints: Collection<String>, error: String) {
        if (fingerprints.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (fp in fingerprints) {
                db.execSQL(
                    "UPDATE queue SET attempts = attempts + 1, last_error = ? WHERE fingerprint = ?",
                    arrayOf(error.take(300), fp)
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun isSent(fingerprint: String): Boolean {
        readableDatabase.rawQuery("SELECT 1 FROM sent WHERE fingerprint = ?", arrayOf(fingerprint)).use { c ->
            return c.moveToFirst()
        }
    }

    @Synchronized
    fun sentRecord(fingerprint: String): SentRecord? {
        readableDatabase.rawQuery(
            "SELECT sent_at, result FROM sent WHERE fingerprint = ?", arrayOf(fingerprint)
        ).use { c ->
            return if (c.moveToFirst()) SentRecord(fingerprint, c.getLong(0), c.getString(1)) else null
        }
    }

    @Synchronized
    fun isQueued(fingerprint: String): Boolean {
        readableDatabase.rawQuery("SELECT 1 FROM queue WHERE fingerprint = ?", arrayOf(fingerprint)).use { c ->
            return c.moveToFirst()
        }
    }

    @Synchronized
    fun forgetSent(fingerprint: String) {
        writableDatabase.delete("sent", "fingerprint = ?", arrayOf(fingerprint))
    }

    @Synchronized
    fun log(level: String, tag: String, message: String) {
        val values = ContentValues().apply {
            put("at", System.currentTimeMillis())
            put("level", level)
            put("tag", tag)
            put("msg", message.take(2000))
        }
        val db = writableDatabase
        db.insert("logs", null, values)
        db.execSQL("DELETE FROM logs WHERE id <= (SELECT MAX(id) FROM logs) - $MAX_LOGS")
    }

    @Synchronized
    fun logs(limit: Int): List<LogLine> {
        val out = ArrayList<LogLine>()
        readableDatabase.query("logs", null, null, null, null, null, "id DESC", limit.toString()).use { c ->
            while (c.moveToNext()) {
                out.add(
                    LogLine(
                        id = c.getLong(c.getColumnIndexOrThrow("id")),
                        atMs = c.getLong(c.getColumnIndexOrThrow("at")),
                        level = c.getString(c.getColumnIndexOrThrow("level")),
                        tag = c.getString(c.getColumnIndexOrThrow("tag")),
                        message = c.getString(c.getColumnIndexOrThrow("msg")),
                    )
                )
            }
        }
        return out.reversed()
    }

    @Synchronized
    fun clearLogs() {
        writableDatabase.delete("logs", null, null)
    }

    @Synchronized
    fun stat(key: String): String? {
        readableDatabase.rawQuery("SELECT value FROM stats WHERE key = ?", arrayOf(key)).use { c ->
            return if (c.moveToFirst()) c.getString(0) else null
        }
    }

    @Synchronized
    fun setStat(key: String, value: String) {
        val values = ContentValues().apply {
            put("key", key)
            put("value", value)
        }
        writableDatabase.insertWithOnConflict("stats", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }
}
