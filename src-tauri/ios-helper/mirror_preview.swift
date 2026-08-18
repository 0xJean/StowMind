import AppKit
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

private struct MirrorPreviewConfiguration {
    let hostPid: pid_t
    let hostWindowId: CGWindowID
    let hostFocused: Bool
    let offsetX: CGFloat
    let offsetY: CGFloat
    let width: CGFloat
    let height: CGFloat
}

final class MirrorPreviewController: NSObject, SCStreamDelegate,
    @unchecked Sendable
{
    static let shared = MirrorPreviewController()

    private let lock = NSLock()
    private let captureQueue = DispatchQueue(
        label: "com.stowmind.ios-helper.mirror-preview",
        qos: .userInteractive
    )
    private var configuration: MirrorPreviewConfiguration?
    private var workerStarted = false
    private var panel: NSPanel?
    private var renderer: MirrorFrameRenderer?
    private var stream: SCStream?
    private var streamOutput: MirrorStreamOutput?
    private var streamWindowId: CGWindowID?
    private var streamError: String?

    private override init() {}

    func update(
        hostPid: pid_t,
        hostWindowId: CGWindowID,
        hostFocused: Bool,
        offsetX: CGFloat,
        offsetY: CGFloat,
        width: CGFloat,
        height: CGFloat
    ) -> String? {
        guard CGPreflightScreenCaptureAccess() else {
            return "实时预览需要屏幕录制权限"
        }
        guard let target = findMirroringWindow() else {
            return "找不到 iPhone 镜像窗口，请先打开 Apple iPhone 镜像"
        }
        let next = MirrorPreviewConfiguration(
            hostPid: hostPid,
            hostWindowId: hostWindowId,
            hostFocused: hostFocused,
            offsetX: offsetX,
            offsetY: offsetY,
            width: width,
            height: height
        )

        lock.lock()
        configuration = next
        let shouldStartWorker = !workerStarted
        workerStarted = true
        let needsStream = stream == nil
            || streamWindowId != target.id
            || streamError != nil
        lock.unlock()

        guard preparePanel(next, reveal: !needsStream) else {
            return "无法创建原生 iPhone 预览面板"
        }
        if needsStream, let error = restartStream(target: target) {
            return error
        }
        if shouldStartWorker {
            Thread.detachNewThread { [weak self] in
                self?.followHostWindow()
            }
        }
        return nil
    }

    func stop() {
        lock.lock()
        configuration = nil
        lock.unlock()
        stopStream()
        onMain {
            panel?.orderOut(nil)
            panel = nil
            renderer = nil
            NSApp.setActivationPolicy(.prohibited)
        }
    }

    func stream(
        _ stream: SCStream,
        didStopWithError error: Error
    ) {
        lock.lock()
        if self.stream === stream {
            streamError = error.localizedDescription
        }
        lock.unlock()
        diagnostic("Mirror preview stream stopped: \(error.localizedDescription)")
    }

    private func preparePanel(
        _ configuration: MirrorPreviewConfiguration,
        reveal: Bool
    ) -> Bool {
        onMain {
            if panel == nil {
                guard let renderer = MirrorFrameRenderer() else {
                    return false
                }
                let previewPanel = NSPanel(
                    contentRect: .zero,
                    styleMask: [.borderless, .nonactivatingPanel],
                    backing: .buffered,
                    defer: false
                )
                let contentView = NSView(frame: .zero)
                contentView.wantsLayer = true
                contentView.layer = renderer.metalLayer
                contentView.layer?.cornerRadius = 42
                contentView.layer?.masksToBounds = true
                previewPanel.contentView = contentView
                previewPanel.level = NSWindow.Level(
                    rawValue: NSWindow.Level.floating.rawValue + 1
                )
                previewPanel.isOpaque = false
                previewPanel.backgroundColor = .clear
                previewPanel.hasShadow = false
                previewPanel.ignoresMouseEvents = true
                previewPanel.hidesOnDeactivate = false
                previewPanel.isReleasedWhenClosed = false
                previewPanel.collectionBehavior = [
                    .canJoinAllSpaces,
                    .fullScreenAuxiliary,
                    .ignoresCycle,
                    .transient
                ]
                self.renderer = renderer
                panel = previewPanel
            }
            return applyPanelGeometry(configuration, reveal: reveal)
        }
    }

    private func restartStream(target: WindowTarget) -> String? {
        stopStream()
        let contentResult: Result<SCShareableContent, Error> = waitForResult(
            timeout: 12
        ) { finish in
            SCShareableContent.getExcludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            ) { content, error in
                if let error {
                    finish(.failure(error))
                } else if let content {
                    finish(.success(content))
                }
            }
        }
        guard case let .success(content) = contentResult,
              let window = content.windows.first(where: {
                  $0.windowID == target.id
              }) else {
            return "ScreenCaptureKit 无法读取当前 iPhone 镜像窗口"
        }

        let configuration = SCStreamConfiguration()
        configuration.width = max(1, Int(window.frame.width * 2))
        configuration.height = max(1, Int(window.frame.height * 2))
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        configuration.queueDepth = 5
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = false
        configuration.scalesToFit = true

        guard let renderer else {
            return "原生预览渲染器不可用"
        }
        let output = MirrorStreamOutput(renderer: renderer)
        let nextStream = SCStream(
            filter: SCContentFilter(desktopIndependentWindow: window),
            configuration: configuration,
            delegate: self
        )
        do {
            try nextStream.addStreamOutput(
                output,
                type: SCStreamOutputType.screen,
                sampleHandlerQueue: captureQueue
            )
        } catch {
            return "无法连接 iPhone 镜像视频流：\(error.localizedDescription)"
        }
        let startResult: Result<Void, Error> = waitForResult(
            timeout: 12
        ) { finish in
            nextStream.startCapture { error in
                if let error {
                    finish(.failure(error))
                } else {
                    finish(.success(()))
                }
            }
        }
        if case let .failure(error) = startResult {
            return "无法启动 iPhone 实时预览：\(error.localizedDescription)"
        }

        lock.lock()
        stream = nextStream
        streamOutput = output
        streamWindowId = target.id
        streamError = nil
        lock.unlock()
        return nil
    }

    private func stopStream() {
        lock.lock()
        let current = stream
        stream = nil
        streamOutput = nil
        streamWindowId = nil
        streamError = nil
        lock.unlock()
        guard let current else {
            return
        }
        let _: Result<Void, Error> = waitForResult(timeout: 4) { finish in
            current.stopCapture { error in
                if let error {
                    finish(.failure(error))
                } else {
                    finish(.success(()))
                }
            }
        }
    }

    private func followHostWindow() {
        while true {
            autoreleasepool {
                lock.lock()
                let current = configuration
                let reveal = stream != nil && streamError == nil
                lock.unlock()
                if let current {
                    onMain {
                        _ = applyPanelGeometry(current, reveal: reveal)
                    }
                }
            }
            Thread.sleep(forTimeInterval: 1.0 / 30.0)
        }
    }

    private func applyPanelGeometry(
        _ configuration: MirrorPreviewConfiguration,
        reveal: Bool
    ) -> Bool {
        guard let panel,
              let renderer,
              let hostBounds = previewHostWindowBounds(
                  id: configuration.hostWindowId,
                  ownerPid: configuration.hostPid
              ) else {
            panel?.orderOut(nil)
            return false
        }

        let desired = CGRect(
            x: hostBounds.minX + configuration.offsetX,
            y: hostBounds.minY + configuration.offsetY,
            width: configuration.width,
            height: configuration.height
        )
        guard let converted = appKitRect(fromGlobalCGRect: desired) else {
            panel.orderOut(nil)
            return false
        }
        if !panel.frame.approximatelyEquals(converted) {
            panel.setFrame(converted, display: true)
        }
        let scale = panel.screen?.backingScaleFactor ?? 2
        renderer.resize(to: converted.size, scale: scale)
        if reveal && configuration.hostFocused && !panel.isVisible {
            panel.orderFrontRegardless()
        } else if (!reveal || !configuration.hostFocused) && panel.isVisible {
            panel.orderOut(nil)
        }
        return true
    }
}

