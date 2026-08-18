import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ScreenCaptureKit
import Vision

final class CaptureState: @unchecked Sendable {
    private let lock = NSLock()
    private var completed = false
    private var image: CGImage?

    func finish(_ image: CGImage?) {
        lock.lock()
        self.image = image
        completed = true
        lock.unlock()
    }

    func snapshot() -> (completed: Bool, image: CGImage?) {
        lock.lock()
        defer { lock.unlock() }
        return (completed, image)
    }
}

func output(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let text = String(data: data, encoding: .utf8) else {
        print(#"{"ok":false,"error":"无法编码辅助组件响应"}"#)
        return
    }
    print(text)
    fflush(stdout)
}

func success(_ payload: Any) {
    output(["ok": true, "payload": payload])
}

func failure(_ message: String) {
    output(["ok": false, "error": message])
}

func diagnostic(_ message: String) {
    guard let data = "[StowMind iOS helper] \(message)\n".data(using: .utf8) else {
        return
    }
    FileHandle.standardError.write(data)
}

func capture(target: WindowTarget) -> CGImage? {
    let state = CaptureState()
    Task {
        var image: CGImage?
        defer { state.finish(image) }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
            guard let window = content.windows.first(where: { $0.windowID == target.id }) else {
                let matchingApplications = content.applications.filter {
                    $0.bundleIdentifier == "com.apple.ScreenContinuity"
                }
                diagnostic(
                    "Mirror window \(target.id) was not present in \(content.windows.count) "
                        + "shareable windows; matching apps: \(matchingApplications.count)"
                )
                return
            }
            let configuration = SCStreamConfiguration()
            configuration.width = max(1, Int(window.frame.width * 2))
            configuration.height = max(1, Int(window.frame.height * 2))
            configuration.showsCursor = false
            image = try await SCScreenshotManager.captureImage(
                contentFilter: SCContentFilter(desktopIndependentWindow: window),
                configuration: configuration
            )
        } catch {
            diagnostic("ScreenCaptureKit failed: \(error.localizedDescription)")
            image = nil
        }
    }

    let deadline = Date().addingTimeInterval(12)
    while Date() < deadline {
        let current = state.snapshot()
        if current.completed {
            return current.image
        }
        Thread.sleep(forTimeInterval: 0.01)
    }
    diagnostic("ScreenCaptureKit timed out for mirror window \(target.id)")
    return nil
}

struct TextHit {
    let text: String
    let confidence: Float
    let box: CGRect
}

func recognizeText(_ image: CGImage) -> [TextHit] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return []
    }

    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2, text.count <= 36 else {
            return nil
        }
        return TextHit(text: text, confidence: candidate.confidence, box: observation.boundingBox)
    }
}

func normalizedId(_ name: String) -> String {
    let scalar = name.lowercased().unicodeScalars.filter {
        CharacterSet.alphanumerics.contains($0) || $0.value >= 0x4E00 && $0.value <= 0x9FFF
    }
    let value = String(String.UnicodeScalarView(scalar))
    return "name-\(value)"
}

func categoryFor(_ name: String) -> (String, Bool) {
    let lower = name.lowercased()
    let sensitiveTerms = [
        "bank", "银行", "wallet", "钱包", "crypto", "coin", "password",
        "密码", "authenticator", "身份验证", "2fa"
    ]
    if sensitiveTerms.contains(where: { lower.contains($0) }) {
        return ("安全", true)
    }
    let terms: [(String, [String])] = [
        ("通讯", ["微信", "消息", "telegram", "whatsapp", "discord", "mail"]),
        ("效率", ["日历", "提醒", "notion", "todo", "calendar", "notes"]),
        ("AI", ["chatgpt", "claude", "gemini", "perplexity", "ai"]),
        ("开发", ["github", "gitlab", "xcode", "terminal", "developer"]),
        ("出行", ["地图", "uber", "旅行", "导航", "flight"]),
        ("购物", ["淘宝", "京东", "amazon", "shop", "购物"]),
        ("内容", ["抖音", "youtube", "bilibili", "小红书", "微博", "news"])
    ]
    for (category, keywords) in terms where keywords.contains(where: { lower.contains($0) }) {
        return (category, false)
    }
    return ("其他", false)
}

