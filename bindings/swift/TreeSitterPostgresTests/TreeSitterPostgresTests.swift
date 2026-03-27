import XCTest
import SwiftTreeSitter
import TreeSitterPostgres

final class TreeSitterPostgresTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_postgres())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Postgres grammar")
    }
}
