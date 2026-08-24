// Agent Shell — native macOS app.
//
// A WKWebView window over the local agent-shell server (http://localhost:4321).
// The app ensures the stable gateway is running (normally through launchd,
// with a login-shell fallback), then loads the UI. Quitting the app leaves the
// gateway and tmux sessions running; sessions survive the window by design.
//
// Why native instead of a Safari web app or Chrome app window: the browser
// owned chords like cmd+w and needed Shortcuts/AppleScript glue to focus the
// window. Here the app owns the window, the dock icon, cmd-tab, and the menu
// bar, and deliberately leaves cmd+w / cmd+d / cmd+b unbound so the page
// browser interface receives them.
//
// Build and install: bash native/build-app.sh (or npm run app).

import Cocoa
import WebKit

let serverPort = 4321
let serverURL = URL(string: "http://localhost:\(serverPort)/")!
let serverHealthURL = URL(string: "http://localhost:\(serverPort)/api/health")!
let serverDir = ("~/Projects/otto-tangent/packages/agent-shell/app" as NSString).expandingTildeInPath
let agentShellDir = (serverDir as NSString).deletingLastPathComponent
let packagesDir = (agentShellDir as NSString).deletingLastPathComponent
let repoDir = (packagesDir as NSString).deletingLastPathComponent
let reviewedRuntime = (repoDir as NSString).appendingPathComponent("packages/agent-shell/dist/index.js")
let serverLog = ("~/.tangent/agent-shell.log" as NSString).expandingTildeInPath

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var webView: WKWebView!
  var serverProcess: Process?
  var serverStartedAt: Date?
  var serverRestartAttempt = 0
  var serverRestartWork: DispatchWorkItem?
  var serverLaunchInFlight = false
  var launchctlProcess: Process?

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()

    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = []
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    config.userContentController.add(self, name: "dockBadge")
    config.userContentController.addUserScript(WKUserScript(
      source: """
        window.__agentShellNativeDockBadge = true;
        Object.defineProperty(navigator, "setAppBadge", { configurable: true, value: async (count = 0) => {
          window.webkit.messageHandlers.dockBadge.postMessage(Number(count));
        }});
        Object.defineProperty(navigator, "clearAppBadge", { configurable: true, value: async () => {
          window.webkit.messageHandlers.dockBadge.postMessage(0);
        }});
        """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true))

    webView = WKWebView(frame: .zero, configuration: config)
    webView.uiDelegate = self
    webView.navigationDelegate = self

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "Agent Shell"
    window.setFrameAutosaveName("AgentShellMain")
    window.contentView = webView
    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    ensureServerAndLoad()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  // MARK: server lifecycle

  func ensureServerAndLoad() {
    probeServer { up in
      if up {
        self.webView.load(URLRequest(url: serverURL))
      } else {
        self.startServer()
        self.pollUntilUp(deadline: Date().addingTimeInterval(60))
      }
    }
  }

  func probeServer(_ done: @escaping (Bool) -> Void) {
    var req = URLRequest(url: serverHealthURL)
    req.timeoutInterval = 1
    URLSession.shared.dataTask(with: req) { data, response, _ in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let payload = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      let service = payload?["service"] as? String ?? ""
      let up = status == 200 && service == "tangent-agent-shell-gateway"
      DispatchQueue.main.async { done(up) }
    }.resume()
  }

  // Prefer the installed LaunchAgent: launchd owns gateway availability and
  // throttles crashes while the app is closed. A source-checkout fallback
  // keeps development usable before that job is installed.
  func startServer() {
    if serverProcess?.isRunning == true || serverLaunchInFlight { return }
    serverLaunchInFlight = true
    let managed = Process()
    managed.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    managed.arguments = ["kickstart", "-k", "gui/\(getuid())/com.tangent.agent-shell"]
    managed.terminationHandler = { [weak self] process in
      DispatchQueue.main.async {
        guard let self = self, self.launchctlProcess === process else { return }
        self.launchctlProcess = nil
        self.serverLaunchInFlight = false
        if process.terminationStatus != 0 { self.startFallbackServer() }
      }
    }
    do {
      try managed.run()
      launchctlProcess = managed
    } catch {
      launchctlProcess = nil
      serverLaunchInFlight = false
      startFallbackServer()
    }
  }

  // AGENT_SHELL_NO_OPEN stops the fallback gateway from opening this app.
  // The login shell picks up nvm's node when no LaunchAgent is installed.
  func startFallbackServer() {
    if serverProcess?.isRunning == true { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc",
      "if [ ! -f '\(reviewedRuntime)' ]; then cd '\(repoDir)' && npm run build -w @tangent/agent-runtime && npm run build -w @tangent/repo && npm run build -w @tangent/agent-shell; fi; cd '\(serverDir)' && AGENT_SHELL_NO_OPEN=1 exec node gateway.mjs >> '\(serverLog)' 2>&1"]
    p.terminationHandler = { [weak self] process in
      DispatchQueue.main.async {
        guard let self = self, self.serverProcess === process else { return }
        self.serverProcess = nil
        let lifetime = self.serverStartedAt.map { Date().timeIntervalSince($0) } ?? 0
        self.serverStartedAt = nil
        self.serverRestartAttempt = lifetime >= 30 ? 0 : self.serverRestartAttempt + 1
        self.scheduleServerRecovery()
      }
    }
    do {
      try p.run()
      serverProcess = p
      serverStartedAt = Date()
    } catch {
      serverProcess = nil
      serverStartedAt = nil
      serverRestartAttempt += 1
      scheduleServerRecovery()
    }
  }

  // Re-probes before every restart. Exponential delay prevents an occupied
  // port or bad build from becoming a process-creation storm.
  func scheduleServerRecovery() {
    if serverRestartWork != nil { return }
    let exponent = min(serverRestartAttempt, 7)
    let delay = min(30.0, 0.25 * pow(2.0, Double(exponent)))
    let work = DispatchWorkItem { [weak self] in
      guard let self = self else { return }
      self.serverRestartWork = nil
      self.probeServer { up in
        if up {
          self.serverRestartAttempt = 0
        } else {
          self.startServer()
        }
      }
    }
    serverRestartWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  func pollUntilUp(deadline: Date) {
    probeServer { up in
      if up {
        self.webView.load(URLRequest(url: serverURL))
      } else if Date() < deadline {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
          self.pollUntilUp(deadline: deadline)
        }
      } else {
        self.webView.loadHTMLString(
          "<body style='background:#111;color:#ddd;font:14px -apple-system'>" +
          "<h2>agent-shell server did not start</h2>" +
          "<p>See <code>~/.tangent/agent-shell.log</code>, then press cmd+shift+R.</p></body>",
          baseURL: nil)
      }
    }
  }

  // Server gone (restarted, crashed): retry, which also restarts it if needed.
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
               withError error: Error) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.ensureServerAndLoad() }
  }

  // MARK: page integration

  // WKWebView does not expose the web Badging API. The document-start shim above
  // keeps browser code portable while this handler owns the actual macOS Dock tile.
  func userContentController(_ userContentController: WKUserContentController,
                             didReceive message: WKScriptMessage) {
    guard message.name == "dockBadge" else { return }
    let count = max(0, (message.body as? NSNumber)?.intValue ?? 0)
    DispatchQueue.main.async {
      NSApp.dockTile.badgeLabel = count > 0 ? String(count) : nil
    }
  }

  // Voice control records the mic; grant without a per-visit prompt. The
  // system-level microphone consent (TCC) still gates actual access.
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(.grant)
  }

  // WKWebView has no built-in JS dialogs: without these delegate methods
  // alert() is silently dropped and confirm() returns false, which made the
  // kill-session confirmation cancel itself every time.
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { resp in
      completionHandler(resp == .alertFirstButtonReturn)
    }
  }

  // Links out of localhost open in the default browser, not in this window.
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = navigationAction.request.url,
       ["http", "https"].contains(url.scheme ?? ""),
       url.host != "localhost", url.host != "127.0.0.1" {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction,
               windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  @objc func reloadPage(_ sender: Any?) { webView.reloadFromOrigin() }

  // MARK: menu
  // No cmd+w, cmd+d, cmd+b, cmd+t, cmd+n here: the browser interface owns those.

  func buildMenu() {
    let main = NSMenu()

    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "About Agent Shell",
      action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Agent Shell",
      action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit Agent Shell",
      action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem()
    main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    let viewItem = NSMenuItem()
    main.addItem(viewItem)
    let view = NSMenu(title: "View")
    let reload = NSMenuItem(title: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r")
    reload.target = self
    reload.keyEquivalentModifierMask = [.command, .shift]
    view.addItem(reload)
    view.addItem(.separator())
    let fullscreen = NSMenuItem(title: "Enter Full Screen",
      action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    fullscreen.keyEquivalentModifierMask = [.command, .control]
    view.addItem(fullscreen)
    viewItem.submenu = view

    let windowItem = NSMenuItem()
    main.addItem(windowItem)
    let windowMenu = NSMenu(title: "Window")
    windowMenu.addItem(withTitle: "Minimize",
      action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "Zoom",
      action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    windowItem.submenu = windowMenu
    NSApp.windowsMenu = windowMenu

    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
