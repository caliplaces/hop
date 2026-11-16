import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import Hop

// MARK: - Test photos

/// How a test photo is split between red and blue.
private enum Split {
    /// Red on the left, blue on the right.
    case leftRight
    /// Red on top, blue below.
    case topBottom
}

/// A photo as a camera might save it: half red, half blue, and metadata that
/// must never leave the phone.
private func makePhoto(
    width: Int,
    height: Int,
    type: UTType = .jpeg,
    orientation: Int = 1,
    split: Split = .leftRight,
    transparent: Bool = false
) -> Data {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    if !transparent {
        // In the stored pixels. CoreGraphics counts from the bottom.
        let (red, blue) = switch split {
        case .leftRight: (
            CGRect(x: 0, y: 0, width: width / 2, height: height),
            CGRect(x: width / 2, y: 0, width: width - width / 2, height: height)
        )
        case .topBottom: (
            CGRect(x: 0, y: height / 2, width: width, height: height - height / 2),
            CGRect(x: 0, y: 0, width: width, height: height / 2)
        )
        }
        context.setFillColor(CGColor(srgbRed: 1, green: 0, blue: 0, alpha: 1))
        context.fill(red)
        context.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 1, alpha: 1))
        context.fill(blue)
    }
    let image = context.makeImage()!
    let data = NSMutableData()
    let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil)!
    let properties: [CFString: Any] = [
        kCGImagePropertyOrientation: orientation,
        kCGImagePropertyGPSDictionary: [
            kCGImagePropertyGPSLatitude: 48.1486,
            kCGImagePropertyGPSLatitudeRef: "N",
            kCGImagePropertyGPSLongitude: 17.1077,
            kCGImagePropertyGPSLongitudeRef: "E",
        ],
        kCGImagePropertyTIFFDictionary: [
            kCGImagePropertyTIFFMake: "Apple",
            kCGImagePropertyTIFFModel: "SecretPhone 99",
        ],
        kCGImagePropertyExifDictionary: [
            kCGImagePropertyExifUserComment: "meet me at the gym",
        ],
    ]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    CGImageDestinationFinalize(destination)
    return data as Data
}

/// The colour at a point of a JPEG, from its top left.
private func pixel(_ jpeg: Data, x: Int, y: Int) throws -> (red: Int, green: Int, blue: Int) {
    let source = try #require(CGImageSourceCreateWithData(jpeg as CFData, nil))
    let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
    var bytes = [UInt8](repeating: 0, count: 4)
    let context = try #require(CGContext(
        data: &bytes, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    // Moves the wanted pixel onto the 1×1 canvas (CoreGraphics counts from the bottom).
    context.draw(image, in: CGRect(x: -x, y: -(image.height - 1 - y), width: image.width, height: image.height))
    return (Int(bytes[0]), Int(bytes[1]), Int(bytes[2]))
}

private func isRed(_ colour: (red: Int, green: Int, blue: Int)) -> Bool {
    colour.red > 200 && colour.blue < 60
}

private func isBlue(_ colour: (red: Int, green: Int, blue: Int)) -> Bool {
    colour.blue > 200 && colour.red < 60
}

// MARK: - Preparing photos

@Suite("Profile photos")
struct ProfilePhotoTests {
    @Test func makesASquareJPEGOfAtMost512Pixels() async throws {
        let prepared = try await ProfilePhoto.prepare(makePhoto(width: 4000, height: 3000))
        #expect(prepared.width == 512)
        #expect(prepared.height == 512)
        #expect(prepared.jpeg.prefix(3) == Data([0xFF, 0xD8, 0xFF]))
        #expect(prepared.jpeg.count <= ProfilePhoto.maxBytes)

        let source = try #require(CGImageSourceCreateWithData(prepared.jpeg as CFData, nil))
        #expect(CGImageSourceGetType(source) as String? == UTType.jpeg.identifier)
        let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        #expect(properties[kCGImagePropertyPixelWidth] as? Int == 512)
        #expect(properties[kCGImagePropertyPixelHeight] as? Int == 512)
    }

