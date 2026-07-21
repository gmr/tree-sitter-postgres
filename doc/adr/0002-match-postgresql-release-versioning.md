# 2. Match PostgreSQL Release Versioning

Date: 2026-07-21

## Status

Accepted

## Context

This grammar is auto-generated from PostgreSQL's own Bison grammar (`gram.y`) and keyword list (`kwlist.h`). Each PostgreSQL major release changes that source: new keywords, new syntax, and reworked grammar rules. As a result, any given build of `tree-sitter-postgres` is only ever correct for one PostgreSQL major version — the one it was generated from.

If we version the project with independent semver, that coupling is invisible to consumers. A version like `1.4.0` says nothing about which PostgreSQL dialect it parses, and there is no reliable way for a user to answer the question that actually matters to them: "Does this parse the SQL my PostgreSQL server accepts?" A changelog entry ("adds PG 19 support") is easy to miss and drifts out of sync with the version string.

## Decision

We will version `tree-sitter-postgres` in lock step with the PostgreSQL release it is generated from. The major (and, for pre-releases, minor/patch) version tracks the supported PostgreSQL release rather than an independent semver counter.

Version numbers use standard semver in the JavaScript, Rust, and tree-sitter manifests (`package.json`, `package-lock.json`, `Cargo.toml`, `tree-sitter.json`, `justfile`), and the PEP 440 form in `pyproject.toml`. For example, the first PostgreSQL 19 pre-release is `19.0.0-beta.2` (semver) / `19.0.0b2` (PEP 440), generated from `REL_19_BETA2`.

## Consequences

- The supported PostgreSQL version is self-documenting: a user can read the package version and know exactly which PostgreSQL dialect the grammar targets, without consulting a changelog.
- New PostgreSQL major releases map directly onto new major versions here, making the upgrade cadence predictable and the release intent unambiguous.
- We give up the conventional semver signal for breaking changes. A PostgreSQL major bump is a major bump here regardless of whether our grammar API or S-expression output changed in a breaking way, and grammar-only changes that would otherwise warrant a major bump must be expressed within the minor/patch space of a single PostgreSQL release.
- Release tooling must handle version strings in two forms (semver and PEP 440) and support pre-release identifiers. The `just bump` recipe only matches plain `x.y.z` versions, so pre-release bumps currently require a manual edit or a recipe fix.
