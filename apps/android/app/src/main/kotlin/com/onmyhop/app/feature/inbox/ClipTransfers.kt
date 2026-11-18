package com.onmyhop.app.feature.inbox

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import androidx.core.content.edit
import androidx.core.net.toUri
import com.onmyhop.app.core.Clip
import com.onmyhop.app.core.await
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.io.OutputStream

/**
 * Saving a clip to the phone's gallery, or downloading it to share, one at
 * a time. Clips can be gigabytes, so a transfer runs in the app's own scope
 * (leaving the viewer doesn't cut it short) and reports its progress.
 *
 * Saves go through MediaStore into Movies/Hop or Pictures/Hop, which needs
 * no permission. The entry stays pending, hidden from other apps, until the
 * last byte is written; one the app didn't finish (it was closed, say) is
 * deleted the next time it starts.
 */
class ClipTransfers(private val context: Context, private val http: OkHttpClient, private val scope: CoroutineScope) {
    enum class Kind { Save, Share }

    sealed interface Phase {
        /** How much has arrived, from 0 to 1, when the size is known. */
        data class Downloading(val fraction: Float?) : Phase
        /** Finished. A share's file, ready for the share sheet, is [shared]. */
        data class Done(val shared: Uri? = null) : Phase
        data class Failed(val message: String?) : Phase
    }

    data class Transfer(val clipId: String, val kind: Kind, val phase: Phase) {
        val isBusy: Boolean get() = phase is Phase.Downloading
    }

    private val _current = MutableStateFlow<Transfer?>(null)
    val current: StateFlow<Transfer?> = _current.asStateFlow()

    private var job: Job? = null
    private val pending = context.getSharedPreferences("hop.transfers", Context.MODE_PRIVATE)

    /** Saves the clip at the link [link] gives to the gallery. */
    fun save(clip: Clip, link: suspend () -> String) = start(clip, Kind.Save, link) { url ->
        saveToGallery(clip, url)
        null
    }

    /** Downloads the clip to share it; the finished transfer holds its content URI, for the share sheet. */
    fun share(clip: Clip, link: suspend () -> String) = start(clip, Kind.Share, link) { url ->
        downloadToShare(clip, url)
    }

    private fun start(clip: Clip, kind: Kind, link: suspend () -> String, work: suspend (String) -> Uri?) {
        if (_current.value?.isBusy == true) return
        _current.value = Transfer(clip.id, kind, Phase.Downloading(null))
        job = scope.launch {
            try {
                val shared = work(link())
                _current.value = Transfer(clip.id, kind, Phase.Done(shared))
            } catch (error: CancellationException) {
                _current.value = null
                throw error
            } catch (error: Exception) {
                _current.value = Transfer(clip.id, kind, Phase.Failed(error.message))
            }
        }
    }

    /** Forgets a finished or failed transfer, once it's been shown. */
    fun dismiss(clipId: String) {
        if (_current.value?.clipId == clipId && _current.value?.isBusy == false) _current.value = null
    }

    /** Stops whatever is under way: signing out, say. Its partial file goes. */
    fun cancel() {
        job?.cancel()
        job = null
        _current.value = null
    }

    /** Removes what an earlier run left behind: unfinished saves, and files downloaded to share. */
    fun removeLeftovers() {
        scope.launch(Dispatchers.IO) {
            pending.all.keys.forEach { uri ->
                runCatching { context.contentResolver.delete(uri.toUri(), null, null) }
                pending.edit { remove(uri) }
            }
            sharedDir().deleteRecursively()
        }
    }

    private suspend fun saveToGallery(clip: Clip, url: String) = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val (collection, folder) = when {
            clip.isVideo -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to Environment.DIRECTORY_MOVIES
            clip.mime.startsWith("image/") -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to Environment.DIRECTORY_PICTURES
            else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to Environment.DIRECTORY_DOWNLOADS
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, safeFileName(clip.name, clip.mime))
            put(MediaStore.MediaColumns.MIME_TYPE, clip.mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "$folder/Hop")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values) ?: throw IOException("Couldn’t save to this phone.")
        pending.edit(commit = true) { putBoolean(uri.toString(), true) }
        try {
            val out = resolver.openOutputStream(uri) ?: throw IOException("Couldn’t save to this phone.")
            out.use { download(clip, url, it) }
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (error: Throwable) {
            runCatching { resolver.delete(uri, null, null) }
            throw error
        } finally {
            pending.edit(commit = true) { remove(uri.toString()) }
        }
    }

    private suspend fun downloadToShare(clip: Clip, url: String): Uri = withContext(Dispatchers.IO) {
        // One shared file at a time: the last share's is no longer needed.
        val dir = sharedDir().apply { deleteRecursively() }
        val file = File(File(dir, clip.id).apply { mkdirs() }, safeFileName(clip.name, clip.mime))
        try {
            file.outputStream().use { download(clip, url, it) }
        } catch (error: Throwable) {
            file.delete()
            throw error
        }
        FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    /** Streams the clip's bytes, reporting progress as they arrive. */
    private suspend fun download(clip: Clip, url: String, out: OutputStream) {
        val response = http.newCall(Request.Builder().url(url).build()).await()
        response.use {
            if (!it.isSuccessful) throw IOException("Couldn’t download this clip.")
            val total = it.body.contentLength().takeIf { length -> length > 0 } ?: clip.size.takeIf { size -> size > 0 }
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE * 8)
            var received = 0L
            var shown = -1
            it.body.byteStream().use { input ->
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val read = input.read(buffer)
                    if (read < 0) break
                    out.write(buffer, 0, read)
                    received += read
                    val percent = total?.let { size -> (received * 100 / size).toInt() } ?: -1
                    if (percent != shown) {
                        shown = percent
                        _current.value = _current.value?.copy(phase = Phase.Downloading(total?.let { size -> received.toFloat() / size }))
                    }
                }
            }
        }
    }

    private fun sharedDir() = File(context.cacheDir, "shared")

    companion object {
        /**
         * A file name from what the sender's phone called the clip, which a
         * stranger chose: no folders, no hidden or control characters, a
         * sensible length, and an extension that matches what it is.
         */
        fun safeFileName(name: String, mime: String): String {
            val base = name.substringAfterLast('/').substringAfterLast('\\')
                .replace(Regex("[\\p{C}<>:\"|?*]"), "")
                .trim()
                .trimStart('.')
                .take(100)
                .ifEmpty { "Hop clip" }
            val extension = extensionFor(mime)
            return if (extension == null || base.lowercase().endsWith(".$extension")) base else "$base.$extension"
        }

        private fun extensionFor(mime: String): String? = when (mime.lowercase()) {
            "video/mp4" -> "mp4"
            "video/quicktime" -> "mov"
            "video/webm" -> "webm"
            "image/jpeg" -> "jpg"
            "image/png" -> "png"
            "image/heic" -> "heic"
            "image/heif" -> "heif"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            else -> null
        }
    }
}
