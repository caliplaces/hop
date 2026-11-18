package com.onmyhop.app.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A failed request, in the API's own words when it gave any. */
class ApiError(val status: Int, val code: String, val serverMessage: String?) :
    Exception(serverMessage ?: "Something went wrong. Please try again.")

/** The JSON settings every reply is read with: unknown fields are newer servers' additions. */
val HopJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
}

/**
 * A small JSON client for Hop's API. Signs requests with the session's bearer
 * token when there is one. Paths are relative to the server, like
 * `api/me`, as in the iPhone app.
 */
class ApiClient(
    val baseUrl: HttpUrl,
    val token: String?,
    private val http: OkHttpClient,
) {
    suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T =
        decode(serializer<T>(), send("GET", path, query, null))

    /** The raw bytes of a GET, such as an image. */
    suspend fun bytes(path: String): ByteArray = send("GET", path, emptyMap(), null)

    suspend inline fun <reified B, reified T> post(path: String, body: B): T =
        decode(serializer<T>(), send("POST", path, emptyMap(), encode(body)))

    /** A POST whose reply doesn't matter beyond succeeding. */
    suspend fun post(path: String) {
        send("POST", path, emptyMap(), EMPTY_JSON)
    }

    suspend inline fun <reified B, reified T> put(path: String, body: B): T =
        decode(serializer<T>(), send("PUT", path, emptyMap(), encode(body)))

    suspend inline fun <reified B, reified T> patch(path: String, body: B): T =
        decode(serializer<T>(), send("PATCH", path, emptyMap(), encode(body)))

    suspend fun delete(path: String) {
        send("DELETE", path, emptyMap(), EMPTY_JSON)
    }

    /** A DELETE whose reply matters, such as the profile it leaves behind. */
    suspend inline fun <reified T> deleteFor(path: String): T =
        decode(serializer<T>(), send("DELETE", path, emptyMap(), EMPTY_JSON))

    /** Uploads raw bytes, such as a JPEG, labelled with their own type. */
    suspend inline fun <reified T> putBytes(path: String, bytes: ByteArray, contentType: String): T =
        decode(serializer<T>(), send("PUT", path, emptyMap(), bytes.toRequestBody(contentType.toMediaType())))

    /** Resolves a URL the API returned, which may be relative to the API. */
    fun resolve(reference: String): HttpUrl? = baseUrl.resolve(reference)

    inline fun <reified B> encode(body: B): RequestBody =
        HopJson.encodeToString(serializer<B>(), body).toRequestBody(JSON)

    fun <T> decode(serializer: KSerializer<T>, bytes: ByteArray): T =
        HopJson.decodeFromString(serializer, bytes.decodeToString())

    suspend fun send(method: String, path: String, query: Map<String, String>, body: RequestBody?): ByteArray {
        val url = baseUrl.newBuilder().addPathSegments(path).apply {
            query.forEach { (name, value) -> addQueryParameter(name, value) }
        }.build()
        val request = Request.Builder()
            .url(url)
            // The API treats unlabelled writes like cross-site form posts and
            // refuses them, so every write says what it is: JSON, even
            // without a body, unless it's raw bytes like a photo.
            .method(method, if (method == "GET") null else body ?: EMPTY_JSON)
            .header("Accept", "application/json")
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .build()
        return withContext(Dispatchers.IO) {
            http.newCall(request).await().use { response ->
                val bytes = response.body.bytes()
                if (!response.isSuccessful) {
                    val reply = runCatching { HopJson.decodeFromString<ErrorReply>(bytes.decodeToString()) }.getOrNull()
                    throw ApiError(response.code, reply?.error ?: "http_${response.code}", reply?.message)
                }
                bytes
            }
        }
    }

    @Serializable
    private class ErrorReply(val error: String, val message: String? = null)

    companion object {
        val JSON = "application/json".toMediaType()
        val EMPTY_JSON: RequestBody = ByteArray(0).toRequestBody(JSON)
    }
}

/** An empty JSON object, for writes with nothing to say. */
@Serializable
object Empty

/** A reply that only says it worked. */
@Serializable
class Ok

/** Runs an OkHttp call without blocking a thread, and cancels it with the coroutine. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = continuation.resume(response)
        override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)
    })
}