    @Test(arguments: [UTType.jpeg, .heic, .png])
    func leavesTheLocationAndCameraBehind(type: UTType) async throws {
        let prepared = try await ProfilePhoto.prepare(makePhoto(width: 900, height: 600, type: type))

        let source = try #require(CGImageSourceCreateWithData(prepared.jpeg as CFData, nil))
        let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        #expect(properties[kCGImagePropertyGPSDictionary] == nil)
        let tiff = properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
        #expect(tiff?[kCGImagePropertyTIFFMake] == nil)
        #expect(tiff?[kCGImagePropertyTIFFModel] == nil)
        // Nor anywhere in the bytes.
        for secret in ["SecretPhone", "meet me at the gym", "Apple"] {
            #expect(prepared.jpeg.range(of: Data(secret.utf8)) == nil, "\(secret) leaked")
        }
    }

    @Test func turnsSidewaysPhotosUpright() async throws {
        // Stored 300×100, red left and blue right; orientation 6 shows it
        // turned a quarter clockwise: 100×300, red on top, blue below.
        let prepared = try await ProfilePhoto.prepare(makePhoto(width: 300, height: 100, orientation: 6))
        #expect(prepared.width == 100)
        #expect(isRed(try pixel(prepared.jpeg, x: 90, y: 10)))
        #expect(isBlue(try pixel(prepared.jpeg, x: 10, y: 90)))
    }

    @Test func neverEnlargesASmallPhoto() async throws {
        let prepared = try await ProfilePhoto.prepare(makePhoto(width: 200, height: 120))
        #expect(prepared.width == 120)
        #expect(prepared.height == 120)
    }

    @Test func fillsTransparencyWithWhite() async throws {
        let prepared = try await ProfilePhoto.prepare(
            makePhoto(width: 64, height: 64, type: .png, transparent: true)
        )
        let colour = try pixel(prepared.jpeg, x: 32, y: 32)
        #expect(colour.red > 240 && colour.green > 240 && colour.blue > 240)
    }

    @Test func refusesWhatIsntAPhoto() async {
        await #expect(throws: ProfilePhoto.Failure.self) {
            try await ProfilePhoto.prepare(Data("definitely not a photo".utf8))
        }
        await #expect(throws: ProfilePhoto.Failure.self) {
            try await ProfilePhoto.prepare(Data())
        }
    }

    @Test func centresTheSquareOnTheLargestFace() throws {
        let source = try #require(CGImageSourceCreateWithData(makePhoto(width: 300, height: 100) as CFData, nil))
        let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        // A small face on the left and a large one far right, in Vision's
        // coordinates: the square slides right as far as it can, onto blue.
        let faces = [
            CGRect(x: 0.05, y: 0.4, width: 0.05, height: 0.1),
            CGRect(x: 0.85, y: 0.3, width: 0.1, height: 0.4),
        ]
        let square = try ProfilePhoto.squareCrop(image, around: faces)
        let prepared = try ProfilePhoto.encode(square)
        #expect(prepared.width == 100)
        #expect(isBlue(try pixel(prepared.jpeg, x: 5, y: 50)))
        #expect(isBlue(try pixel(prepared.jpeg, x: 95, y: 50)))

        // Without faces it's the middle: red on the left, blue on the right.
        let middle = try ProfilePhoto.encode(ProfilePhoto.squareCrop(image, around: []))
        #expect(isRed(try pixel(middle.jpeg, x: 10, y: 50)))
        #expect(isBlue(try pixel(middle.jpeg, x: 90, y: 50)))
    }

    @Test func readsFacesFromTheBottomLikeVision() throws {
        // 100×300, red on top and blue below. Vision puts a face near the
        // top at a high y.
        let photo = makePhoto(width: 100, height: 300, split: .topBottom)
        let source = try #require(CGImageSourceCreateWithData(photo as CFData, nil))
        let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))

        let top = try ProfilePhoto.encode(
            ProfilePhoto.squareCrop(image, around: [CGRect(x: 0.4, y: 0.85, width: 0.2, height: 0.1)])
        )
        #expect(isRed(try pixel(top.jpeg, x: 50, y: 5)))
        #expect(isRed(try pixel(top.jpeg, x: 50, y: 95)))

        let bottom = try ProfilePhoto.encode(
            ProfilePhoto.squareCrop(image, around: [CGRect(x: 0.4, y: 0.05, width: 0.2, height: 0.1)])
        )
        #expect(isBlue(try pixel(bottom.jpeg, x: 50, y: 5)))
        #expect(isBlue(try pixel(bottom.jpeg, x: 50, y: 95)))
    }
}

// MARK: - The profile itself

