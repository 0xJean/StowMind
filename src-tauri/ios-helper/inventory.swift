import ApplicationServices
import CoreGraphics
import Foundation

let libraryTerms = Set(["applibrary", "资源库", "应用资源库", "app资源库"])

private func visualFingerprint(
    _ image: CGImage,
    geometry: MirrorGeometry
) -> String? {
    let imageRect = CGRect(
        x: 0,
        y: 0,
        width: image.width,
        height: image.height
    )
    let gridRect = homeGridRect(geometry).intersection(imageRect).integral
    guard gridRect.width > 0,
          gridRect.height > 0,
          let cropped = image.cropping(to: gridRect) else {
        return nil
    }

    let width = 24
    let height = 32
    var pixels = [UInt8](repeating: 0, count: width * height)
    let drewImage = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(
            data: buffer.baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else {
            return false
        }
        context.interpolationQuality = .low
        context.draw(
            cropped,
            in: CGRect(x: 0, y: 0, width: width, height: height)
        )
        return true
    }
    guard drewImage else {
        return nil
    }

    var hash: UInt64 = 1469598103934665603
    for pixel in pixels {
        hash ^= UInt64(pixel >> 4)
        hash = hash &* 1099511628211
    }
    return String(format: "%016llx", hash)
}

private func fingerprint(_ image: CGImage) -> String? {
    let hits = recognizeText(image)
    guard let geometry = detectMirrorGeometry(image, hits: hits) else {
        return nil
    }
    let labels = hits
        .filter { gridPosition($0, image: image, geometry: geometry) != nil }
        .map { normalizedId($0.text) }
        .sorted()
        .joined(separator: "|")
    guard let visual = visualFingerprint(image, geometry: geometry) else {
        return labels.isEmpty ? nil : labels
    }
    return "\(labels)#\(visual)"
}

private func isAppLibrary(_ image: CGImage) -> Bool {
    let hits = recognizeText(image)
    guard let geometry = detectMirrorGeometry(image, hits: hits) else { return false }
    return hits.contains { hit in
        let y = (1 - hit.box.midY) * CGFloat(image.height)
        return hit.confidence >= 0.90 && libraryTerms.contains(controlLabel(hit.text))
            && y >= geometry.contentRect.minY
            && y < geometry.contentRect.minY + geometry.contentRect.height * 0.20
    }
}

func inventoryImageIsSafe(
    _ image: CGImage, target: WindowTarget, hits: [TextHit]? = nil
) -> Bool {
    guard !inputWasCancelled() else { return false }
    let hits = hits ?? recognizeText(image)
    if containsForbiddenText(hits) {
        dismissDangerousMenu(target: target)
        return false
    }
    // A page swipe in edit mode can drag an icon. Check before every input,
    // including the initial trip to the beginning of the Home Screen.
    guard mirroringInputTargetStillMatches(target),
          !mirrorConnectionBlocked(hits),
          let geometry = detectMirrorGeometry(image, hits: hits),
          geometry.confidence >= 0.90,
          !editingModeActive(hits, image: image, geometry: geometry) else { return false }
    return true
}

private func hasFirstHomePageEvidence(_ image: CGImage, hits: [TextHit]) -> Bool {
    guard let geometry = detectMirrorGeometry(image, hits: hits) else { return false }
    let searchPositions = hits.filter {
        $0.confidence >= 0.90 && ["search", "搜索"].contains(controlLabel($0.text))
    }.map {
        ((1 - $0.box.midY) * CGFloat(image.height) - geometry.contentRect.minY)
            / geometry.contentRect.height
    }
    // Today View and Spotlight have a top search field; they are not page zero.
    guard !searchPositions.contains(where: { $0 < 0.22 }) else { return false }
    if searchPositions.contains(where: { $0 >= 0.76 && $0 <= 0.90 }) { return true }
    let positions = hits.filter { $0.confidence >= 0.90 && $0.box.width < 0.24 }
        .compactMap { gridPosition($0, image: image, geometry: geometry) }
    return positions.count >= 6
        && Set(positions.map(\.column)).count >= 3
        && Set(positions.map(\.row)).count >= 2
}

func postInventoryClick(_ target: WindowTarget, point: CGPoint) -> Bool {
    guard !inputWasCancelled(),
          prepareMirroringInputTarget(target, points: [point]) != nil else {
        return false
    }
    guard let down = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    ), let up = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    ) else {
        return false
    }
    guard postInputUnlessCancelled({ down.postToPid(target.pid) }) else { return false }
    usleep(40_000)
    // Cancellation still has to release the button already pressed above.
    up.postToPid(target.pid)
    return !inputWasCancelled()
}