let forbiddenTerms = [
    "delete app", "remove app", "remove from home screen", "uninstall",
    "hide page", "reset home screen", "删除 app", "删除应用", "卸载",
    "移除应用", "从主屏幕移除", "移出主屏幕", "隐藏页面", "重置主屏幕"
]

func containsForbiddenText(_ hits: [TextHit]) -> Bool {
    let text = hits.map(\.text).joined(separator: "\n").lowercased()
    return forbiddenTerms.contains(where: { text.contains($0) })
}

private func normalizedControlText(_ value: String) -> String {
    value
        .lowercased()
        .replacingOccurrences(
            of: #"[^\p{L}\p{N}]"#,
            with: "",
            options: .regularExpression
        )
}

func editingModeActive(
    _ hits: [TextHit],
    image: CGImage,
    geometry: MirrorGeometry? = nil
) -> Bool {
    guard let geometry = geometry ?? detectMirrorGeometry(image, hits: hits) else {
        return false
    }

    return hits.contains { hit in
        let text = normalizedControlText(hit.text)
        guard text == "done" || text == "完成",
              hit.confidence >= 0.75 else {
            return false
        }
        let imagePoint = CGPoint(
            x: hit.box.midX * CGFloat(image.width),
            y: (1.0 - hit.box.midY) * CGFloat(image.height)
        )
        let relativeX = (imagePoint.x - geometry.contentRect.minX)
            / max(geometry.contentRect.width, 1.0)
        let relativeY = (imagePoint.y - geometry.contentRect.minY)
            / max(geometry.contentRect.height, 1.0)
        return relativeX >= 0.60
            && relativeX <= 1.05
            && relativeY >= -0.05
            && relativeY <= 0.20
    }
}

func snapshotFromImage(_ image: CGImage, target: WindowTarget) -> [String: Any] {
    let hits = recognizeText(image)
    let geometry = detectMirrorGeometry(image, hits: hits)
    var apps = [[String: Any]]()
    var ids = [String]()
    var seen = Set<String>()

    for hit in hits {
        guard hit.box.width < 0.34 else {
            continue
        }
        guard let geometry,
              let position = gridPosition(hit, image: image, geometry: geometry) else {
            continue
        }
        let id = normalizedId(hit.text)
        if seen.contains(id) {
            continue
        }
        seen.insert(id)
        ids.append(id)
        let (category, sensitive) = categoryFor(hit.text)
        apps.append([
            "id": id,
            "name": hit.text,
            "bundleId": NSNull(),
            "category": category,
            "sensitive": sensitive,
            "confidence": Double(hit.confidence),
            "source": "vision",
            "currentPage": 0,
            "currentRow": position.row,
            "currentColumn": position.column,
            "inDock": false,
            "folderName": NSNull()
        ])
    }

    let joined = ids.sorted().joined(separator: "\n")
    var hash: UInt64 = 1469598103934665603
    for byte in joined.utf8 {
        hash ^= UInt64(byte)
        hash = hash &* 1099511628211
    }

    var warnings = [
        "当前辅助组件仅自动识别镜像中可见的主屏幕页面；App 资源库完整盘点需按页面继续扫描。"
    ]
    if geometry == nil {
        warnings.append("无法可靠定位 iPhone 屏幕内容区域，已停止猜测图标坐标。")
    }
    if containsForbiddenText(hits) {
        warnings.append("检测到删除、移除、隐藏或重置菜单。")
    }

    let hasWidgets = hits.contains { hit in
        let centerY = 1.0 - hit.box.midY
        let largeText = hit.box.width >= 0.34 || hit.box.height >= 0.12
        let nonGridContent = geometry.flatMap {
            gridPosition(hit, image: image, geometry: $0)
        } == nil
            && centerY > 0.18
            && centerY < 0.78
        return largeText || nonGridContent
    }
    let payload: [String: Any] = [
        "id": "ios-snapshot-\(Int(Date().timeIntervalSince1970 * 1000))",
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
        "deviceName": NSNull(),
        "apps": apps,
        "folders": [],
        "pages": [[
            "index": 0,
            "appIds": ids,
            "hasWidgets": hasWidgets
        ]],
        "dock": [],
        "inventoryHash": String(format: "%016llx", hash),
        "confidence": apps.isEmpty ? 0.0 : Double(apps.map { ($0["confidence"] as? Double) ?? 0 }.reduce(0, +) / Double(apps.count)),
        "source": "iPhone Mirroring + Vision",
        "scanScope": "visibleMirrorPage",
        "inventoryComplete": false,
        "warnings": warnings,
        "windowBounds": [
            "x": target.bounds.origin.x,
            "y": target.bounds.origin.y,
            "width": target.bounds.width,
            "height": target.bounds.height
        ]
    ]
    return payload
}

