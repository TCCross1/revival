import Foundation
import RoomPlan
import WebKit

/// WKWebView bridge for Revival Pro Floor Plan Studio.
///
/// 1. Add a WKWebView that loads the Revival web app.
/// 2. Register `roomPlan` as a script-message handler.
/// 3. When the web app posts `{ action: "scan" }`, present RoomCaptureViewController.
/// 4. On completion, encode the captured room as JSON and call `window.revivalReceiveScan(...)`.
///
/// JSON shape matches `backend/roomplan_import.py` (meters, Y-up transforms).

final class RevivalRoomPlanBridge: NSObject, WKScriptMessageHandler, RoomCaptureViewControllerDelegate {
    private weak var webView: WKWebView?
    private var capture: RoomCaptureViewController?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        webView.configuration.userContentController.add(self, name: "roomPlan")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "roomPlan" else { return }
        presentScanner()
    }

    func presentScanner() {
        guard RoomCaptureSession.isSupported else {
            deliverError("This iPhone does not support RoomPlan. Import a scan JSON instead.")
            return
        }
        let controller = RoomCaptureViewController()
        controller.delegate = self
        capture = controller
        webView?.window?.rootViewController?.present(controller, animated: true)
    }

    func captureView(_ controller: RoomCaptureViewController, didPresent capturedRoom: CapturedRoom, error: Error?) {
        controller.dismiss(animated: true)
        capture = nil
        if let error {
            deliverError(error.localizedDescription)
            return
        }
        do {
            let payload = encode(capturedRoom)
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            guard let json = String(data: data, encoding: .utf8) else {
                deliverError("Could not encode that scan.")
                return
            }
            let script = "window.revivalReceiveScan && window.revivalReceiveScan(\(json))"
            webView?.evaluateJavaScript(script) { _, evalError in
                if let evalError {
                    NSLog("Revival RoomPlan callback failed: \(evalError.localizedDescription)")
                }
            }
        } catch {
            deliverError("Could not encode that scan.")
        }
    }

    private func deliverError(_ message: String) {
        let escaped = message.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        webView?.evaluateJavaScript("window.revivalReceiveScan && window.revivalReceiveScan(null, \"\(escaped)\")")
    }

    private func encode(_ room: CapturedRoom) -> [String: Any] {
        [
            "units": "m",
            "meters": true,
            "walls": room.walls.map { encodeSurface($0, category: "wall") },
            "doors": room.doors.map { encodeSurface($0, category: "door") },
            "windows": room.windows.map { encodeSurface($0, category: "window") },
            "openings": room.openings.map { encodeSurface($0, category: "opening") },
            "objects": room.objects.map(encodeObject),
        ]
    }

    private func encodeSurface(_ surface: CapturedRoom.Surface, category: String) -> [String: Any] {
        [
            "category": category,
            "dimensions": [surface.dimensions.x, surface.dimensions.y, surface.dimensions.z],
            "transform": flatten(surface.transform),
        ]
    }

    private func encodeObject(_ object: CapturedRoom.Object) -> [String: Any] {
        [
            "category": objectCategory(object.category),
            "dimensions": [object.dimensions.x, object.dimensions.y, object.dimensions.z],
            "transform": flatten(object.transform),
        ]
    }

    private func flatten(_ matrix: simd_float4x4) -> [Float] {
        let c = matrix.columns
        return [
            c.0.x, c.0.y, c.0.z, c.0.w,
            c.1.x, c.1.y, c.1.z, c.1.w,
            c.2.x, c.2.y, c.2.z, c.2.w,
            c.3.x, c.3.y, c.3.z, c.3.w,
        ]
    }

    private func objectCategory(_ category: CapturedRoom.Object.Category) -> String {
        switch category {
        case .storage: return "storage"
        case .refrigerator: return "refrigerator"
        case .stove: return "stove"
        case .bed: return "bed"
        case .sink: return "sink"
        case .washerDryer: return "washerDryer"
        case .toilet: return "toilet"
        case .bathtub: return "bathtub"
        case .oven: return "oven"
        case .dishwasher: return "dishwasher"
        case .table: return "table"
        case .sofa: return "sofa"
        case .chair: return "chair"
        case .fireplace: return "fireplace"
        case .television: return "television"
        case .stairs: return "stairs"
        @unknown default: return "storage"
        }
    }
}
