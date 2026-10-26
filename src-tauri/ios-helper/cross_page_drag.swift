import CoreGraphics
import Foundation

enum CrossPageDragOutcome {
    case dropped
    case cancelled
    case inputFailed
    case landingRejected(String)
}

// Hold an already-lifted icon at the screen edge to let SpringBoard flip one
// page, then return to the middle so the flip does not repeat. The landing
// page is verified by OCR before the icon is dropped. If verification fails,
// the icon is carried back the same number of pages and dropped at its
// original slot, which was the page's last icon and is therefore empty.
func postCrossPageDrag(
    target: WindowTarget,
    from: CGPoint,
    to: CGPoint,
    contentBounds: CGRect,
    flips: Int,
    forward: Bool,
    verifyLanding: () -> String?
) -> CrossPageDragOutcome {
    let y = contentBounds.minY + contentBounds.height * 0.45
    let inset = contentBounds.width * 0.03
    let forwardEdge = CGPoint(x: contentBounds.maxX - inset, y: y)
    let backwardEdge = CGPoint(x: contentBounds.minX + inset, y: y)
    let middle = CGPoint(x: contentBounds.midX, y: y)
    guard flips > 0,
          !inputWasCancelled(),
          prepareMirroringInputTarget(
              target, points: [from, to, forwardEdge, backwardEdge, middle]
          ) != nil,
          let down = CGEvent(
              mouseEventSource: nil, mouseType: .leftMouseDown,
              mouseCursorPosition: from, mouseButton: .left
          ),
          let drag = CGEvent(
              mouseEventSource: nil, mouseType: .leftMouseDragged,
              mouseCursorPosition: from, mouseButton: .left
          ),
          let release = CGEvent(
              mouseEventSource: nil, mouseType: .leftMouseUp,
              mouseCursorPosition: from, mouseButton: .left
          ) else {
        return .inputFailed
    }
    guard postInputUnlessCancelled({ down.postToPid(target.pid) }) else { return .cancelled }
    var last = from
    defer {
        // Release only the button already pressed, at its last position.
        release.location = last
        release.postToPid(target.pid)
    }
    func glide(_ destination: CGPoint, steps: Int) -> Bool {
        let start = last
        for step in 1...steps {
            guard !inputWasCancelled() else { return false }
            let progress = CGFloat(step) / CGFloat(steps)
            let point = CGPoint(
                x: start.x + (destination.x - start.x) * progress,
                y: start.y + (destination.y - start.y) * progress
            )
            guard postInputUnlessCancelled({
                drag.location = point
                drag.postToPid(target.pid)
                last = point
            }) else { return false }
            usleep(35_000)
        }
        return true
    }
    func hold(_ slices: Int) -> Bool {
        for _ in 0..<slices {
            guard postInputUnlessCancelled({
                drag.location = last
                drag.postToPid(target.pid)
            }) else { return false }
            usleep(100_000)
        }
        return true
    }
    func flip(towardsNext: Bool, times: Int) -> Bool {
        for _ in 0..<times {
            guard glide(towardsNext ? forwardEdge : backwardEdge, steps: 10),
                  hold(9),
                  glide(middle, steps: 8),
                  hold(6) else { return false }
        }
        return true
    }

    usleep(80_000)
    guard flip(towardsNext: forward, times: flips) else { return .cancelled }
    if let problem = verifyLanding() {
        if flip(towardsNext: !forward, times: flips) {
            _ = glide(from, steps: 12)
        }
        return .landingRejected(problem)
    }
    guard glide(to, steps: 12) else { return .cancelled }
    return inputWasCancelled() ? .cancelled : .dropped
}
