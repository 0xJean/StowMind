import Darwin
import Dispatch
import Foundation

final class InputCancellationState: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var signalSource: DispatchSourceSignal?

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }

    // Serialize cancellation with each individual input event. The caller may
    // release an already-pressed button outside this gate, but cannot start or
    // continue a gesture after cancellation has been recorded.
    func performIfActive(_ operation: () -> Void) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !cancelled else { return false }
        operation()
        return true
    }

    func installSignalListener() {
        guard signalSource == nil else { return }
        signal(SIGUSR1, SIG_IGN)
        let source = DispatchSource.makeSignalSource(
            signal: SIGUSR1,
            queue: DispatchQueue(label: "com.stowmind.ios-helper.cancel", qos: .userInteractive)
        )
        // This executes on a normal dispatch queue, never in a POSIX signal
        // handler; using NSLock and Swift here is safe.
        source.setEventHandler { [weak self] in self?.cancel() }
        signalSource = source
        source.resume()
    }
}

let inputCancellation = InputCancellationState()

func inputWasCancelled() -> Bool { inputCancellation.isCancelled }

@discardableResult
func postInputUnlessCancelled(_ operation: () -> Void) -> Bool {
    inputCancellation.performIfActive(operation)
}