private func swipePage(_ target: WindowTarget, image: CGImage, left: Bool) -> Bool {
    guard inventoryImageIsSafe(image, target: target),
          let geometry = detectMirrorGeometry(image),
          geometry.confidence >= 0.90 else {
        return false
    }
    let bounds = globalContentBounds(target: target, image: image, geometry: geometry)
    let y = bounds.minY + bounds.height * 0.48
    let startX = left
        ? bounds.minX + bounds.width * 0.78
        : bounds.minX + bounds.width * 0.22
    let endX = left
        ? bounds.minX + bounds.width * 0.22
        : bounds.minX + bounds.width * 0.78
    return postDrag(
        target: target,
        from: CGPoint(x: startX, y: y),
        to: CGPoint(x: endX, y: y)
    )
}

func swipeLibrary(_ target: WindowTarget, image: CGImage) -> Bool {
    guard inventoryImageIsSafe(image, target: target),
          let geometry = detectMirrorGeometry(image),
          geometry.confidence >= 0.90 else {
        return false
    }
    let bounds = globalContentBounds(target: target, image: image, geometry: geometry)
    return postDrag(
        target: target,
        from: CGPoint(
            x: bounds.minX + bounds.width * 0.52,
            // Search may have a keyboard open. Scroll only the list above it.
            y: bounds.minY + bounds.height * 0.50
        ),
        to: CGPoint(
            x: bounds.minX + bounds.width * 0.52,
            y: bounds.minY + bounds.height * 0.24
        )
    )
}

private func returnToFirstHomePage(_ target: WindowTarget) -> Bool {
    var previous: String?
    var lastHomeFingerprint: String?
    var unchanged = 0
    for _ in 0..<28 {
        guard !inputWasCancelled() else { return false }
        guard let image = capture(target: target) else {
            return false
        }
        let hits = recognizeText(image)
        guard inventoryImageIsSafe(image, target: target, hits: hits) else { return false }
        if isAppLibrary(image) {
            guard swipePage(target, image: image, left: false) else { return false }
            usleep(650_000)
            continue
        }
        guard let current = fingerprint(image) else {
            return false
        }
        let looksLikeHome = hasFirstHomePageEvidence(image, hits: hits)
        if looksLikeHome { lastHomeFingerprint = current }
        if current == previous {
            unchanged += 1
            if unchanged >= 2 {
                if looksLikeHome { return true }
                // The leftmost view may be Today View. Return to the exact
                // neighboring Home Screen we just observed; never count Today
                // View as a Home Screen or guess when starting in an unknown view.
                guard let lastHomeFingerprint,
                      swipePage(target, image: image, left: true) else { return false }
                usleep(700_000)
                guard let home = capture(target: target),
                      inventoryImageIsSafe(home, target: target),
                      fingerprint(home) == lastHomeFingerprint else { return false }
                return hasFirstHomePageEvidence(home, hits: recognizeText(home))
            }
        } else {
            unchanged = 0
        }
        previous = current
        guard swipePage(target, image: image, left: false) else {
            return false
        }
        usleep(650_000)
    }
    return false
}

private func pagePayload(
    _ payload: [String: Any],
    index: Int
) -> [String: Any] {
    var apps = (payload["apps"] as? [[String: Any]]) ?? []
    let sourcePage = (payload["pages"] as? [[String: Any]])?.first
    let hasWidgets = sourcePage?["hasWidgets"] as? Bool ?? false
    var ids = [String]()
    for appIndex in apps.indices {
        apps[appIndex]["currentPage"] = index
        if let id = apps[appIndex]["id"] as? String {
            ids.append(id)
        }
    }
    var result = payload
    result["apps"] = apps
    result["id"] = "ios-page-\(index)-\(Int(Date().timeIntervalSince1970 * 1000))"
    result["pages"] = [[
        "index": index,
        "appIds": ids,
        "hasWidgets": hasWidgets
    ]]
    return result
}

