package com.tahweel.listener

import org.json.JSONArray
import org.json.JSONObject

data class ForwardRules(val filter: Boolean, val senders: List<String>, val keywords: List<String>) {
    fun toJson(): String = JSONObject()
        .put("filter", filter)
        .put("senders", JSONArray(senders))
        .put("keywords", JSONArray(keywords))
        .toString()

    companion object {
        fun from(json: JSONObject?): ForwardRules? {
            if (json == null) return null
            return ForwardRules(
                filter = json.optBoolean("filter", false),
                senders = strings(json.optJSONArray("senders")),
                keywords = strings(json.optJSONArray("keywords")),
            )
        }

        fun parse(text: String?): ForwardRules? =
            if (text.isNullOrBlank()) null else try { from(JSONObject(text)) } catch (_: Exception) { null }

        private fun strings(array: JSONArray?): List<String> {
            if (array == null) return emptyList()
            return (0 until array.length()).map { array.optString(it) }.filter { it.isNotBlank() }
        }
    }
}

object ForwardFilter {
    private const val RULES_KEY = "forward_rules"
    private val NUMERIC_ADDRESS = Regex("^\\+?[0-9]{5,}$")
    private val WHITESPACE = Regex("\\s+")

    fun save(store: Store, rules: ForwardRules) = store.setStat(RULES_KEY, rules.toJson())

    fun rules(store: Store): ForwardRules? = ForwardRules.parse(store.stat(RULES_KEY))

    fun shouldForward(rules: ForwardRules?, address: String, body: String): Boolean {
        if (rules == null || !rules.filter) return true
        return isTrustedSender(rules.senders, address) || mentionsMoney(rules.keywords, body)
    }

    private fun normalize(value: String): String = value.trim().lowercase().replace(WHITESPACE, " ")

    private fun isTrustedSender(senders: List<String>, address: String): Boolean {
        val normalized = normalize(address)
        if (normalized.isEmpty()) return false
        val allowlist = senders.map(::normalize).filter { it.isNotEmpty() }
        if (NUMERIC_ADDRESS.matches(normalized)) return normalized in allowlist
        return allowlist.any { normalized == it || normalized.contains(it) }
    }

    private fun mentionsMoney(keywords: List<String>, body: String): Boolean {
        val text = body.lowercase()
        return keywords.any { it.isNotBlank() && text.contains(it.lowercase()) }
    }
}
