import SwiftUI

/// The athlete's QR code full screen, bright and awake: where the widgets,
/// Control Center, Siri and the Action button lead when Event mode isn't on.
struct QRCodeScreen: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    private var color: PaletteColor { session.me?.paletteColor ?? Palette.brand }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
            }
            .padding(.top, 8)

            Spacer(minLength: 12)
            if let me = session.me, let link = me.link {
                TurningPass(me: me, link: link, stats: nil)
                    .frame(maxWidth: 360)
                Text("Scan to send me your clips")
                    .font(.title3.weight(.semibold))
                    .padding(.top, 24)
            } else {
                ProgressView()
            }
            Spacer(minLength: 12)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            Aura(colors: [color.color, color.color, Palette.brand.color], intensity: 1)
                .ignoresSafeArea()
        }
        .onAppear { StageLights.on() }
        .onDisappear { StageLights.off() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { StageLights.on() } else { StageLights.off() }
        }
    }
}