func scanInventoryFromMirror(target: WindowTarget) -> [String: Any]? {
    guard AXIsProcessTrusted() else {
        diagnostic("Interactive inventory was blocked because Accessibility is not trusted")
        return nil
    }
    guard let target = prepareMirroringInputTarget(target),
          returnToFirstHomePage(target),
          let firstImage = capture(target: target) else {
        return nil
    }
    if editingModeActive(
        recognizeText(firstImage),
        image: firstImage
    ) {
        return nil
    }

    var pages = [[String: Any]]()
    var homeApps = [[String: Any]]()
    var seenPageFingerprints = Set<String>()
    var libraryImage: CGImage?
    var reachedLibrary = false

    for pageIndex in 0..<24 {
        guard !inputWasCancelled() else { return nil }
        guard let image = capture(target: target) else {
            return nil
        }
        let hits = recognizeText(image)
        guard inventoryImageIsSafe(image, target: target, hits: hits) else { return nil }
        if isAppLibrary(image) {
            libraryImage = image
            reachedLibrary = true
            break
        }

        guard let currentFingerprint = fingerprint(image) else {
            return nil
        }
        if seenPageFingerprints.contains(currentFingerprint) {
            break
        }
        seenPageFingerprints.insert(currentFingerprint)

        let payload = pagePayload(snapshotFromImage(image, target: target), index: pageIndex)
        if let apps = payload["apps"] as? [[String: Any]] {
            homeApps.append(contentsOf: apps)
        }
        if let page = (payload["pages"] as? [[String: Any]])?.first {
            pages.append(page)
        }

        guard swipePage(target, image: image, left: true) else {
            return nil
        }
        usleep(700_000)
    }

    var libraryAppsResult = [[String: Any]]()
    var complete = false
    if let libraryImage {
        (libraryAppsResult, complete) = scanAppLibrary(target, libraryImage: libraryImage)
    }

    let returnedToFirstPage = returnToFirstHomePage(target)
    let homeIdCounts = homeApps.reduce(into: [String: Int]()) { counts, app in
        guard let id = app["id"] as? String else { return }
        counts[id, default: 0] += 1
    }
    let ambiguousHomeIds = Set(
        homeIdCounts.compactMap { id, count in count > 1 ? id : nil }
    )
    var allApps = homeApps
    let homeIds = Set(homeApps.compactMap { $0["id"] as? String })
    // Home-screen entries are authoritative for position. App Library is only
    // used to add apps that were not found on a Home Screen page; never collapse
    // duplicate Home Screen labels into one identity.
    for index in allApps.indices {
        if let id = allApps[index]["id"] as? String,
           ambiguousHomeIds.contains(id) {
            allApps[index]["confidence"] = 0.0
            allApps[index]["source"] = "ambiguousVision"
        }
    }
    for app in libraryAppsResult {
        guard let id = app["id"] as? String, !homeIds.contains(id) else {
            continue
        }
        allApps.append(app)
    }
    let ids = allApps.compactMap { $0["id"] as? String }.sorted()
    var hash: UInt64 = 1469598103934665603
    for byte in ids.joined(separator: "\n").utf8 {
        hash ^= UInt64(byte)
        hash = hash &* 1099511628211
    }
    let confidenceValues = allApps.compactMap { $0["confidence"] as? Double }
    let confidence = confidenceValues.isEmpty
        ? 0.0
        : confidenceValues.reduce(0, +) / Double(confidenceValues.count)
    let homePagesComplete = reachedLibrary && !pages.isEmpty
    let fullInventoryComplete = complete && homePagesComplete && !allApps.isEmpty
    var warnings = [String]()
    if !homePagesComplete {
        warnings.append("未能可靠遍历到 App 资源库，当前清单只覆盖部分主屏幕页面，禁止用于全局整理方案。")
    } else if !complete {
        warnings.append("已盘点全部主屏幕页面，但未能可靠读取 App 资源库搜索清单。")
    }
    if allApps.isEmpty {
        warnings.append("未识别到 App 名称，请确认镜像窗口没有被遮挡且屏幕录制权限有效。")
    }
    if !returnedToFirstPage {
        warnings.append("盘点结束后未能确认已返回第一主屏幕，请在镜像中手动返回并重新确认当前页面。")
    }
    if homeApps.contains(where: { ($0["confidence"] as? Double) == 0 }) {
        warnings.append("主屏幕存在同名 App 或同格位识别冲突，相关结果已降级为人工处理。")
    }
    if !ambiguousHomeIds.isEmpty {
        warnings.append(
            "\(ambiguousHomeIds.count) 个 App 名称在多个主屏幕位置重复，已禁止自动移动。"
        )
    }

    return [
        "id": "ios-inventory-\(Int(Date().timeIntervalSince1970 * 1000))",
        "capturedAt": ISO8601DateFormatter().string(from: Date()),
        "deviceName": NSNull(),
        "apps": allApps,
        "folders": [],
        "pages": pages,
        "dock": [],
        "inventoryHash": String(format: "%016llx", hash),
        "confidence": confidence,
        "source": "iPhone Mirroring + Vision",
        "scanScope": fullInventoryComplete
            ? "homeScreenAndAppLibrary"
            : homePagesComplete
                ? "homeScreenPages"
                : "partialHomeScreenPages",
        "inventoryComplete": fullInventoryComplete,
        "warnings": warnings,
        "windowBounds": [
            "x": target.bounds.origin.x,
            "y": target.bounds.origin.y,
            "width": target.bounds.width,
            "height": target.bounds.height
        ]
    ]
}
