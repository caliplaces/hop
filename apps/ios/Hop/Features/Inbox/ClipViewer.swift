import AVFoundation
import SwiftUI
import UIKit

/// An event's clips, full screen: swipe sideways between them, tap to pause,
/// and save, share or delete the one showing.
struct ClipViewer: View {
    let hopId: String
    let model: InboxModel

    @Environment(\.dismiss) private var dismiss
    @Environment(Session.self) private var session
    @State private var current: String?
    @State private var transfer = ClipTransfer()
    @State private var confirmingDelete = false
    @State private var sharing: SharedFile?
    @State private var problem: String?

    init(hopId: String, startAt clipId: String, model: InboxModel) {
        self.hopId = hopId
        self.model = model
        _current = State(initialValue: clipId)
    }

    private var clips: [Clip] { model.clips[hopId]?.items ?? [] }
    private var clip: Clip? { clips.first { $0.id == current } }
    private var position: Int? { clips.firstIndex { $0.id == current } }

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(clips) { clip in
                    ClipPageView(clip: clip, isCurrent: clip.id == current, model: model)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(clip.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $current)
        .scrollIndicators(.hidden)
        .ignoresSafeArea()
        .background(.black)
        .overlay(alignment: .top) { topBar }
        .overlay(alignment: .bottom) { bottomBar }
        .environment(\.colorScheme, .dark)
        .onAppear {
            // Clips are watched with sound, even with the ring switch off.
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        }
        .onChange(of: current) {
            transfer.reset()
            problem = nil
            if let position, position >= clips.count - 3 {
                Task { await model.loadMore(in: hopId, api: session.api) }
            }
        }
        .confirmationDialog("Delete this clip?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        } message: {
            Text("It’s removed for good, for you and from Hop.")
        }
        .sheet(item: $sharing, onDismiss: { sharing?.removeFile() }) { file in
            ActivityView(items: [file.url])
                .presentationDetents([.medium, .large])
                .ignoresSafeArea()
        }
        .sensoryFeedback(.success, trigger: transfer.state == .saved) { _, saved in saved }
    }

