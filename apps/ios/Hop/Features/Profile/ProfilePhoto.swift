import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

/// Turns a picked photo into the profile photo Hop uploads: upright, square,
/// at most 512 pixels a side, sRGB, as a JPEG holding only the picture. The
/// square is centred on the largest face, when there is one.
///
/// The photo is redrawn, so the phone's location, camera details and any
/// other metadata stay on the phone. The server rebuilds it again anyway.
nonisolated enum ProfilePhoto {
    /// The largest photo the app uploads, in pixels a side.
    static let side = 512
    /// The API refuses profile photos over this (MAX_AVATAR_BYTES).
    static let maxBytes = 512 * 1024

    struct Prepared: Equatable, Sendable {
        let jpeg: Data
        let width: Int
        let height: Int
    }

    enum Failure: LocalizedError {
        case unreadable

        var errorDescription: String? {
            String(localized: "That photo can’t be used. Try another.")
        }
    }

    /// Prepares `data`, a photo in any format ImageIO reads (HEIC, JPEG, PNG…).
    @concurrent
    static func prepare(_ data: Data) async throws -> Prepared {
        let upright = try uprightImage(data)
        let faces = await faces(in: upright)
        let square = try squareCrop(upright, around: faces)
        return try encode(square)
    }

    /// The photo with its orientation applied, scaled so its short side is
    /// about `side` pixels (never larger than it was, nor over 4096 long).
    static func uprightImage(_ data: Data) throws -> CGImage {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options),
              CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0
        else { throw Failure.unreadable }

        let short = min(width, height)
        let long = max(width, height)
        // Long enough that the short side still covers a full-size photo.
        let wanted = (Double(side) * Double(long) / Double(short)).rounded(.up)
        let maxPixels = Int(min(wanted, Double(long), 4096))
        let thumbnail = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(maxPixels, 1),
        ] as CFDictionary
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnail) else {
            throw Failure.unreadable
        }
        return image
    }

    /// Faces in the photo, in Vision's normalised coordinates (origin at the
    /// bottom left). None when Vision can't look.
    static func faces(in image: CGImage) async -> [CGRect] {
        let request = DetectFaceRectanglesRequest()
        guard let found = try? await request.perform(on: image) else { return [] }
        return found.map(\.boundingBox.cgRect)
    }

    /// The largest square that fits, centred on the largest face if any,
    /// else on the middle.
    static func squareCrop(_ image: CGImage, around faces: [CGRect]) throws -> CGImage {
        let width = image.width
        let height = image.height
        let side = min(width, height)
        var x = (width - side) / 2
        var y = (height - side) / 2
        if let face = faces.max(by: { $0.width * $0.height < $1.width * $1.height }) {
            // Vision measures from the bottom; CGImage cropping from the top.
            let centreX = face.midX * Double(width)
            let centreY = (1 - face.midY) * Double(height)
            x = clamp(Int((centreX - Double(side) / 2).rounded()), 0, width - side)
            y = clamp(Int((centreY - Double(side) / 2).rounded()), 0, height - side)
        }
        guard let cropped = image.cropping(to: CGRect(x: x, y: y, width: side, height: side)) else {
            throw Failure.unreadable
        }
        return cropped
    }

    /// Redraws the square at no more than `side` pixels, opaque and sRGB,
    /// and encodes it, lowering the quality if it would be too large.
    static func encode(_ square: CGImage) throws -> Prepared {
        let size = min(square.width, side)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                  data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                  space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
              )
        else { throw Failure.unreadable }
        let canvas = CGRect(x: 0, y: 0, width: size, height: size)
        // Transparent parts of a PNG become white rather than black.
        context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        context.fill(canvas)
        context.interpolationQuality = .high
        context.draw(square, in: canvas)
        guard let redrawn = context.makeImage() else { throw Failure.unreadable }

        for quality in [0.82, 0.65, 0.45] {
            let jpeg = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(
                jpeg, UTType.jpeg.identifier as CFString, 1, nil
            ) else { throw Failure.unreadable }
            let options = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
            CGImageDestinationAddImage(destination, redrawn, options)
            guard CGImageDestinationFinalize(destination) else { throw Failure.unreadable }
            if jpeg.length <= maxBytes {
                return Prepared(jpeg: jpeg as Data, width: size, height: size)
            }
        }
        throw Failure.unreadable
    }

    private static func clamp(_ value: Int, _ low: Int, _ high: Int) -> Int {
        min(max(value, low), high)
    }
}
