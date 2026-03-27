//! This crate provides PostgreSQL and PL/pgSQL language support for the
//! [tree-sitter][] parsing library.
//!
//! Typically, you will use the [LANGUAGE][] constant to add the PostgreSQL SQL
//! grammar to a tree-sitter [Parser][], and [LANGUAGE_PLPGSQL][] for PL/pgSQL:
//!
//! ```
//! let code = r#"
//! "#;
//! let mut parser = tree_sitter::Parser::new();
//! let language = tree_sitter_postgres::LANGUAGE;
//! parser
//!     .set_language(&language.into())
//!     .expect("Error loading Postgres parser");
//! let tree = parser.parse(code, None).unwrap();
//! assert!(!tree.root_node().has_error());
//! ```
//!
//! [Parser]: https://docs.rs/tree-sitter/*/tree_sitter/struct.Parser.html
//! [tree-sitter]: https://tree-sitter.github.io/

use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_postgres() -> *const ();
    fn tree_sitter_plpgsql() -> *const ();
}

/// The tree-sitter [`LanguageFn`] for the PostgreSQL SQL grammar.
pub const LANGUAGE: LanguageFn = unsafe { LanguageFn::from_raw(tree_sitter_postgres) };

/// The tree-sitter [`LanguageFn`] for the PL/pgSQL grammar.
pub const LANGUAGE_PLPGSQL: LanguageFn = unsafe { LanguageFn::from_raw(tree_sitter_plpgsql) };

/// The content of the [`node-types.json`][] file for the PostgreSQL grammar.
pub const NODE_TYPES: &str = include_str!("../../postgres/src/node-types.json");

/// The content of the [`node-types.json`][] file for the PL/pgSQL grammar.
pub const NODE_TYPES_PLPGSQL: &str = include_str!("../../plpgsql/src/node-types.json");

#[cfg(test)]
mod tests {
    #[test]
    fn test_can_load_grammar() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&super::LANGUAGE.into())
            .expect("Error loading Postgres parser");
    }

    #[test]
    fn test_can_load_plpgsql_grammar() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&super::LANGUAGE_PLPGSQL.into())
            .expect("Error loading PL/pgSQL parser");
    }
}
