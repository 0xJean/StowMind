import CoreGraphics
import Foundation
import Vision

struct MirrorGeometry {
    let contentRect: CGRect
    let confidence: Float
}

private let iphoneScreenAspectRatio: CGFloat = 9.0 / 19.5

private func pixelRect(_ box: CGRect, image: CGImage) -> CGRect {
    CGRect(
        x: box.minX * CGFloat(image.width),
        y: (1.0 - box.maxY) * CGFloat(image.height),
        width: box.width * CGFloat(image.width),
        height: box.height * CGFloat(image.height)
    )
}

private func rectangleGeometry(_ image: CGImage) -> MirrorGeometry? {
    let request = VNDetectRectanglesRequest()
    request.maximumObservations = 12
    request.minimumAspectRatio = 0.38
    request.maximumAspectRatio = 0.58
    request.minimumSize = 0.35
    request.minimumConfidence = 0.65
    request.quadratureTolerance = 30

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        diagnostic("Mirror content rectangle detection failed: \(error.localizedDescription)")
        return nil
    }

    let imageArea = CGFloat(image.width * image.height)
    let imageCenter = CGPoint(
        x: CGFloat(image.width) / 2.0,
        y: CGFloat(image.height) / 2.0
    )
    let candidates = (request.results ?? []).compactMap { observation -> (MirrorGeometry, CGFloat)? in
        let rect = pixelRect(observation.boundingBox, image: image).integral
        let areaRatio = rect.width * rect.height / max(imageArea, 1)
        guard areaRatio >= 0.34, areaRatio <= 0.78 else {
            return nil
        }

        let aspectRatio = rect.width / max(rect.height, 1)
        let aspectScore = max(
            0,
            1.0 - abs(aspectRatio - iphoneScreenAspectRatio) / 0.12
        )
        let areaScore = max(0, 1.0 - abs(areaRatio - 0.60) / 0.28)
        let centerDistance = hypot(
            rect.midX - imageCenter.x,
            rect.midY - imageCenter.y
        )
        let centerScore = max(
            0,
            1.0 - centerDistance / max(CGFloat(image.width), CGFloat(image.height))
        )
        let quality = aspectScore * 0.55 + areaScore * 0.25 + centerScore * 0.20
        guard quality >= 0.70 else {
            return nil
        }
        let confidence = min(observation.confidence, Float(quality))
        return (MirrorGeometry(contentRect: rect, confidence: confidence), quality)
    }

    return candidates.max(by: { $0.1 < $1.1 })?.0
}

private func clusteredCenters(
    _ values: [CGFloat],
    initial: [CGFloat]
) -> [CGFloat]? {
    guard values.count >= initial.count * 2 else {
        return nil
    }
    var centers = initial
    for _ in 0..<8 {
        var groups = Array(repeating: [CGFloat](), count: centers.count)
        for value in values {
            let index = centers.indices.min {
                abs(centers[$0] - value) < abs(centers[$1] - value)
            } ?? 0
            groups[index].append(value)
        }
        guard groups.allSatisfy({ !$0.isEmpty }) else {
            return nil
        }
        centers = groups.map { group in
            group.reduce(0, +) / CGFloat(group.count)
        }
    }
    return centers.sorted()
}

private func textGeometry(_ image: CGImage, hits: [TextHit]) -> MirrorGeometry? {
    let candidates = hits.filter {
        $0.confidence >= 0.80
            && $0.box.width >= 0.025
            && $0.box.width <= 0.24
            && $0.box.midY >= 0.14
            && $0.box.midY <= 0.86
    }
    guard let centers = clusteredCenters(
        candidates.map(\.box.midX),
        initial: [0.20, 0.40, 0.60, 0.80]
    ) else {
        return nil
    }

    let spacings = zip(centers, centers.dropFirst()).map { $1 - $0 }.sorted()
    guard let spacing = spacings.dropFirst(spacings.count / 2).first,
          spacing >= 0.10,
          spacing <= 0.28 else {
        return nil
    }
    let gridWidth = spacing * 4.0 * CGFloat(image.width)
    let width = gridWidth * 1.08
    let height = width / iphoneScreenAspectRatio
    guard height <= CGFloat(image.height) * 0.92 else {
        return nil
    }

    let maxY = CGFloat(image.height) - height
    let originY = min(
        max(CGFloat(image.height) * 0.485 - height / 2.0, 0),
        maxY
    )
    let maxX = CGFloat(image.width) - width
    let gridOriginX = (centers[0] - spacing * 0.5) * CGFloat(image.width)
    let originX = min(
        max(gridOriginX - (width - gridWidth) / 2.0, 0),
        maxX
    )
    return MirrorGeometry(
        contentRect: CGRect(x: originX, y: originY, width: width, height: height).integral,
        confidence: 0.82
    )
}

func detectMirrorGeometry(
    _ image: CGImage,
    hits: [TextHit]? = nil
) -> MirrorGeometry? {
    rectangleGeometry(image)
        ?? hits.flatMap { textGeometry(image, hits: $0) }
}

func croppedMirrorImage(_ image: CGImage, geometry: MirrorGeometry) -> CGImage? {
    let imageRect = CGRect(
        x: 0,
        y: 0,
        width: image.width,
        height: image.height
    )
    let cropRect = geometry.contentRect
        .insetBy(
            dx: geometry.contentRect.width * 0.004,
            dy: geometry.contentRect.height * 0.004
        )
        .intersection(imageRect)
        .integral
    guard cropRect.width > 0, cropRect.height > 0 else {
        return nil
    }
    return image.cropping(to: cropRect)
}

func homeGridRect(_ geometry: MirrorGeometry) -> CGRect {
    CGRect(
        x: geometry.contentRect.minX,
        y: geometry.contentRect.minY + geometry.contentRect.height * 0.08,
        width: geometry.contentRect.width,
        height: geometry.contentRect.height * 0.70
    )
}

func gridPosition(
    _ hit: TextHit,
    image: CGImage,
    geometry: MirrorGeometry
) -> (row: Int, column: Int)? {
    let center = CGPoint(
        x: hit.box.midX * CGFloat(image.width),
        y: (1.0 - hit.box.midY) * CGFloat(image.height)
    )
    let grid = homeGridRect(geometry)
    guard grid.contains(center) else {
        return nil
    }
    let column = min(
        3,
        max(0, Int((center.x - grid.minX) / max(grid.width / 4.0, 1.0)))
    )
    let row = min(
        5,
        max(0, Int((center.y - grid.minY) / max(grid.height / 6.0, 1.0)))
    )
    return (row, column)
}

func globalContentBounds(
    target: WindowTarget,
    image: CGImage,
    geometry: MirrorGeometry
) -> CGRect {
    let scaleX = target.bounds.width / max(CGFloat(image.width), 1)
    let scaleY = target.bounds.height / max(CGFloat(image.height), 1)
    return CGRect(
        x: target.bounds.minX + geometry.contentRect.minX * scaleX,
        y: target.bounds.minY + geometry.contentRect.minY * scaleY,
        width: geometry.contentRect.width * scaleX,
        height: geometry.contentRect.height * scaleY
    )
}

func globalPoint(
    target: WindowTarget,
    image: CGImage,
    imagePoint: CGPoint
) -> CGPoint {
    CGPoint(
        x: target.bounds.minX
            + imagePoint.x * target.bounds.width / max(CGFloat(image.width), 1),
        y: target.bounds.minY
            + imagePoint.y * target.bounds.height / max(CGFloat(image.height), 1)
    )
}
