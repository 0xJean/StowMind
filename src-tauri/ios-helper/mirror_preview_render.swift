import AppKit
import CoreImage
import CoreMedia
import Foundation
import Metal
import QuartzCore
import ScreenCaptureKit

final class MirrorFrameRenderer: @unchecked Sendable {
    let metalLayer: CAMetalLayer

    private let context: CIContext
    private let commandQueue: MTLCommandQueue
    private let colorSpace = CGColorSpaceCreateDeviceRGB()
    private var currentDrawableSize = CGSize.zero

    init?() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let commandQueue = device.makeCommandQueue() else {
            return nil
        }
        let layer = CAMetalLayer()
        layer.device = device
        layer.pixelFormat = .bgra8Unorm
        layer.framebufferOnly = false
        layer.isOpaque = true
        layer.backgroundColor = NSColor.black.cgColor
        layer.allowsNextDrawableTimeout = true
        metalLayer = layer
        context = CIContext(mtlDevice: device)
        self.commandQueue = commandQueue
    }

    func resize(to size: CGSize, scale: CGFloat) {
        let drawableSize = CGSize(
            width: max(1, size.width * scale),
            height: max(1, size.height * scale)
        )
        guard drawableSize != currentDrawableSize
                || metalLayer.contentsScale != scale else {
            return
        }
        currentDrawableSize = drawableSize
        metalLayer.contentsScale = scale
        metalLayer.drawableSize = drawableSize
    }

    func render(_ sampleBuffer: CMSampleBuffer) {
        guard CMSampleBufferIsValid(sampleBuffer),
              CMSampleBufferDataIsReady(sampleBuffer),
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer),
              let drawable = metalLayer.nextDrawable(),
              let commandBuffer = commandQueue.makeCommandBuffer() else {
            return
        }

        let outputBounds = CGRect(
            x: 0,
            y: 0,
            width: drawable.texture.width,
            height: drawable.texture.height
        )
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard image.extent.width > 0, image.extent.height > 0 else {
            return
        }
        let scale = min(
            outputBounds.width / image.extent.width,
            outputBounds.height / image.extent.height
        )
        let scaled = image.transformed(
            by: CGAffineTransform(scaleX: scale, y: scale)
        )
        let translated = scaled.transformed(
            by: CGAffineTransform(
                translationX: (outputBounds.width - scaled.extent.width) / 2,
                y: (outputBounds.height - scaled.extent.height) / 2
            )
        )
        let background = CIImage(color: .black).cropped(to: outputBounds)
        context.render(
            translated.composited(over: background),
            to: drawable.texture,
            commandBuffer: commandBuffer,
            bounds: outputBounds,
            colorSpace: colorSpace
        )
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }
}

final class MirrorStreamOutput: NSObject, SCStreamOutput,
    @unchecked Sendable
{
    private let renderer: MirrorFrameRenderer

    init(renderer: MirrorFrameRenderer) {
        self.renderer = renderer
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen else {
            return
        }
        autoreleasepool {
            renderer.render(sampleBuffer)
        }
    }
}

private final class LockedResult<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, Error>?

    func finish(_ result: Result<Value, Error>) {
        lock.lock()
        self.result = result
        lock.unlock()
    }

    func snapshot() -> Result<Value, Error>? {
        lock.lock()
        defer { lock.unlock() }
        return result
    }
}

func waitForResult<Value>(
    timeout: TimeInterval,
    start: (@escaping (Result<Value, Error>) -> Void) -> Void
) -> Result<Value, Error> {
    let result = LockedResult<Value>()
    start { result.finish($0) }
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let current = result.snapshot() {
            return current
        }
        Thread.sleep(forTimeInterval: 0.01)
    }
    return .failure(
        NSError(
            domain: "com.stowmind.ios-helper",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "操作超时"]
        )
    )
}

func onMain<Value>(_ work: () -> Value) -> Value {
    if Thread.isMainThread {
        return work()
    }
    return DispatchQueue.main.sync(execute: work)
}
