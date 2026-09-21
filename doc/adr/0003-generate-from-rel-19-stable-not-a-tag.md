# 3. Generate From REL_19_STABLE Rather Than the Newest Tag

Date: 2026-09-21

## Status

Accepted

Amends [2. Match PostgreSQL Release Versioning](0002-match-postgresql-release-versioning.md).

## Context

Until now the generator has always been pointed at a PostgreSQL `REL_*` tag. A tag is immutable, so anyone can reproduce a build byte for byte, and the README can name one line that fully identifies the dialect the grammar parses.

PostgreSQL 19 broke that assumption. Five features that shipped in the betas were reverted on `REL_19_STABLE` afterwards:

| Feature | Reverted |
| --- | --- |
| `GROUP BY ALL` | 2026-07-17, before the `REL_19_BETA3` tag |
| `ALTER TABLE MERGE`/`SPLIT PARTITION` | 2026-08-27 |
| SQL/PGQ property graphs | 2026-09-07 |
| More object types in `CREATE SCHEMA` | 2026-09-11 |
| `UPDATE`/`DELETE ... FOR PORTION OF` | 2026-09-15 |

`REL_19_BETA3`, the newest tag, contains only the first revert; the other four features are still present in it. No release candidate is tagged yet. Generating from that tag would ship a grammar that accepts four syntaxes PostgreSQL 19.0 will reject, and the SQL/PGQ revert also removed the `RIGHT_ARROW` token and the standalone `|` self character from `scan.l`, so even the shape of ordinary `->` and `|` expressions differs between the tag and the branch.

## Decision

While a PostgreSQL major release is in the window between its last beta tag and its first release candidate, we will generate from the `REL_XX_STABLE` branch at a specific commit, rather than from the newest tag. PostgreSQL 19 support is generated from `REL_19_STABLE` at `b368bdd2301`.

`README.md` and `CONTRIBUTING.md` name that commit instead of a `REL_*` tag, and say which beta features it drops. Once `REL_19_RC1` or `REL_19_0` is tagged, we go back to naming a tag.

The version number still follows ADR 2 and tracks the PostgreSQL release, so this build is `19.0.0-beta.3` — the nearest supported pre-release form, not an exact statement of the upstream commit.

## Consequences

- The grammar matches the SQL that PostgreSQL 19.0 will actually accept, which is the question ADR 2 says the version string exists to answer.
- Reproducibility is preserved by pinning a commit SHA, but the reference is less legible than a tag and a reader must consult the docs to know what it means.
- Features can come back. Anything reverted during the beta window may be re-applied before GA, so the reverts above are removals for now, not a permanent statement about PostgreSQL 19.
- Corpus tests for reverted syntax are deleted rather than kept and skipped. Git history is the record; `postgres/test/corpus/property_graph.txt` can be restored from the `19.0.0-beta.2` tag if SQL/PGQ returns.
- The version number cannot express "post-beta 3." A pre-release generated from a branch will always look like the nearest beta, so the docs, not the version, are the source of truth for the exact upstream revision.
