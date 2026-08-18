import ApplicationServices
import CoreGraphics
import Foundation

private let libraryTerms = ["app library", "资源库", "应用资源库", "app资源库"]
private let searchTerms = ["search", "搜索"]
private let ignoredLibraryLabels = Set([
    "app library", "资源库", "应用资源库", "search", "搜索", "cancel", "取消",
    "today", "今天", "suggestions", "建议", "recently added", "最近添加"
])

private func textContains(_ value: String, terms: [String]) -> Bool {
    let normalized = value.lowercased().replacingOccurrences(of: " ", with: "")
    return terms.contains {
        normalized.contains($0.lowercased().replacingOccurrences(of: " ", with: ""))
    }
}

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
    textContains(recognizeText(image).map(\.text).joined(separator: "\n"), terms: libraryTerms)
}

private func postClick(_ target: WindowTarget, point: CGPoint) -> Bool {
    guard prepareMirroringInputTarget(target, points: [point]) != nil else {
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
    down.postToPid(target.pid)
    usleep(40_000)
    up.postToPid(target.pid)
    return true
}

private func swipePage(_ target: WindowTarget, image: CGImage, left: Bool) -> Bool {
    guard let geometry = detectMirrorGeometry(image),
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

private func swipeLibrary(_ target: WindowTarget, image: CGImage) -> Bool {
    guard let geometry = detectMirrorGeometry(image),
          geometry.confidence >= 0.90 else {
        return false
    }
    let bounds = globalContentBounds(target: target, image: image, geometry: geometry)
    return postDrag(
        target: target,
        from: CGPoint(
            x: bounds.minX + bounds.width * 0.52,
            y: bounds.maxY - bounds.height * 0.12
        ),
        to: CGPoint(
            x: bounds.minX + bounds.width * 0.52,
            y: bounds.minY + bounds.height * 0.12
        )
    )
}

private func returnToFirstHomePage(_ target: WindowTarget) -> Bool {
    var previous: String?
    for _ in 0..<28 {
        guard let image = capture(target: target) else {
            return false
        }
        let hits = recognizeText(image)
        if containsForbiddenText(hits) {
            dismissDangerousMenu(target: target)
            return false
        }
        if isAppLibrary(image) {
            guard swipePage(target, image: image, left: false) else { return false }
            usleep(650_000)
            continue
        }
        guard let current = fingerprint(image) else {
            return false
        }
        if current == previous {
            // A right swipe that leaves the fingerprint unchanged confirms
            // that the mirror is already on the first Home Screen page.
            return true
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

private func libraryApps(_ image: CGImage) -> [[String: Any]] {
    let hits = recognizeText(image)
    var apps = [[String: Any]]()
    var seen = Set<String>()
    for hit in hits {
        let value = hit.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = value.lowercased()
        guard hit.confidence >= 0.90,
              value.count >= 2,
              value.count <= 36,
              !ignoredLibraryLabels.contains(normalized),
              !textContains(value, terms: libraryTerms),
              !containsForbiddenText([hit]) else {
            continue
        }
        let id = normalizedId(value)
        guard !seen.contains(id) else {
            continue
        }
        seen.insert(id)
        let (category, sensitive) = categoryFor(value)
        apps.append([
            "id": id,
            "name": value,
            "bundleId": NSNull(),
            "category": category,
            "sensitive": sensitive,
            "confidence": Double(hit.confidence),
            "source": "appLibraryVision",
            "currentPage": NSNull(),
            "currentRow": NSNull(),
            "currentColumn": NSNull(),
            "inDock": false,
            "folderName": NSNull()
        ])
    }
    return apps
}

private func scanAppLibrary(
    _ target: WindowTarget,
    libraryImage: CGImage
) -> ([[String: Any]], Bool) {
    let hits = recognizeText(libraryImage)
    guard let geometry = detectMirrorGeometry(libraryImage, hits: hits),
          geometry.confidence >= 0.90 else {
        return ([], false)
    }
    guard let searchHit = hits.first(where: {
        textContains($0.text, terms: libraryTerms)
    }) else {
        return ([], false)
    }

    let imagePoint = CGPoint(
        x: searchHit.box.midX * CGFloat(libraryImage.width),
        y: (1 - searchHit.box.midY) * CGFloat(libraryImage.height)
    )
    guard geometry.contentRect.contains(imagePoint) else {
        return ([], false)
    }
    let point = globalPoint(
        target: target,
        image: libraryImage,
        imagePoint: imagePoint
    )
    guard postClick(target, point: point) else {
        return ([], false)
    }
    usleep(500_000)
    guard let searchImage = capture(target: target),
          recognizeText(searchImage).contains(where: {
              textContains($0.text, terms: searchTerms)
          }) else {
        return ([], false)
    }

    var allApps = [[String: Any]]()
    var seen = Set<String>()
    var previous: String?
    for _ in 0..<80 {
        guard let image = capture(target: target) else {
            return (allApps, false)
        }
        let currentHits = recognizeText(image)
        if containsForbiddenText(currentHits) {
            dismissDangerousMenu(target: target)
            return (allApps, false)
        }
        for app in libraryApps(image) {
            guard let id = app["id"] as? String, !seen.contains(id) else {
                continue
            }
            seen.insert(id)
            allApps.append(app)
        }

        let current = currentHits.map(\.text).joined(separator: "|")
        if current == previous {
            break
        }
        previous = current
        guard swipeLibrary(target, image: image) else {
            return (allApps, false)
        }
        usleep(650_000)
    }

    dismissDangerousMenu(target: target)
    return (allApps, allApps.count >= 2)
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
        guard let image = capture(target: target) else {
            return nil
        }
        let hits = recognizeText(image)
        if containsForbiddenText(hits) {
            dismissDangerousMenu(target: target)
            return nil
        }
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

    _ = returnToFirstHomePage(target)
    let homeIdCounts = homeApps.reduce(into: [String: Int]()) { counts, app in
        guard let id = app["id"] as? String else { return }
        counts[id, default: 0] += 1
    }
    let ambiguousHomeIds = Set(
        homeIdCounts.compactMap { id, count in count > 1 ? id : nil }
    )
    var allApps = [[String: Any]]()
    var seenApps = Set<String>()
    for var app in homeApps + libraryAppsResult {
        guard let id = app["id"] as? String, !seenApps.contains(id) else {
            continue
        }
        if ambiguousHomeIds.contains(id) {
            app["confidence"] = 0.0
            app["source"] = "ambiguousVision"
        }
        seenApps.insert(id)
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
    var warnings = [String]()
    if !homePagesComplete {
        warnings.append("未能可靠遍历到 App 资源库，当前清单只覆盖部分主屏幕页面，禁止用于全局整理方案。")
    } else if !complete {
        warnings.append("已盘点全部主屏幕页面，但未能可靠读取 App 资源库搜索清单。")
    }
    if allApps.isEmpty {
        warnings.append("未识别到 App 名称，请确认镜像窗口没有被遮挡且屏幕录制权限有效。")
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
        "scanScope": complete
            ? "homeScreenAndAppLibrary"
            : homePagesComplete
                ? "homeScreenPages"
                : "partialHomeScreenPages",
        "inventoryComplete": complete,
        "warnings": warnings,
        "windowBounds": [
            "x": target.bounds.origin.x,
            "y": target.bounds.origin.y,
            "width": target.bounds.width,
            "height": target.bounds.height
        ]
    ]
}
