import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/// A QR code for a piece of text, drawn crisp at any size.
nonisolated enum QRCode {
    /// One pixel per module; scale it up with `.interpolation(.none)`.
    static func image(for text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        // Medium error correction: survives a scuffed screen, stays easy to scan.
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        return context.createCGImage(output, from: output.extent)
    }

    /// A few dozen pixels need no GPU, and the widget extension stays light.
    private static let context = CIContext(options: [.useSoftwareRenderer: true])
}

/// A QR code in ink on white, the way every phone camera expects it,
/// whatever the theme.
struct QRCodeView: View {
    let text: String
    var padding: CGFloat = 14
    var cornerRadius: CGFloat = 22

    var body: some View {
        if let image = QRCode.image(for: text) {
            Image(decorative: image, scale: 1)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(padding)
                .background(.white, in: .rect(cornerRadius: cornerRadius))
                // One layer, so a shadow added around it falls outside the
                // white card. Otherwise SwiftUI shadows the code and the card
                // separately, and the code casts a grey halo onto the card.
                .compositingGroup()
                .accessibilityLabel(Text("QR code for \(text)"))
        }
    }
}
