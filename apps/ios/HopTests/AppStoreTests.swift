import Foundation
import Testing

/// What App Store Connect reads from the built app, checked on the bundles
/// themselves: the tests run inside the app, so `Bundle.main` is Hop.app.
@Suite("App Store")
struct AppStoreTests {
    /// Hop only uses Apple's own encryption (HTTPS, the Keychain), so no build
    /// waits on the export compliance question.
    @Test func declaresExemptEncryption() {
        let value = Bundle.main.object(forInfoDictionaryKey: "ITSAppUsesNonExemptEncryption")
        #expect(value as? Bool == false)
    }

    @Test func appDeclaresItsUserDefaults() throws {
        let manifest = try Self.manifest(in: Bundle.main.bundleURL)
        #expect(manifest.tracking == false)
        #expect(manifest.trackingDomains == [])
        #expect(manifest.reasons == ["NSPrivacyAccessedAPICategoryUserDefaults": ["CA92.1", "1C8F.1"]])
    }

    @Test func widgetsDeclareTheirUserDefaults() throws {
        let widgets = try #require(Bundle.main.builtInPlugInsURL)
            .appending(path: "HopWidgets.appex")
        let manifest = try Self.manifest(in: widgets)
        #expect(manifest.tracking == false)
        #expect(manifest.trackingDomains == [])
        #expect(manifest.reasons == ["NSPrivacyAccessedAPICategoryUserDefaults": ["1C8F.1"]])
    }

    /// The app and its widgets ship as one version.
    @Test func widgetsShareTheAppsVersion() throws {
        let widgets = try #require(Bundle.main.builtInPlugInsURL)
            .appending(path: "HopWidgets.appex")
        let bundle = try #require(Bundle(url: widgets))
        for key in ["CFBundleShortVersionString", "CFBundleVersion"] {
            let app = Bundle.main.object(forInfoDictionaryKey: key) as? String
            #expect(app != nil)
            #expect(bundle.object(forInfoDictionaryKey: key) as? String == app)
        }
    }

    private struct Manifest {
        var tracking: Bool?
        var trackingDomains: [String]?
        var reasons: [String: [String]]
    }

    private static func manifest(in bundle: URL) throws -> Manifest {
        let data = try Data(contentsOf: bundle.appending(path: "PrivacyInfo.xcprivacy"))
        let plist = try #require(
            try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
        let types = try #require(plist["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
        var reasons: [String: [String]] = [:]
        for entry in types {
            let type = try #require(entry["NSPrivacyAccessedAPIType"] as? String)
            reasons[type] = try #require(entry["NSPrivacyAccessedAPITypeReasons"] as? [String])
        }
        return Manifest(
            tracking: plist["NSPrivacyTracking"] as? Bool,
            trackingDomains: plist["NSPrivacyTrackingDomains"] as? [String],
            reasons: reasons
        )
    }
}
