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

    func testCanLoadPlpgsqlGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_plpgsql())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading PL/pgSQL grammar")
    }
}
