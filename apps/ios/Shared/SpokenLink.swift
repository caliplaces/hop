import Foundation

nonisolated extension URL {
    /// "onmyhop.com/alex": a link as people say it, without the scheme.
    var spoken: String {
        let port = port.map { ":\($0)" } ?? ""
        return "\(host() ?? "")\(port)\(path())"
    }
}
