package com.dshremote.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

/**
 * Relay pairing + session identity (PROTOCOL §4, §8).
 *
 * Flow: POST /pair {code} → {deviceId, challenge, token}; prove possession
 * with HMAC-SHA256(key = SHA256(code), msg = challenge); then
 * GET /d/<id>/__claim with `x-dsh-relay-token` to mint the HttpOnly
 * `dsh-relay` cookie. Afterwards every /d/... route (HTTP and WS upgrade)
 * is identified by that cookie — OkHttp's jar carries it automatically.
 */
data class PairResult(val deviceId: String, val challenge: String, val token: String)

sealed class RelayError(message: String) : Exception(message) {
    class BadCode(message: String) : RelayError(message)
    class RateLimited(message: String) : RelayError(message)
    class Transport(message: String) : RelayError(message)
}

private const val TOKEN_HEADER = "x-dsh-relay-token"
private const val JSON_MEDIA = "application/json; charset=utf-8"

class RelayClient(relayBaseUrl: String) {
    val baseUrl = relayBaseUrl.trimEnd('/')
    private val jar = MemoryCookieJar()
    val http = OkHttpClient.Builder()
        .cookieJar(jar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * WebSocket-only client: infinite read/write timeouts (a quiet stream is
     * healthy, not broken) plus app-level pings that keep NAT/middleboxes warm
     * and fail fast on a truly dead peer. Sharing the jar keeps one identity.
     * The 60s RPC timeout above must never touch sockets: OkHttp applies it to
     * idle WS reads, which reads as a mysterious "disconnect after a while".
     */
    val wsHttp = OkHttpClient.Builder()
        .cookieJar(jar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(0, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    fun deviceBase(deviceId: String): String = "$baseUrl/d/$deviceId"

    suspend fun pair(code: String): PairResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("code", code).toString()
            .toRequestBody(JSON_MEDIA.toMediaType())
        val req = Request.Builder().url("$baseUrl/pair").post(body).build()
        val res = http.newCall(req).execute()
        res.use {
            val payload = JSONObject(it.body?.string().orEmpty())
            if (!it.isSuccessful || !payload.optBoolean("ok")) {
                val err = payload.optJSONObject("error")
                throw when (err?.optString("code")) {
                    "RATE_LIMITED" -> RelayError.RateLimited(err.optString("message"))
                    else -> RelayError.BadCode(err?.optString("message") ?: "配对码无效或已过期")
                }
            }
            PairResult(
                deviceId = payload.getString("deviceId"),
                challenge = payload.getString("challenge"),
                token = payload.getString("token"),
            )
        }
    }

    /** response = HMAC-SHA256(key = SHA256(code), msg = challenge), hex. */
    fun challengeResponse(code: String, challenge: String): String {
        val key = MessageDigest.getInstance("SHA-256")
            .digest(code.toByteArray(Charsets.UTF_8))
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(challenge.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    suspend fun claim(deviceId: String, token: String) = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${deviceBase(deviceId)}/__claim")
            .header(TOKEN_HEADER, token)
            .get()
            .build()
        val res = http.newCall(req).execute()
        res.use {
            if (!it.isSuccessful) throw RelayError.Transport("建立会话失败 (${it.code})")
        }
    }

    /**
     * Phone hello over /ws?role=phone: burns the one-shot challenge with the
     * HMAC response and returns whether the host is currently online.
     */
    suspend fun phoneHello(
        deviceId: String,
        challenge: String,
        response: String,
        token: String,
    ): Boolean = withContext(Dispatchers.IO) {
        val url = baseUrl.replaceFirst("http", "ws") + "/ws?role=phone"
        val hello = JSONObject()
            .put("t", "hello")
            .put("v", 1)
            .put("role", "phone")
            .put("deviceId", deviceId)
            .put("challenge", challenge)
            .put("response", response)
            .put("token", token)
            .toString()
        val latch = CountDownLatch(1)
        var online = false
        var denied: String? = null
        val socket = wsHttp.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val frame = JSONObject(text)
                    if (frame.optString("t") == "hello-ok") {
                        online = frame.optJSONObject("peer")?.optBoolean("online") ?: false
                        latch.countDown()
                    } else if (frame.optString("t") == "hello-deny") {
                        denied = frame.optString("reason")
                        latch.countDown()
                    }
                }
            },
        )
        try {
            socket.send(hello)
            if (!latch.await(15, TimeUnit.SECONDS)) {
                throw RelayError.Transport("验证超时")
            }
        } finally {
            socket.close(1000, null)
        }
        denied?.let { throw RelayError.BadCode("验证被拒绝 ($it)") }
        online
    }
}

/** Minimal in-memory cookie jar: holds the relay session cookie for the process. */
private class MemoryCookieJar : CookieJar {
    private val store = mutableMapOf<String, MutableList<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        store[url.host] = cookies.toMutableList()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> =
        store[url.host].orEmpty().filter { it.expiresAt > System.currentTimeMillis() }
}

/** Long-lived pairing secret. Encrypted at rest; never logged. */
class TokenStore(context: Context) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context, "dsh_pairing", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun save(relayUrl: String, deviceId: String, token: String) {
        prefs.edit()
            .putString("relay_url", relayUrl)
            .putString("device_id", deviceId)
            .putString("token", token)
            .apply()
    }

    fun load(): Triple<String, String, String>? {
        val relay = prefs.getString("relay_url", null)
        val device = prefs.getString("device_id", null)
        val token = prefs.getString("token", null)
        return if (relay != null && device != null && token != null) Triple(relay, device, token) else null
    }

    fun clear() = prefs.edit().clear().apply()
}
