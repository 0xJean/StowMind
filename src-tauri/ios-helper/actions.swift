import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func globalPoint(
    _ target: WindowTarget,
    image: CGImage,
    geometry: MirrorGeometry,
    page: Int,
    row: Int,
    column: Int
) -> CGPoint? {
    guard (0...99).contains(page), (0...5).contains(row), (0...3).contains(column) else {
        return nil
    }
    let grid = homeGridRect(geometry)
    let imagePoint = CGPoint(
        x: grid.minX + (CGFloat(column) + 0.5) * grid.width / 4.0,
        y: grid.minY + (CGFloat(row) + 0.5) * grid.height / 6.0
    )
    let point = globalPoint(target: target, image: image, imagePoint: imagePoint)
    let contentBounds = globalContentBounds(
        target: target,
        image: image,
        geometry: geometry
    )
    return contentBounds.contains(point) ? point : nil
}

func dockPoint(
    _ target: WindowTarget,
    image: CGImage,
    geometry: MirrorGeometry,
    index: Int
) -> CGPoint? {
    guard (0...3).contains(index) else {
        return nil
    }
    let content = geometry.contentRect
    let imagePoint = CGPoint(
        x: content.minX + (CGFloat(index) + 0.5) * content.width / 4.0,
        y: content.minY + content.height * 0.91
    )
    let point = globalPoint(target: target, image: image, imagePoint: imagePoint)
    let contentBounds = globalContentBounds(
        target: target,
        image: image,
        geometry: geometry
    )
    return contentBounds.contains(point) ? point : nil
}

func postDrag(target: WindowTarget, from: CGPoint, to: CGPoint) -> Bool {
    guard prepareMirroringInputTarget(target, points: [from, to]) != nil else {
        return false
    }
    guard let source = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: from,
        mouseButton: .left
    ),
    let move = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDragged,
        mouseCursorPosition: to,
        mouseButton: .left
    ),
    let release = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: to,
        mouseButton: .left
    ) else {
        return false
    }
    source.postToPid(target.pid)
    usleep(80_000)
    for step in 1...12 {
        let progress = CGFloat(step) / 12.0
        let point = CGPoint(
            x: from.x + (to.x - from.x) * progress,
            y: from.y + (to.y - from.y) * progress
        )
        move.location = point
        move.postToPid(target.pid)
        usleep(35_000)
    }
    release.postToPid(target.pid)
    return true
}

func windowMatches(_ expected: [String: Any]?, target: WindowTarget) -> Bool {
    guard let expected,
          let x = expected["x"] as? Double,
          let y = expected["y"] as? Double,
          let width = expected["width"] as? Double,
          let height = expected["height"] as? Double else {
        return true
    }
    let tolerance = 2.0
    return abs(target.bounds.origin.x - x) <= tolerance
        && abs(target.bounds.origin.y - y) <= tolerance
        && abs(target.bounds.width - width) <= tolerance
        && abs(target.bounds.height - height) <= tolerance
}

func guidance(_ message: String, canResume: Bool = false) -> [String: Any] {
    [
        "performed": false,
        "alreadySatisfied": false,
        "requiresGuidance": true,
        "canResume": canResume,
        "message": message
    ]
}

