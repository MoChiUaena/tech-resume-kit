import AppKit
import Foundation
import Darwin

final class OutputTail {
    private let lock = NSLock()
    private var data = Data()
    func append(_ value: Data) {
        lock.lock(); defer { lock.unlock() }
        data.append(value)
        if data.count > 8192 { data.removeFirst(data.count - 8192) }
    }
    var text: String {
        lock.lock(); defer { lock.unlock() }
        return String(decoding: data, as: UTF8.self)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var primary: Process?
    var signals: [DispatchSourceSignal] = []
    var tasks: [Process] = []
    var quitting = false
    let arguments = Array(CommandLine.arguments.dropFirst())

    func launch(primary isPrimary: Bool) {
        do {
            guard let resource = Bundle.main.resourceURL else { throw NSError(domain: "TechResumeKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "应用资源不存在，请完整解压启动包。"] ) }
            let node = resource.appendingPathComponent("runtime/bin/node")
            let input = resource.appendingPathComponent("toolkit/src/portable.mjs")
            guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: input.path) else {
                throw NSError(domain: "TechResumeKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "应用资源不完整，请重新下载并完整解压。"])
            }
            let task = Process(), output = Pipe(), errors = Pipe(), tail = OutputTail()
            task.executableURL = node
            task.arguments = [input.path] + arguments
            task.currentDirectoryURL = resource
            task.standardOutput = output; task.standardError = errors
            output.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil }
                else { FileHandle.standardOutput.write(data) }
            }
            errors.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil }
                else { tail.append(data); FileHandle.standardError.write(data) }
            }
            task.terminationHandler = { process in
                DispatchQueue.main.async {
                    output.fileHandleForReading.readabilityHandler = nil
                    errors.fileHandleForReading.readabilityHandler = nil
                    let remainingOutput = output.fileHandleForReading.readDataToEndOfFile()
                    if !remainingOutput.isEmpty { FileHandle.standardOutput.write(remainingOutput) }
                    let remainingErrors = errors.fileHandleForReading.readDataToEndOfFile()
                    if !remainingErrors.isEmpty { tail.append(remainingErrors); FileHandle.standardError.write(remainingErrors) }
                    self.tasks.removeAll { $0 === process }
                    if isPrimary {
                        self.tasks.filter { $0.isRunning }.forEach { $0.terminate() }
                        if process.terminationStatus != 0 { self.fail(tail.text.isEmpty ? "简历服务启动失败，请运行检查环境脚本。" : tail.text) }
                        else if self.quitting { NSApplication.shared.reply(toApplicationShouldTerminate: true) }
                        else { NSApplication.shared.terminate(nil) }
                    }
                }
            }
            try task.run()
            tasks.append(task)
            if isPrimary { primary = task }
        } catch { fail(error.localizedDescription) }
    }
    func fail(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
        if !arguments.contains("--check") && !arguments.contains("--no-open") {
            NSApplication.shared.activate(ignoringOtherApps: true)
            let alert = NSAlert(); alert.messageText = "简历未能打开"; alert.informativeText = message
            alert.addButton(withTitle: "关闭"); alert.runModal()
        }
        Darwin.exit(1)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { self.tasks.filter { $0.isRunning }.forEach { $0.terminate() } }
            source.resume(); signals.append(source)
        }
        launch(primary: true)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !quitting && primary?.isRunning == true && !tasks.contains(where: { $0 !== primary && $0.isRunning }) { launch(primary: false) }
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if let task = primary, task.isRunning {
            quitting = true
            task.terminate()
            return .terminateLater
        }
        return .terminateNow
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.setActivationPolicy(.accessory)
application.delegate = delegate
application.run()
