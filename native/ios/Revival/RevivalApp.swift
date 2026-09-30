import SwiftUI

@main
struct RevivalApp: App {
    var body: some Scene {
        WindowGroup {
            WebShellRepresentable()
                .ignoresSafeArea()
        }
    }
}

private struct WebShellRepresentable: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebShellViewController {
        WebShellViewController()
    }

    func updateUIViewController(_ uiViewController: WebShellViewController, context: Context) {}
}
