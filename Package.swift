// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterPostgres",
    products: [
        .library(name: "TreeSitterPostgres", targets: ["TreeSitterPostgres"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ChimeHQ/SwiftTreeSitter", from: "0.8.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterPostgres",
            dependencies: [],
            path: ".",
            sources: [
                "postgres/src/parser.c",
                // NOTE: if your language has an external scanner, add it here.
            ],
            resources: [
                .copy("postgres/queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("postgres/src")]
        ),
        .testTarget(
            name: "TreeSitterPostgresTests",
            dependencies: [
                "SwiftTreeSitter",
                "TreeSitterPostgres",
            ],
            path: "bindings/swift/TreeSitterPostgresTests"
        )
    ],
    cLanguageStandard: .c11
)