    private var topBar: some View {
        HStack(alignment: .center, spacing: 12) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark").font(.body.weight(.semibold))
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .accessibilityLabel("Close")

            if let clip {
                VStack(alignment: .leading, spacing: 1) {
                    ContributorLabel(clip: clip)
                        .font(.subheadline.weight(.semibold))
                    Text(clip.sentAt, format: .relative(presentation: .named))
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                }
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.4), radius: 6)
            }
            Spacer()
            if let position {
                Text("\(position + 1) of \(model.hops.first { $0.id == hopId }?.fileCount ?? clips.count)")
                    .font(.footnote.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .glassEffect(.regular, in: .capsule)
            }
        }
        .padding(.horizontal, 16)
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            if let note = clip?.note, !note.isEmpty {
                Text(verbatim: note)
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .glassEffect(.regular, in: .rect(cornerRadius: 18))
            }
            if let message = problem ?? failure {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .glassEffect(.regular.tint(.red.opacity(0.5)), in: .capsule)
            }
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 10) {
                    Button {
                        guard let clip else { return }
                        Task { await save(clip) }
                    } label: {
                        saveLabel.frame(maxWidth: .infinity)
                    }
                    .disabled(transfer.isBusy)

                    Button {
                        guard let clip else { return }
                        Task { await share(clip) }
                    } label: {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(transfer.isBusy)

                    Button(role: .destructive) {
                        confirmingDelete = true
                    } label: {
                        Image(systemName: "trash")
                    }
                    .accessibilityLabel("Delete")
                }
                .buttonStyle(.glass)
                .controlSize(.large)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    @ViewBuilder private var saveLabel: some View {
        switch transfer.state {
        case let .downloading(fraction):
            Label {
                Text(fraction, format: .percent.precision(.fractionLength(0)))
                    .monospacedDigit()
            } icon: {
                ProgressView(value: fraction)
                    .progressViewStyle(.circular)
                    .controlSize(.small)
            }
        case .saving:
            Label("Saving", systemImage: "ellipsis")
        case .saved:
            Label("Saved", systemImage: "checkmark")
        default:
            Label("Save", systemImage: "arrow.down.to.line")
        }
    }

    private var failure: String? {
        if case let .failed(message) = transfer.state { return message }
        return nil
    }

    private func save(_ clip: Clip) async {
        do {
            let url = try await model.url(for: clip, download: true, api: session.api)
            await transfer.saveToPhotos(clip, from: url)
        } catch {
            problem = error.localizedDescription
        }
    }

    private func share(_ clip: Clip) async {
        do {
            let url = try await model.url(for: clip, download: true, api: session.api)
            if let file = await transfer.fileToShare(clip, from: url) {
                sharing = SharedFile(url: file)
            }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func delete() async {
        guard let clip, let position else { return }
        // Land on the clip after it, or the one before if it was the last.
        let neighbour = clips.indices.contains(position + 1)
            ? clips[position + 1].id
            : position > 0 ? clips[position - 1].id : nil
        do {
            try await model.delete(clip, api: session.api)
            if let neighbour {
                current = neighbour
            } else {
                dismiss()
            }
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// One clip filling the screen. Its stream URL is fetched when it becomes the
/// current page, and it only plays while it is.
private struct ClipPageView: View {
    let clip: Clip
    let isCurrent: Bool
    let model: InboxModel

    @Environment(Session.self) private var session
    @State private var url: URL?
    @State private var failed = false
    @State private var paused = false

    var body: some View {
        ZStack {
            ThumbnailView(clip: clip)
                .blur(radius: 40)
                .opacity(0.45)
                .ignoresSafeArea()
            if let url {
                if clip.isVideo {
                    LoopingPlayer(url: url, isPlaying: isCurrent && !paused)
                        .ignoresSafeArea()
                        .contentShape(.rect)
                        .onTapGesture { paused.toggle() }
                        .accessibilityAddTraits(.startsMediaSession)
                        .accessibilityLabel(paused ? "Play" : "Pause")
                } else {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        ProgressView().tint(.white)
                    }
                }
            } else if failed {
                Label("Couldn’t load this clip", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.white)
            } else {
                ProgressView().tint(.white)
            }
            if paused {
                Image(systemName: "play.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(.white)
                    .frame(width: 84, height: 84)
                    .glassEffect(.regular, in: .circle)
                    .allowsHitTesting(false)
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.25), value: paused)
        .task(id: isCurrent) {
            if !isCurrent { paused = false }
            guard isCurrent, url == nil else { return }
            do {
                url = try await model.url(for: clip, download: false, api: session.api)
            } catch {
                failed = true
            }
        }
    }
}

/// A video that loops, drawn with its whole frame visible.
private struct LoopingPlayer: UIViewRepresentable {
    let url: URL
    let isPlaying: Bool

    func makeUIView(context: Context) -> PlayerView {
        PlayerView(url: url)
    }

    func updateUIView(_ view: PlayerView, context: Context) {
        isPlaying ? view.play() : view.pause()
    }

    static func dismantleUIView(_ view: PlayerView, coordinator: ()) {
        view.stop()
    }

    final class PlayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }

        private let player = AVQueuePlayer()
        private var looper: AVPlayerLooper?

        init(url: URL) {
            super.init(frame: .zero)
            let layer = layer as! AVPlayerLayer
            layer.player = player
            layer.videoGravity = .resizeAspect
            looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

        func play() { player.play() }
        func pause() { player.pause() }

        func stop() {
            player.pause()
            looper?.disableLooping()
            player.removeAllItems()
        }
    }
}

/// A downloaded clip on its way to the share sheet.
private struct SharedFile: Identifiable {
    let url: URL
    var id: URL { url }

    /// The file only exists to be shared; drop it once the sheet closes.
    func removeFile() {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}

/// The system share sheet.
private struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
