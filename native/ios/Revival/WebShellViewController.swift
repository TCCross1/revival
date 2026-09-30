import UIKit
import WebKit

/// Full-screen WKWebView that loads the Revival Pro website and attaches native bridges.
final class WebShellViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var roomPlanBridge: RevivalRoomPlanBridge?
    private var squareBridge: RevivalSquareReaderBridge?
    private let statusLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 11 / 255, green: 58 / 255, blue: 143 / 255, alpha: 1)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        if #available(iOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        statusLabel.textColor = .white
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.isHidden = true
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)

        retryButton.setTitle("Try again", for: .normal)
        retryButton.setTitleColor(.white, for: .normal)
        retryButton.backgroundColor = UIColor(red: 201 / 255, green: 162 / 255, blue: 39 / 255, alpha: 1)
        retryButton.layer.cornerRadius = 10
        retryButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 20, bottom: 12, right: 20)
        retryButton.isHidden = true
        retryButton.addTarget(self, action: #selector(loadRevival), for: .touchUpInside)
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(retryButton)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -24),
            retryButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 16),
            retryButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])

        roomPlanBridge = RevivalRoomPlanBridge(webView: webView, presenter: self)
        squareBridge = RevivalSquareReaderBridge(webView: webView)
        loadRevival()
    }

    @objc private func loadRevival() {
        statusLabel.isHidden = true
        retryButton.isHidden = true
        webView.isHidden = false
        guard let url = Self.revivalURL() else {
            showError(
                "Set RevivalWebURL in Info.plist to your live Revival website. This phone cannot open the practice computer at 127.0.0.1."
            )
            return
        }
        NSLog("Revival loading %@", url.absoluteString)
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60))
    }

    private func showError(_ message: String) {
        webView.isHidden = true
        statusLabel.isHidden = false
        retryButton.isHidden = false
        statusLabel.text = message
        NSLog("Revival shell error: %@", message)
    }

    static func revivalURL() -> URL? {
        let raw = (
            Bundle.main.object(forInfoDictionaryKey: "RevivalWebURL") as? String
                ?? ProcessInfo.processInfo.environment["REVIVAL_WEB_URL"]
                ?? ""
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else {
            return nil
        }
        return url
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError("Could not reach Revival. Check RevivalWebURL and your network, then try again.\n\n\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError("Revival stopped loading. Try again.\n\n\(error.localizedDescription)")
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