func handleMirrorPreviewOperation(
    _ operation: String,
    request: [String: Any]
) -> Bool {
    if operation == "stopMirrorPreview" {
        MirrorPreviewController.shared.stop()
        success(["active": false])
        return true
    }
    if operation == "showMirrorInteraction" {
        MirrorPreviewController.shared.stop()
        guard let target = findMirroringWindow(),
              let application = NSRunningApplication(
                  processIdentifier: target.pid
              ),
              let companion = suggestedCompanionBounds(for: target.bounds) else {
            failure("找不到可交互的 iPhone 镜像窗口")
            return true
        }
        onMain {
            _ = application.activate(options: [])
        }
        success([
            "mirrorBounds": dictionary(for: target.bounds),
            "companionBounds": dictionary(for: companion)
        ])
        return true
    }
    guard operation == "setMirrorPreview" else {
        return false
    }
    guard let payload = request["payload"] as? [String: Any],
          let hostPid = payload["hostPid"] as? Int,
          let hostWindowId = payload["hostWindowId"] as? Int,
          let hostFocused = payload["hostFocused"] as? Bool,
          let offsetX = payload["offsetX"] as? Double,
          let offsetY = payload["offsetY"] as? Double,
          let width = payload["width"] as? Double,
          let height = payload["height"] as? Double else {
        failure("实时预览请求缺少窗口参数")
        return true
    }
    if let error = MirrorPreviewController.shared.update(
        hostPid: pid_t(hostPid),
        hostWindowId: CGWindowID(hostWindowId),
        hostFocused: hostFocused,
        offsetX: CGFloat(offsetX),
        offsetY: CGFloat(offsetY),
        width: CGFloat(width),
        height: CGFloat(height)
    ) {
        failure(error)
    } else {
        success(["active": true])
    }
    return true
}
