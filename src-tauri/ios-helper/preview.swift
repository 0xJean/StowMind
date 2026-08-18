import Foundation

enum MirrorConnectionState: String {
    case ready
    case paused
    case blocked
    case unavailable

    var contentReady: Bool {
        self == .ready
    }
}

private func normalizedMirrorText(_ hits: [TextHit]) -> String {
    hits
        .map(\.text)
        .joined(separator: "\n")
        .lowercased()
        .replacingOccurrences(
            of: #"[^\p{L}\p{N}]"#,
            with: "",
            options: .regularExpression
        )
}

func mirrorConnectionState(_ hits: [TextHit]) -> MirrorConnectionState {
    let text = normalizedMirrorText(hits)
    let pausedTerms = [
        "连接暂停",
        "连接已暂停",
        "connectionpaused"
    ]
    if pausedTerms.contains(where: { text.contains($0) }) {
        return .paused
    }

    let blockedTerms = [
        "iphone使用中",
        "锁定iphone以连接",
        "iphoneinuse",
        "iphoneiscurrentlyinuse",
        "lockiphonetoconnect"
    ]
    return blockedTerms.contains(where: { text.contains($0) }) ? .blocked : .ready
}

func mirrorConnectionBlocked(_ hits: [TextHit]) -> Bool {
    !mirrorConnectionState(hits).contentReady
}
