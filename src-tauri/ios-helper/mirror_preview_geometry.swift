import AppKit
import CoreGraphics
import Foundation

func previewHostWindowBounds(
    id: CGWindowID,
    ownerPid: pid_t
) -> CGRect? {
    guard let list = CGWindowListCopyWindowInfo(
        [.optionIncludingWindow],
        id
    ) as? [[String: Any]] else {
        return nil
    }
    for item in list {
        let windowId = (item[kCGWindowNumber as String] as? NSNumber)?.uint32Value
        let pid = (item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
        let onScreen = (item[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue
        guard windowId == id,
              pid == ownerPid,
              onScreen != false,
              let rawBounds = item[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(
                  dictionaryRepresentation: rawBounds as CFDictionary
              ),
              bounds.width >= 400,
              bounds.height >= 300 else {
            continue
        }
        return bounds
    }
    return nil
}

func appKitRect(fromGlobalCGRect rect: CGRect) -> CGRect? {
    guard let screen = previewScreen(containing: CGPoint(
        x: rect.midX,
        y: rect.midY
    )),
    let displayBounds = previewDisplayBounds(for: screen) else {
        return nil
    }
    return CGRect(
        x: screen.frame.minX + rect.minX - displayBounds.minX,
        y: screen.frame.maxY - rect.maxY + displayBounds.minY,
        width: rect.width,
        height: rect.height
    )
}

func suggestedCompanionBounds(for mirror: CGRect) -> CGRect? {
    guard let screen = previewScreen(containing: CGPoint(
        x: mirror.midX,
        y: mirror.midY
    )),
    let visible = globalCGRect(fromAppKitRect: screen.visibleFrame, screen: screen) else {
        return nil
    }
    let gap: CGFloat = 14
    let margin: CGFloat = 12
    let preferredWidth: CGFloat = 500
    let leftSpace = mirror.minX - visible.minX - gap
    let rightSpace = visible.maxX - mirror.maxX - gap
    let available = max(leftSpace, rightSpace)
    let width = min(preferredWidth, max(400, available - margin))
    let x: CGFloat
    if rightSpace >= leftSpace {
        x = min(visible.maxX - width - margin, mirror.maxX + gap)
    } else {
        x = max(visible.minX + margin, mirror.minX - gap - width)
    }
    let height = min(780, visible.height - margin * 2)
    return CGRect(
        x: x,
        y: visible.minY + margin,
        width: width,
        height: height
    )
}

func dictionary(for rect: CGRect) -> [String: CGFloat] {
    [
        "x": rect.minX,
        "y": rect.minY,
        "width": rect.width,
        "height": rect.height
    ]
}

private func globalCGRect(fromAppKitRect rect: CGRect, screen: NSScreen) -> CGRect? {
    guard let displayBounds = previewDisplayBounds(for: screen) else {
        return nil
    }
    return CGRect(
        x: displayBounds.minX + rect.minX - screen.frame.minX,
        y: displayBounds.minY + screen.frame.maxY - rect.maxY,
        width: rect.width,
        height: rect.height
    )
}

private func previewScreen(containing point: CGPoint) -> NSScreen? {
    NSScreen.screens.first {
        previewDisplayBounds(for: $0)?.contains(point) == true
    }
}

private func previewDisplayBounds(for screen: NSScreen) -> CGRect? {
    guard let number = screen.deviceDescription[
        NSDeviceDescriptionKey("NSScreenNumber")
    ] as? NSNumber else {
        return nil
    }
    return CGDisplayBounds(CGDirectDisplayID(number.uint32Value))
}

extension CGRect {
    func approximatelyEquals(_ other: CGRect) -> Bool {
        abs(minX - other.minX) < 0.75
            && abs(minY - other.minY) < 0.75
            && abs(width - other.width) < 0.75
            && abs(height - other.height) < 0.75
    }
}
