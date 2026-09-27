import Foundation
import WebKit

/// WKWebView bridge for Revival Pro on-site Square deposits (phase 2 Reader SDK).
///
/// Phase 1 uses Square Terminal API / payment links from the web app.
/// When the native Reader SDK is embedded:
/// 1. Register `squareReader` as a script-message handler.
/// 2. When the web app posts `{ action: "collect", amount, jobId, depositId }`,
///    present Square's Reader checkout.
/// 3. On success, POST the payment nonce to
///    `/api/jobs/{jobId}/deposits/{depositId}/complete` with `{ source_id }`.
///    Never log the nonce, card data, or access tokens.
/// 4. Optionally call `window.revivalSquarePayment({ depositId, ok: true })`.

final class RevivalSquareReaderBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        webView.configuration.userContentController.add(self, name: "squareReader")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "squareReader" else { return }
        deliver(
            "This iPhone build does not yet embed the Square Reader SDK. Use Terminal checkout or the Square payment link from Collect Deposit."
        )
    }

    private func deliver(_ error: String) {
        let payload = error.replacingOccurrences(of: "\"", with: "\\\"")
        let js = "window.revivalSquarePayment && window.revivalSquarePayment({ ok: false, error: \"\(payload)\" });"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }
}
