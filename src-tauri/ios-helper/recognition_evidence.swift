import Foundation

struct AppLabelEvidence {
    let id: String
    let name: String
    var confidence: Double
    let row: Int
    let column: Int

    var slot: String { "\(row):\(column)" }
}

// Only repeat observations of the same identity in the same slot are duplicates.
// Conflicting labels and identities must survive for Rust to reject ambiguity.
func preservingAmbiguousLabels(_ labels: [AppLabelEvidence]) -> [AppLabelEvidence] {
    var result = [AppLabelEvidence]()
    var indices = [String: Int]()
    for label in labels {
        let key = "\(label.id)|\(label.slot)"
        if let index = indices[key] {
            result[index].confidence = min(result[index].confidence, label.confidence)
        } else {
            indices[key] = result.count
            result.append(label)
        }
    }
    let ids = Dictionary(grouping: result, by: \.id)
    let slots = Dictionary(grouping: result, by: \.slot)
    for index in result.indices {
        if ids[result[index].id, default: []].count > 1
            || slots[result[index].slot, default: []].count > 1 {
            result[index].confidence = 0
        }
    }
    return result
}

func hasUniqueAppEvidence(
    labels: [AppLabelEvidence],
    screenIds: [String],
    appId: String,
    row: Int,
    column: Int
) -> Bool {
    guard screenIds.filter({ $0 == appId }).count == 1 else { return false }
    let slotLabels = labels.filter { $0.row == row && $0.column == column }
    return slotLabels.count == 1
        && slotLabels[0].id == appId
        && slotLabels[0].confidence >= 0.90
}

struct LibraryListLabel {
    let text: String
    let confidence: Float
    // Coordinates are normalized to the detected iPhone content, top to bottom.
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

func controlLabel(_ value: String) -> String {
    value.lowercased().replacingOccurrences(
        of: #"[^\p{L}\p{N}]"#, with: "", options: .regularExpression
    )
}

func reliableLibraryRows(_ labels: [LibraryListLabel]) -> [LibraryListLabel]? {
    let headings = Set(["search", "搜索", "applibrary", "资源库", "应用资源库", "app资源库"])
    let controls = headings.union(["cancel", "取消", "today", "今天"])
    let header = labels.filter { $0.y >= 0 && $0.y < 0.20 && $0.confidence >= 0.90 }
    guard header.contains(where: { headings.contains(controlLabel($0.text)) }),
          header.contains(where: { ["cancel", "取消"].contains(controlLabel($0.text)) }) else {
        return nil
    }
    let keyboardControls = Set(["space", "空格", "123", "return", "换行", "搜索"])
    let hasKeyboard = labels.contains {
        $0.y > 0.55 && keyboardControls.contains(controlLabel($0.text))
    }
    let rows = labels.filter {
        $0.text.count >= 1 && $0.text.count <= 36
            && !controls.contains(controlLabel($0.text))
            && $0.x >= 0.18 && $0.x <= 0.40
            && $0.y >= 0.20 && $0.y <= (hasKeyboard ? 0.52 : 0.88)
            && $0.width > 0 && $0.width <= 0.74
            && $0.height > 0 && $0.height <= 0.055
    }.sorted { $0.y < $1.y }
    guard rows.count >= 2, let first = rows.first,
          rows.allSatisfy({ $0.confidence >= 0.90 }),
          rows.allSatisfy({ abs($0.x - first.x) <= 0.07 }),
          zip(rows, rows.dropFirst()).allSatisfy({ $1.y - $0.y >= 0.035 }) else {
        return nil
    }
    return rows
}

struct LibraryScanProgress {
    private var previous: String?
    private var hasScrolled = false
    private var unchanged = 0

    mutating func observe(_ fingerprint: String, hasReliableRows: Bool) -> Bool {
        guard hasReliableRows, !fingerprint.isEmpty else {
            previous = nil
            hasScrolled = false
            unchanged = 0
            return false
        }
        if let previous {
            if previous == fingerprint {
                unchanged += 1
            } else {
                hasScrolled = true
                unchanged = 0
            }
        }
        previous = fingerprint
        // A stuck view or a missed search-field click cannot establish completion.
        return hasScrolled && unchanged >= 2
    }
}
