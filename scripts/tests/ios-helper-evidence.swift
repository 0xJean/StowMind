import Foundation
import Darwin

@main
struct EvidenceRegressionTests {
    static func main() {
        var checks = 0
        func expect(_ result: @autoclosure () -> Bool, _ message: String) {
            checks += 1
            precondition(result(), message)
        }
        func app(_ id: String, _ row: Int, _ column: Int, _ confidence: Double = 0.98)
            -> AppLabelEvidence {
            AppLabelEvidence(id: id, name: id, confidence: confidence, row: row, column: column)
        }

        let repeatedOCR = preservingAmbiguousLabels([app("a", 0, 0), app("a", 0, 0, 0.94)])
        expect(repeatedOCR.count == 1, "Repeated OCR in one slot must be deduplicated")
        expect(repeatedOCR[0].confidence == 0.94, "Deduplication must not inflate confidence")
        let collision = preservingAmbiguousLabels([app("a", 0, 0), app("b", 0, 0)])
        expect(collision.count == 2, "Different identities in one slot must survive")
        expect(collision.allSatisfy { $0.confidence == 0 }, "Slot ambiguity must disable automation")
        let duplicate = preservingAmbiguousLabels([app("a", 0, 0), app("a", 1, 0)])
        expect(duplicate.count == 2, "Same identity in different slots must survive")
        expect(duplicate.allSatisfy { $0.confidence == 0 }, "Duplicate labels must disable automation")
        expect(hasUniqueAppEvidence(
            labels: [app("a", 0, 0)], screenIds: ["a"], appId: "a", row: 0, column: 0
        ), "A unique high-confidence source is eligible")
        expect(!hasUniqueAppEvidence(
            labels: [app("a", 0, 0)], screenIds: ["a", "a"], appId: "a", row: 0, column: 0
        ), "Duplicate names outside the source slot must stop an action")
        expect(!hasUniqueAppEvidence(
            labels: [app("a", 0, 0), app("b", 0, 0)], screenIds: ["a", "b"],
            appId: "a", row: 0, column: 0
        ), "Conflicting labels at the source/target slot must stop an action")
        expect(!hasUniqueAppEvidence(
            labels: [app("a", 0, 0, 0.89)], screenIds: ["a"], appId: "a", row: 0, column: 0
        ), "Low-confidence post-action recognition is not verification")
        expect(!hasUniqueAppEvidence(
            labels: [app("a", 0, 1)], screenIds: ["a"], appId: "a", row: 0, column: 0
        ), "An app in a different slot is not verification")

        func listLabel(_ text: String, _ x: Double, _ y: Double) -> LibraryListLabel {
            LibraryListLabel(text: text, confidence: 0.98, x: x, y: y, width: 0.25, height: 0.03)
        }
        let header = [listLabel("Search", 0.10, 0.10), listLabel("Cancel", 0.75, 0.10)]
        let rows = [listLabel("Calendar", 0.23, 0.30), listLabel("Notes", 0.24, 0.40)]
        expect(reliableLibraryRows(header + rows)?.count == 2, "A reliable list must expose rows")
        expect(reliableLibraryRows([]) == nil, "An empty screen is not a library list")
        expect(reliableLibraryRows(header) == nil, "An empty search view is not a complete inventory")
        expect(reliableLibraryRows(rows) == nil, "A Home Screen is not a library search list")
        expect(reliableLibraryRows([header[0]] + rows) == nil, "A missing Cancel control cannot prove search mode")
        expect(reliableLibraryRows(header + [rows[0], listLabel("Notes", 0.70, 0.40)]) == nil,
               "Grid categories are not list rows")
        let uncertain = LibraryListLabel(
            text: "Missing app", confidence: 0.70, x: 0.23, y: 0.50, width: 0.25, height: 0.03
        )
        expect(reliableLibraryRows(header + rows + [uncertain]) == nil,
               "Low-confidence list entries cannot be silently omitted from a complete inventory")
        expect(reliableLibraryRows(header + [rows[0], listLabel("X", 0.24, 0.40)])?.count == 2,
               "Single-character app names must not be omitted")
        expect(reliableLibraryRows(header + rows + [listLabel("A", 0.05, 0.23)])?.count == 2,
               "Alphabet section headers must not be counted as apps")
        expect(reliableLibraryRows(header + rows + [
            listLabel("123", 0.02, 0.90), listLabel("Keyboard key", 0.23, 0.70)
        ])?.count == 2, "An open keyboard must not become app inventory")

        var stuck = LibraryScanProgress()
        for _ in 0..<6 {
            expect(!stuck.observe("a|b", hasReliableRows: true),
                   "Repeated frames without any successful scroll cannot establish completeness")
        }
        var scrolling = LibraryScanProgress()
        expect(!scrolling.observe("a|b", hasReliableRows: true), "Initial list frame cannot be complete")
        expect(!scrolling.observe("b|c", hasReliableRows: true), "List progress is not an end marker")
        expect(!scrolling.observe("b|c", hasReliableRows: true), "One unchanged frame is insufficient")
        expect(scrolling.observe("b|c", hasReliableRows: true), "Confirmed progress and stable end are required")
        expect(!scrolling.observe("", hasReliableRows: false), "Invalid view must reset completion evidence")
        expect(!scrolling.observe("b|c", hasReliableRows: true), "Prior scrolling cannot survive an invalid view")
        expect(!scrolling.observe("b|c", hasReliableRows: true), "A restored but stuck view remains incomplete")

        let cancellation = InputCancellationState()
        var events = 0
        expect(cancellation.performIfActive { events += 1 }, "Input is allowed before cancellation")
        cancellation.cancel()
        cancellation.cancel()
        expect(cancellation.isCancelled, "Cancellation remains latched")
        expect(!cancellation.performIfActive { events += 1 }, "No new event is allowed after cancellation")
        expect(events == 1, "Rejected input closures must never run")
        let signalled = InputCancellationState()
        signalled.installSignalListener()
        expect(kill(getpid(), SIGUSR1) == 0, "The regression process must receive its own stop signal")
        let signalDeadline = Date().addingTimeInterval(1)
        while !signalled.isCancelled && Date() < signalDeadline {
            Thread.sleep(forTimeInterval: 0.005)
        }
        expect(signalled.isCancelled, "SIGUSR1 must latch cancellation through DispatchSource")
        expect(!signalled.performIfActive { events += 1 }, "Signalled cancellation must gate later input")

        expect(pageFlipPlan(fromPage: 0, toPage: 0) == nil, "Same-page moves never flip pages")
        expect(pageFlipPlan(fromPage: 0, toPage: 4) == nil, "More than three flips stay manual")
        expect(pageFlipPlan(fromPage: 2, toPage: 0).map { $0.count == 2 && !$0.forward } == true,
               "Backward moves flip towards the previous page")
        expect(pageFlipPlan(fromPage: 0, toPage: 3).map { $0.count == 3 && $0.forward } == true,
               "Forward moves flip once per page")
        expect(targetPageEvidenceMatches(expectedIds: ["a", "b"], screenIds: ["b", "x", "a"]),
               "All expected landing-page Apps prove the page")
        expect(!targetPageEvidenceMatches(expectedIds: ["a", "b"], screenIds: ["a"]),
               "A missing landing-page App means the flip count is wrong")
        expect(!targetPageEvidenceMatches(expectedIds: ["a"], screenIds: ["a", "a"]),
               "Duplicate labels cannot prove the landing page")
        expect(!targetPageEvidenceMatches(expectedIds: [], screenIds: ["a"]),
               "An empty expectation cannot prove the landing page")
        print("Passed \(checks) iOS helper evidence regression checks (no device access)")
    }
}
