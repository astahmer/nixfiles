// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "secret-unlock-helper",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "secret-unlock-helper")
    ]
)
