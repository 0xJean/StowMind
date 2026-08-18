import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private let mirroringBundleIdentifier = "com.apple.ScreenContinuity"

struct WindowTarget {
    let id: CGWindowID
    let bounds: CGRect
    let pid: pid_t
}

private func windowTarget(from item: [String: Any]) -> WindowTarget? {
    guard let idValue = item[kCGWindowNumber as String] as? NSNumber,
          let bounds = item[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
          let pid = (item[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
          NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
              == mirroringBundleIdentifier,
          rect.width >= 240,
          rect.height >= 400 else {
        return nil
    }
    return WindowTarget(
        id: CGWindowID(idValue.uint32Value),
        bounds: rect,
        pid: pid
    )
}

private func visibleWindowItems() -> [[String: Any]] {
    CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] ?? []
}

func findMirroringWindow() -> WindowTarget? {
    let candidates = visibleWindowItems().compactMap(windowTarget(from:))
    guard candidates.count == 1 else {
        diagnostic(
            "Expected one trusted iPhone Mirroring window, found \(candidates.count)"
        )
        return nil
    }
    return candidates[0]
}

private func boundsMatch(_ expected: CGRect, _ actual: CGRect) -> Bool {
    let tolerance = 2.0
    return abs(expected.origin.x - actual.origin.x) <= tolerance
        && abs(expected.origin.y - actual.origin.y) <= tolerance
        && abs(expected.width - actual.width) <= tolerance
        && abs(expected.height - actual.height) <= tolerance
}

private func pointIsUnobscured(_ point: CGPoint, target: WindowTarget) -> Bool {
    for item in visibleWindowItems() {
        guard let layer = (item[kCGWindowLayer as String] as? NSNumber)?.intValue,
              layer == 0,
              let alpha = (item[kCGWindowAlpha as String] as? NSNumber)?.doubleValue,
              alpha > 0.01,
              let bounds = item[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              rect.width > 2,
              rect.height > 2,
              rect.contains(point),
              let idValue = item[kCGWindowNumber as String] as? NSNumber else {
            continue
        }
        return CGWindowID(idValue.uint32Value) == target.id
    }
    return false
}

func prepareMirroringInputTarget(
    _ target: WindowTarget,
    points: [CGPoint] = []
) -> WindowTarget? {
    guard let app = NSRunningApplication(processIdentifier: target.pid),
          app.bundleIdentifier == mirroringBundleIdentifier else {
        return nil
    }
    _ = app.activate(options: [.activateAllWindows])

    let deadline = Date().addingTimeInterval(1.0)
    while Date() < deadline {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == target.pid {
            break
        }
        Thread.sleep(forTimeInterval: 0.02)
    }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.pid,
          let current = findMirroringWindow(),
          current.id == target.id,
          current.pid == target.pid,
          boundsMatch(target.bounds, current.bounds),
          points.allSatisfy({ pointIsUnobscured($0, target: current) }) else {
        return nil
    }
    return current
}

func dismissDangerousMenu(target: WindowTarget) {
    guard prepareMirroringInputTarget(target) != nil,
          let down = CGEvent(
              keyboardEventSource: nil,
              virtualKey: 53,
              keyDown: true
          ),
          let up = CGEvent(
              keyboardEventSource: nil,
              virtualKey: 53,
              keyDown: false
          ) else {
        return
    }
    down.postToPid(target.pid)
    up.postToPid(target.pid)
}
