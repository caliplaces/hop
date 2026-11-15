import Foundation
import Observation
import Photos

/// Downloads a URL to a file, reporting progress. Clips can be up to 5 GB, so
/// a bare `URLSession.download` with no progress won't do.
nonisolated final class Downloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let destination: URL
    private let progress: @Sendable (Double) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var moveError: Error?
    private let lock = NSLock()

    private init(destination: URL, progress: @escaping @Sendable (Double) -> Void) {
        self.destination = destination
        self.progress = progress
    }

    static func download(
        _ url: URL, to destination: URL, progress: @escaping @Sendable (Double) -> Void
    ) async throws {
        let downloader = Downloader(destination: destination, progress: progress)
        let session = URLSession(configuration: .default, delegate: downloader, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let task = session.downloadTask(with: url)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                downloader.lock.withLock { downloader.continuation = continuation }
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
    }

    func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask,
        didWriteData _: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        progress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(
        _ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL
    ) {
        // The temporary file is gone once this returns, so move it now.
        do {
            if let http = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw URLError(.badServerResponse)
            }
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            lock.withLock { moveError = error }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let (continuation, moveError) = lock.withLock {
            defer { self.continuation = nil }
            return (self.continuation, self.moveError)
        }
        if let error = error ?? moveError {
            continuation?.resume(throwing: error)
        } else {
            continuation?.resume()
        }
    }
}

/// Saving a clip to Photos, or preparing it to share, with progress.
@Observable
final class ClipTransfer {
    enum State: Equatable {
        case idle
        case downloading(Double)
        case saving
        case saved
        case failed(String)
    }

    private(set) var state = State.idle

    var isBusy: Bool {
        switch state {
        case .downloading, .saving: true
        default: false
        }
    }

    /// Downloads the clip and adds it to the photo library (add-only access).
    func saveToPhotos(_ clip: Clip, from url: URL) async {
        guard !isBusy else { return }
        let access = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard access == .authorized || access == .limited else {
            state = .failed(String(localized: "Allow Hop to add to Photos in Settings, then try again."))
            return
        }
        do {
            let file = try await download(clip, from: url)
            state = .saving
            try await Self.addToLibrary(file, name: clip.name, isVideo: clip.isVideo)
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
            state = .saved
        } catch is CancellationError {
            state = .idle
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// Downloads the clip to a temporary file to hand to the share sheet.
    func fileToShare(_ clip: Clip, from url: URL) async -> URL? {
        guard !isBusy else { return nil }
        do {
            let file = try await download(clip, from: url)
            state = .idle
            return file
        } catch is CancellationError {
            state = .idle
        } catch {
            state = .failed(error.localizedDescription)
        }
        return nil
    }

    /// Photos runs the change block on its own queue. Built here, outside the
    /// main actor, the block isn't tied to the main thread; built in a main
    /// actor method it would be, and Swift would stop the app when Photos
    /// ran it elsewhere.
    private nonisolated static func addToLibrary(_ file: URL, name: String, isVideo: Bool) async throws {
        try await PHPhotoLibrary.shared().performChanges { @Sendable in
            let options = PHAssetResourceCreationOptions()
            options.shouldMoveFile = true
            options.originalFilename = name
            PHAssetCreationRequest.forAsset()
                .addResource(with: isVideo ? .video : .photo, fileURL: file, options: options)
        }
    }

    func reset() {
        if !isBusy { state = .idle }
    }

    private func download(_ clip: Clip, from url: URL) async throws -> URL {
        state = .downloading(0)
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: Self.safeFilename(clip.name))
        try await Downloader.download(url, to: file) { [weak self] fraction in
            Task { @MainActor in
                guard let self, case .downloading = self.state else { return }
                self.state = .downloading(fraction)
            }
        }
        return file
    }

    /// The name people gave the file, minus anything a path can't hold.
    nonisolated static func safeFilename(_ name: String) -> String {
        let cleaned = name
            .components(separatedBy: CharacterSet(charactersIn: "/\\:\0"))
            .joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned.hasPrefix(".") ? "clip\(cleaned)" : cleaned
    }
}