@Suite("Me")
struct MeTests {
    @Test func olderServersMeanNothingToConfirm() throws {
        let me = try JSONDecoder().decode(Me.self, from: Data(meJSON().utf8))
        #expect(me.profileReviewed)
        #expect(!me.hopPlus)
        #expect(me.avatarUrl == nil)
        #expect(me.avatarURL == nil)
    }

    @Test func readsTheProfile() throws {
        let me = try JSONDecoder().decode(Me.self, from: Data(profileJSON(
            avatar: "/api/avatars/abcdefghijklmnopqrstuv.jpg", reviewed: false, plus: true
        ).utf8))
        #expect(!me.profileReviewed)
        #expect(me.hopPlus)
        #expect(me.avatarURL == HopServer.baseURL.appending(path: "api/avatars/abcdefghijklmnopqrstuv.jpg"))
    }

    @Test(arguments: ["https://elsewhere.example/a.jpg", "//elsewhere.example/a.jpg", "avatars/a.jpg", ""])
    func onlyLoadsPhotosFromHop(reference: String) throws {
        let me = try JSONDecoder().decode(Me.self, from: Data(profileJSON(avatar: reference).utf8))
        #expect(me.avatarURL == nil)
    }

    @Test func initialFollowsTheName() {
        let me = Me(id: "u", name: "élodie", email: nil, handle: "elo", activeHopId: nil, color: "mint", emailNewClips: true)
        #expect(me.initial == "É")
        let unnamed = Me(id: "u", name: nil, email: nil, handle: "elo", activeHopId: nil, color: "mint", emailNewClips: true)
        #expect(unnamed.initial == "E")
    }
}

/// A profile as the API sends it since profiles.
private func profileJSON(
    name: String? = "Alex Rider",
    avatar: String? = nil,
    reviewed: Bool = false,
    plus: Bool = false
) -> String {
    let nameJSON = name.map { "\"\($0)\"" } ?? "null"
    let avatarJSON = avatar.map { "\"\($0)\"" } ?? "null"
    return """
        {"id":"usr_1","name":\(nameJSON),"email":"alex@example.com","handle":"alex",
         "activeHopId":"hop_1","color":"grape","emailNewClips":true,
         "avatarUrl":\(avatarJSON),"hopPlus":\(plus),"profileReviewed":\(reviewed)}
        """
}

// MARK: - Editing

/// Holds a photo pick until opened, to stage a race between two picks.
private actor Gate {
    private var waiter: CheckedContinuation<Void, Never>?
    private var isOpen = false

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { waiter = $0 }
    }

    func open() {
        isOpen = true
        waiter?.resume()
        waiter = nil
    }
}

@MainActor
@Suite("Editing a profile", .serialized)
struct ProfileEditorTests {
    let server = StubServer(host: "profile-\(UUID().uuidString.lowercased()).test")
    let published = Locked<[Me]>([])

    private func makeEditor(_ json: String = profileJSON()) throws -> ProfileEditor {
        let me = try JSONDecoder().decode(Me.self, from: Data(json.utf8))
        let published = published
        return ProfileEditor(me: me, api: server.client(token: "hs_test")) { published.value.append($0) }
    }

