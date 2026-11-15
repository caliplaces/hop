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
        return CIContext().createCGImage(output, from: output.extent)
    }
}

/// A QR code in ink on white, the way every phone camera expects it,
/// whatever the theme.
struct QRCodeView: View {
    let text: String

    var body: some View {
        if let image = QRCode.image(for: text) {
            Image(decorative: image, scale: 1)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(14)
                .background(.white, in: .rect(cornerRadius: 22))
                .accessibilityLabel(Text("QR code for \(text)"))
        }
    }
}