func executeAction(
    _ action: [String: Any],
    target: WindowTarget,
    expectedWindow: [String: Any]?
) -> [String: Any] {
    guard AXIsProcessTrusted() else {
        return guidance("当前镜像辅助组件没有辅助功能权限，未发送任何输入事件")
    }
    guard let type = action["type"] as? String else {
        return guidance("动作缺少类型")
    }
    guard windowMatches(expectedWindow, target: target) else {
        return guidance("iPhone 镜像窗口已移动或缩放，请确认窗口后继续")
    }
    guard let before = capture(target: target) else {
        return guidance("动作前安全截图失败，请检查屏幕录制权限")
    }
    let hits = recognizeText(before)
    guard let beforeGeometry = detectMirrorGeometry(before, hits: hits),
          beforeGeometry.confidence >= 0.90 else {
        return guidance("无法以 90% 以上置信度定位 iPhone 屏幕，未发送任何输入事件")
    }
    if containsForbiddenText(hits) {
        dismissDangerousMenu(target: target)
        return guidance("检测到删除、移除或重置菜单，已关闭菜单并暂停")
    }
    guard editingModeActive(
        hits,
        image: before,
        geometry: beforeGeometry
    ) else {
        return guidance(
            "请在 iPhone 镜像中手动长按确认的空白区域进入编辑模式，然后继续",
            canResume: true
        )
    }

    guard type == "moveApp" else {
        return guidance("此动作采用人工引导，请在镜像中完成后重新盘点并验证")
    }
    guard let fromPage = action["fromPage"] as? Int,
          let fromRow = action["fromRow"] as? Int,
          let fromColumn = action["fromColumn"] as? Int,
          let appId = action["appId"] as? String,
          let from = globalPoint(
              target,
              image: before,
              geometry: beforeGeometry,
              page: fromPage,
              row: fromRow,
              column: fromColumn
          ) else {
        return guidance("来源 App 坐标无效，请重新盘点")
    }
    let matches = hits.filter {
        guard normalizedId($0.text) == appId,
              let position = gridPosition(
                  $0,
                  image: before,
                  geometry: beforeGeometry
              ) else {
            return false
        }
        return position.row == fromRow && position.column == fromColumn
    }
    guard matches.count == 1, matches[0].confidence >= 0.90 else {
        return guidance("来源 App 识别不唯一或置信度低于 90%，请人工确认")
    }

    guard let toPage = action["toPage"] as? Int,
          let toRow = action["toRow"] as? Int,
          let toColumn = action["toColumn"] as? Int else {
        return guidance("目标 App 坐标无效，请重新生成方案")
    }
    guard fromPage == toPage else {
        return guidance("跨页面移动采用人工引导，完成后请重新盘点")
    }
    let occupiedTarget = hits.contains {
        guard let position = gridPosition(
            $0,
            image: before,
            geometry: beforeGeometry
        ) else {
            return false
        }
        return position.row == toRow && position.column == toColumn
    }
    guard !occupiedTarget else {
        return guidance("目标格位已被识别到的 App 占用，请重新生成方案")
    }
    guard let to = globalPoint(
        target,
        image: before,
        geometry: beforeGeometry,
        page: toPage,
        row: toRow,
        column: toColumn
    ) else {
        return guidance("目标位置超出镜像安全区域")
    }
    guard postDrag(target: target, from: from, to: to) else {
        return guidance("无法发送安全拖拽事件")
    }
    usleep(700_000)
    guard let after = capture(target: target) else {
        return guidance("动作后安全截图失败，未确认 App 位置")
    }
    let afterHits = recognizeText(after)
    guard let afterGeometry = detectMirrorGeometry(after, hits: afterHits),
          afterGeometry.confidence >= 0.90 else {
        return guidance("动作后无法可靠定位 iPhone 屏幕，已暂停验证")
    }
    if containsForbiddenText(afterHits) {
        dismissDangerousMenu(target: target)
        return guidance("动作后出现删除或移除菜单，已关闭菜单并暂停验证")
    }
    let atTarget = afterHits.contains {
        guard normalizedId($0.text) == appId,
              let position = gridPosition(
                  $0,
                  image: after,
                  geometry: afterGeometry
              ) else {
            return false
        }
        return position.row == toRow && position.column == toColumn
    }
    let stillAtSource = afterHits.contains {
        guard normalizedId($0.text) == appId,
              let position = gridPosition(
                  $0,
                  image: after,
                  geometry: afterGeometry
              ) else {
            return false
        }
        return position.row == fromRow && position.column == fromColumn
    }
    guard atTarget && !stillAtSource else {
        return guidance("动作后未能唯一确认目标位置，已暂停")
    }
    return [
        "performed": true,
        "alreadySatisfied": false,
        "requiresGuidance": false,
        "canResume": false,
        "message": NSNull()
    ]
}
