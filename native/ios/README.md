# Revival iPhone app (kitchen scanner)

This folder is the real iPhone app shell for Revival Pro. A home-screen bookmark cannot use LiDAR. This app loads the Revival website in a full-screen web view and turns on Apple RoomPlan when Plans taps **Scan kitchen**.

## What you need

- A Mac with Xcode 15 or newer
- An iPhone 16 Pro or 16 Pro Max (LiDAR + iOS 17+)
- A **live Revival website address** the phone can open on the internet (not `http://127.0.0.1:3000` on this practice computer)
- Your Apple ID in Xcode (free works for about a week; a paid Apple Developer account keeps the install)

## Point the app at your live site

1. Open `native/ios/Revival.xcodeproj` in Xcode.
2. Open `Revival/Info.plist`.
3. Set `RevivalWebURL` to your live Revival URL, for example `https://your-revival-host.example`.
4. Signing & Capabilities → Team → choose your Apple ID. Keep the bundle id `com.revivalhomeremodeling.pro` or change it to one you own.

The phone never talks to the cloud agent’s practice copy. If Revival is only running on a laptop at `127.0.0.1`, host it somewhere public (or use a tunnel such as ngrok) and put that https address in `RevivalWebURL`.

## Install on the iPhone 16 Pro Max

1. Unlock the phone, plug it into the Mac, and tap Trust if asked.
2. In Xcode, pick your iPhone as the run destination (not a simulator — RoomPlan needs the real LiDAR).
3. Press Run. The first time, open Settings → General → VPN & Device Management on the phone and trust your developer certificate.
4. Sign into Revival inside the app with your normal account.
5. Open a job → **Scan room**. Walk the kitchen or bathroom slowly. When the scan finishes, Plans receives walls, doors, windows, and fixtures marked **from scan – verify**. Fix any measurement before you order.

Kitchen scans place cabinets and appliances. Bathroom scans place toilets, tubs or showers, vanities, and over-toilet wall cabinets when RoomPlan reports those objects.

## How the pieces connect

```
iPhone app (WKWebView)
  └─ loads RevivalWebURL
       └─ Plans → Scan room
            └─ window.webkit.messageHandlers.roomPlan.postMessage({ action: "scan" })
                 └─ RevivalRoomPlanBridge → Apple RoomPlan
                      └─ window.revivalReceiveScan(json)
                           └─ POST /api/floor-plans/{id}/import-roomplan
                                └─ editable plan in Floor Plan Studio
```

Storage boxes from RoomPlan become base cabinets, wall cabinets, or a tall pantry in a kitchen. In a bathroom they become vanities, linen cabinets, or over-toilet wall cabinets. Fridge, range, dishwasher, sink, toilet, tub/shower, doors, windows, and walls are placed the same way. Every scanned piece stays editable in Plans.

## Files

| Path | Role |
| --- | --- |
| `Revival.xcodeproj` | Open this in Xcode |
| `Revival/RevivalApp.swift` | App entry |
| `Revival/WebShellViewController.swift` | Full-screen web view + load errors |
| `Revival/Info.plist` | Camera text + `RevivalWebURL` |
| `Revival/Assets.xcassets/AppIcon.appiconset` | Home-screen icon from the Revival emblem |
| `RevivalRoomPlanBridge.swift` | LiDAR / RoomPlan bridge |
| `RevivalSquareReaderBridge.swift` | Placeholder for on-site Square Reader later |

The website uses the same emblem for Add to Dock / Add to Home Screen (`frontend/public/manifest.json` and `frontend/public/icons/`).

## Limits

- This cloud computer cannot install the app on your phone. That last step is on your Mac.
- The iOS Simulator cannot run RoomPlan. Use the physical iPhone 16 Pro Max.
- Free Apple ID installs expire in about seven days. Re-run from Xcode, or use a paid developer account.