func handle(_ request: [String: Any]) {
    guard let operation = request["operation"] as? String else {
        failure("请求缺少 operation")
        return
    }

    if operation == "capabilities" {
        let accessibility = AXIsProcessTrusted()
        let screenRecording: Bool
        if #available(macOS 10.15, *) {
            screenRecording = CGPreflightScreenCaptureAccess()
        } else {
            screenRecording = false
        }
        let target = findMirroringWindow()
        let connectionState: MirrorConnectionState
        if screenRecording,
           let target,
           let image = capture(target: target) {
            connectionState = mirrorConnectionState(recognizeText(image))
        } else {
            connectionState = .unavailable
        }
        success([
            "accessibilityGranted": accessibility,
            "screenRecordingGranted": screenRecording,
            "mirrorWindowFound": target != nil,
            "mirrorContentReady": connectionState.contentReady,
            "mirrorConnectionState": connectionState.rawValue
        ])
        return
    }

    if operation == "requestPermission" {
        guard let payload = request["payload"] as? [String: Any],
              let permission = payload["permission"] as? String else {
            failure("权限请求缺少 permission")
            return
        }
        let granted: Bool
        switch permission {
        case "screenRecording":
            if #available(macOS 10.15, *) {
                granted = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
            } else {
                granted = false
            }
        case "accessibility":
            let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            granted = AXIsProcessTrustedWithOptions(
                [promptKey: true] as CFDictionary
            )
        default:
            failure("不支持的权限请求")
            return
        }
        success(["granted": granted])
        return
    }

    if handleMirrorPreviewOperation(operation, request: request) {
        return
    }

    guard let target = findMirroringWindow() else {
        failure("找不到 iPhone 镜像窗口，请打开镜像并保持 iPhone 锁定")
        return
    }
    guard let preflightImage = capture(target: target) else {
        failure("无法截取 iPhone 镜像窗口，请检查屏幕录制权限")
        return
    }
    let preflightHits = recognizeText(preflightImage)

    guard !mirrorConnectionBlocked(preflightHits) else {
        diagnostic(
            "Mirror connection blocked text: "
                + preflightHits.map(\.text).joined(separator: " | ")
        )
        failure("iPhone 正在使用中。请锁定 iPhone，等待镜像显示主屏幕后重试")
        return
    }

    if operation == "scanInventory" {
        guard let payload = scanInventoryFromMirror(target: target) else {
            failure("无法完成只读盘点，请确认镜像窗口正在显示主屏幕且没有被遮挡，然后重试")
            return
        }
        success(payload)
        return
    }

    if operation == "captureSnapshot" {
        let payload = snapshotFromImage(
            preflightImage,
            target: target
        )
        success(payload)
        return
    }

    if operation == "executeAction" {
        guard let payload = request["payload"] as? [String: Any],
              let action = payload["action"] as? [String: Any] else {
            failure("执行请求缺少 action")
            return
        }
        let result = executeAction(
            action,
            target: target,
            expectedWindow: payload["expectedWindow"] as? [String: Any]
        )
        success(result)
        return
    }

    failure("不支持的辅助组件操作")
}

let helperApplication = NSApplication.shared
helperApplication.setActivationPolicy(.prohibited)

DispatchQueue(
    label: "com.stowmind.ios-helper.protocol",
    qos: .userInitiated
).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any] else {
            failure("无效 JSON 请求")
            continue
        }
        handle(request)
    }
    DispatchQueue.main.async {
        helperApplication.terminate(nil)
    }
}

helperApplication.run()