    /// Answers like the API: each write returns the profile it leaves.
    private func serve(
        avatar: String = "/api/avatars/bbbbbbbbbbbbbbbbbbbbbb.jpg",
        name: String = "Alex Rider",
        patch: @escaping @Sendable (URLRequest) -> (Int, String) = { _ in
            (200, #"{"me":\#(profileJSON(name: "Alex Ryder", avatar: "/api/avatars/bbbbbbbbbbbbbbbbbbbbbb.jpg", reviewed: true))}"#)
        }
    ) {
        server.reply = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("PUT", "/api/me/avatar"): (200, #"{"me":\#(profileJSON(name: name, avatar: avatar))}"#)
            case ("DELETE", "/api/me/avatar"): (200, #"{"me":\#(profileJSON())}"#)
            case ("PATCH", "/api/me"): patch(request)
            default: (404, "{}")
            }
        }
    }

    private func body(_ index: Int) throws -> [String: AnyHashable] {
        let data = server.requests[index].body
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: AnyHashable])
    }

    @Test func confirmingSendsOnlyThatTheyveSeenIt() async throws {
        serve()
        let editor = try makeEditor()
        #expect(!editor.hasChanges)
        #expect(await editor.save(confirming: true))

        #expect(server.requests.count == 1)
        #expect(server.requests[0].request.httpMethod == "PATCH")
        #expect(try body(0) == ["profileReviewed": true])
        #expect(published.value.last?.profileReviewed == true)
    }

    @Test func nothingChangedSendsNothing() async throws {
        serve()
        let editor = try makeEditor(profileJSON(reviewed: true))
        #expect(await editor.save(confirming: true))
        #expect(await editor.save())
        #expect(server.requests.isEmpty)
    }

    @Test func savesTheNameAsTheAPIWould() async throws {
        serve()
        let editor = try makeEditor(profileJSON(reviewed: true))
        editor.name = "  Alex \n  Rider "
        #expect(!editor.nameChanged, "the same name, spaced differently")
        editor.name = "  Alex   Ryder "
        #expect(editor.hasChanges)
        #expect(await editor.save())

        #expect(try body(0) == ["displayName": "Alex Ryder"])
        #expect(editor.me.name == "Alex Ryder")
        #expect(!editor.hasChanges)
    }

    @Test func uploadsAPickedPhotoThenTheRest() async throws {
        serve()
        let editor = try makeEditor()
        await editor.choosePhoto { makePhoto(width: 800, height: 600) }
        guard case let .new(prepared) = editor.photo else {
            Issue.record("no photo was prepared")
            return
        }
        #expect(editor.hasChanges)
        #expect(editor.pickedImage != nil)
        editor.name = "Alex Ryder"
        #expect(await editor.save(confirming: true))

        let requests = server.requests
        #expect(requests.map(\.request.httpMethod) == ["PUT", "PATCH"])
        #expect(requests[0].request.url?.path == "/api/me/avatar")
        #expect(requests[0].request.value(forHTTPHeaderField: "Content-Type") == "image/jpeg")
        #expect(requests[0].request.value(forHTTPHeaderField: "Authorization") == "Bearer hs_test")
        #expect(requests[0].body == prepared.jpeg)
        #expect(try body(1) == ["displayName": "Alex Ryder", "profileReviewed": true])
        #expect(editor.photo == .unchanged)
        #expect(editor.pickedImage == nil)
        #expect(published.value.count == 2)
    }

    @Test func removesTheSavedPhoto() async throws {
        serve()
        let editor = try makeEditor(profileJSON(avatar: "/api/avatars/aaaaaaaaaaaaaaaaaaaaaa.jpg", reviewed: true))
        #expect(editor.hasPhoto)
        editor.removePhoto()
        #expect(!editor.hasPhoto)
        #expect(editor.shownPhoto == .none)
        #expect(await editor.save())

        #expect(server.requests.map(\.request.httpMethod) == ["DELETE"])
        #expect(server.requests[0].request.url?.path == "/api/me/avatar")
        #expect(editor.me.avatarUrl == nil)
    }

    @Test func removingAnUnsavedPhotoJustDropsIt() async throws {
        let editor = try makeEditor()
        await editor.choosePhoto { makePhoto(width: 300, height: 300) }
        #expect(editor.hasChanges)
        editor.removePhoto()
        #expect(editor.photo == .unchanged)
        #expect(!editor.hasChanges)
    }

    @Test func keepsWhatSavedWhenALaterStepFails() async throws {
        serve(patch: { _ in (429, #"{"error":"rate_limited","message":"Too many changes. Try again in a minute."}"#) })
        let editor = try makeEditor()
        await editor.choosePhoto { makePhoto(width: 300, height: 300) }
        editor.name = "Alex Ryder"
        #expect(await editor.save(confirming: true) == false)

        #expect(editor.problem == "Too many changes. Try again in a minute.")
        // The photo went through: the app knows, and a retry won't send it again.
        #expect(published.value.last?.avatarUrl == "/api/avatars/bbbbbbbbbbbbbbbbbbbbbb.jpg")
        #expect(editor.photo == .unchanged)
        #expect(editor.name == "Alex Ryder")

        serve()
        #expect(await editor.save(confirming: true))
        #expect(server.requests.map(\.request.httpMethod) == ["PUT", "PATCH", "PATCH"])
        #expect(editor.problem == nil)
    }

    /// The name was changed elsewhere (in Account, while setup was open):
    /// the setup screen's untouched, older name must not be sent back.
    @Test func neverSendsAStaleNameBack() async throws {
        serve(name: "Alex Ryder")
        let editor = try makeEditor()
        await editor.choosePhoto { makePhoto(width: 300, height: 300) }
        #expect(await editor.save(confirming: true))

        #expect(server.requests.map(\.request.httpMethod) == ["PUT", "PATCH"])
        #expect(try body(1) == ["profileReviewed": true])
        #expect(editor.name == "Alex Ryder")
    }

    @Test func followsAProfileChangedElsewhere() throws {
        let editor = try makeEditor()
        let newer = try JSONDecoder().decode(Me.self, from: Data(profileJSON(name: "Alex Ryder", plus: true).utf8))
        editor.sync(with: newer)
        #expect(editor.name == "Alex Ryder")
        #expect(editor.me.hopPlus)
        #expect(!editor.hasChanges)
    }

    @Test func keepsWhatTheyAreEditingThroughAChangeElsewhere() async throws {
        let editor = try makeEditor()
        editor.name = "Alexander"
        await editor.choosePhoto { makePhoto(width: 300, height: 300) }
        let newer = try JSONDecoder().decode(Me.self, from: Data(profileJSON(name: "Alex Ryder", plus: true).utf8))
        editor.sync(with: newer)
        #expect(editor.name == "Alexander")
        #expect(editor.pickedImage != nil)
        #expect(editor.me.hopPlus)
    }

    @Test func aPhotoRemovedElsewhereIsNoLongerAChange() throws {
        let editor = try makeEditor(profileJSON(avatar: "/api/avatars/aaaaaaaaaaaaaaaaaaaaaa.jpg"))
        editor.removePhoto()
        #expect(editor.hasChanges)
        editor.sync(with: try JSONDecoder().decode(Me.self, from: Data(profileJSON().utf8)))
        #expect(editor.photo == .unchanged)
        #expect(!editor.hasChanges)
    }

    @Test func theMarkFollowsThePlan() throws {
        let free = try JSONDecoder().decode(Me.self, from: Data(profileJSON().utf8))
        let plus = try JSONDecoder().decode(Me.self, from: Data(profileJSON(plus: true).utf8))
        #expect(free.isBehind(.plus))
        #expect(!free.isBehind(.free))
        #expect(plus.isBehind(.free))
        #expect(!plus.isBehind(.plus))
    }

    @Test(arguments: [
        ("", "Enter a name."),
        ("   ", "Enter a name."),
        ("@alex", "A name can’t start with @."),
        (String(repeating: "a", count: 51), "That name is too long."),
        (String(repeating: "😀", count: 26), "That name is too long."),
    ])
    func explainsNamesThatCantBeUsed(name: String, problem: String) throws {
        let editor = try makeEditor()
        editor.name = name
        #expect(editor.nameProblem == problem)
        #expect(!editor.canSave)
    }

    @Test(arguments: [String(repeating: "a", count: 50), String(repeating: "😀", count: 25), "Zoë O’Brien-Łukasz"])
    func acceptsNamesUpToTheLimit(name: String) throws {
        let editor = try makeEditor()
        editor.name = name
        #expect(editor.nameProblem == nil)
        #expect(editor.canSave)
    }

    @Test func explainsAPhotoThatCantBeUsed() async throws {
        let editor = try makeEditor()
        await editor.choosePhoto { Data("not a photo".utf8) }
        #expect(editor.problem == "That photo can’t be used. Try another.")
        #expect(editor.photo == .unchanged)
        #expect(!editor.isPreparingPhoto)

        editor.problem = nil
        await editor.choosePhoto { nil }
        #expect(editor.problem == "That photo can’t be used. Try another.")
    }

    @Test func theLatestPickWins() async throws {
        let editor = try makeEditor()
        let gate = Gate()
        let first = Task { await editor.choosePhoto { await gate.wait(); return makePhoto(width: 100, height: 100) } }
        while !editor.isPreparingPhoto { await Task.yield() }

        await editor.choosePhoto { makePhoto(width: 200, height: 200) }
        guard case let .new(second) = editor.photo else {
            Issue.record("the second pick wasn't kept")
            return
        }
        #expect(second.width == 200)

        await gate.open()
        await first.value
        #expect(editor.photo == .new(second))
        #expect(!editor.isPreparingPhoto)
    }

    @Test func removingDropsAPickStillPreparing() async throws {
        let editor = try makeEditor()
        let gate = Gate()
        let pick = Task { await editor.choosePhoto { await gate.wait(); return makePhoto(width: 100, height: 100) } }
        while !editor.isPreparingPhoto { await Task.yield() }
        editor.removePhoto()
        #expect(!editor.isPreparingPhoto)
        await gate.open()
        await pick.value
        #expect(editor.photo == .unchanged)
    }
}
