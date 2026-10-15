import CoreGraphics
import Foundation

private func listLabels(
    _ hits: [TextHit], image: CGImage, geometry: MirrorGeometry
) -> [LibraryListLabel] {
    let content = geometry.contentRect
    return hits.map { hit in
        LibraryListLabel(
            text: hit.text, confidence: hit.confidence,
            x: Double((hit.box.minX * CGFloat(image.width) - content.minX) / content.width),
            y: Double(((1 - hit.box.midY) * CGFloat(image.height) - content.minY) / content.height),
            width: Double(hit.box.width * CGFloat(image.width) / content.width),
            height: Double(hit.box.height * CGFloat(image.height) / content.height)
        )
    }
}

func scanAppLibrary(
    _ target: WindowTarget, libraryImage: CGImage
) -> ([[String: Any]], Bool) {
    let hits = recognizeText(libraryImage)
    guard inventoryImageIsSafe(libraryImage, target: target, hits: hits),
          let geometry = detectMirrorGeometry(libraryImage, hits: hits),
          geometry.confidence >= 0.90 else { return ([], false) }
    let headings = hits.filter { hit in
        let point = CGPoint(
            x: hit.box.midX * CGFloat(libraryImage.width),
            y: (1 - hit.box.midY) * CGFloat(libraryImage.height)
        )
        return libraryTerms.contains(controlLabel(hit.text)) && hit.confidence >= 0.90
            && geometry.contentRect.contains(point)
            && point.y < geometry.contentRect.minY + geometry.contentRect.height * 0.20
    }
    guard headings.count == 1 else { return ([], false) }
    let search = headings[0]
    let point = globalPoint(
        target: target, image: libraryImage,
        imagePoint: CGPoint(
            x: search.box.midX * CGFloat(libraryImage.width),
            y: (1 - search.box.midY) * CGFloat(libraryImage.height)
        )
    )
    guard postInventoryClick(target, point: point) else { return ([], false) }
    usleep(500_000)

    var allApps = [String: [String: Any]]()
    var progress = LibraryScanProgress()
    var reachedEnd = false
    for _ in 0..<80 {
        guard !inputWasCancelled() else { break }
        guard let image = capture(target: target) else { break }
        let currentHits = recognizeText(image)
        guard inventoryImageIsSafe(image, target: target, hits: currentHits),
              let currentGeometry = detectMirrorGeometry(image, hits: currentHits),
              currentGeometry.confidence >= 0.90,
              let rows = reliableLibraryRows(
                  listLabels(currentHits, image: image, geometry: currentGeometry)
              ) else { break }
        let ids = rows.map { normalizedId($0.text) }
        // Repeated labels in separate list rows cannot be collapsed into one app.
        guard Set(ids).count == ids.count else { break }
        for row in rows {
            let id = normalizedId(row.text)
            let (category, sensitive) = categoryFor(row.text)
            allApps[id] = [
                "id": id, "name": row.text, "bundleId": NSNull(),
                "category": category, "sensitive": sensitive,
                "confidence": Double(row.confidence), "source": "appLibraryVision",
                "currentPage": NSNull(), "currentRow": NSNull(),
                "currentColumn": NSNull(), "inDock": false, "folderName": NSNull()
            ]
        }
        // Use list identity/order, not pixels: a cursor or keyboard animation
        // cannot be counted as successful list scrolling.
        if progress.observe(ids.joined(separator: "|"), hasReliableRows: true) {
            reachedEnd = true
            break
        }
        guard swipeLibrary(target, image: image) else { break }
        usleep(650_000)
    }
    dismissDangerousMenu(target: target)
    return (allApps.keys.sorted().compactMap { allApps[$0] }, reachedEnd)
}
