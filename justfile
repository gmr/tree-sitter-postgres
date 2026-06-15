# tree-sitter-postgres justfile

version := "1.2.3"
language_name := "tree-sitter-postgres"
ts := "./node_modules/.bin/tree-sitter"

# Default: run tests
default: test

# Run corpus tests for both grammars
test:
    {{ts}} test
    cd plpgsql && ../node_modules/.bin/tree-sitter test

# Run only the Node codegen for the postgres grammar (writes postgres/grammar.js,
# skips the parse-table build, which needs ~67 GB of RAM — see CONTRIBUTING.md)
codegen-postgres pg_dir=env("PG_SOURCE_DIR"):
    node script/generate-grammar.js {{pg_dir}}

# Generate the postgres grammar from PostgreSQL source
generate-postgres pg_dir=env("PG_SOURCE_DIR"): (codegen-postgres pg_dir)
    cd postgres && ../node_modules/.bin/tree-sitter generate

# Generate postgres language injection queries
generate-injections:
    node script/generate-injections.js

# Generate the plpgsql parser
generate-plpgsql:
    cd plpgsql && ../node_modules/.bin/tree-sitter generate

# Generate both grammars
generate pg_dir=env("PG_SOURCE_DIR"): (generate-postgres pg_dir) generate-injections generate-plpgsql

# Harvest GLR conflicts for the postgres grammar
harvest-conflicts pg_dir=env("PG_SOURCE_DIR"):
    bash postgres/harvest-conflicts.sh {{pg_dir}}

# Build WebAssembly
build-wasm:
    {{ts}} build --wasm

# Open playground (requires wasm build)
playground: build-wasm
    {{ts}} playground

# Clean build artifacts
clean:
    rm -f postgres/src/*.o plpgsql/src/*.o
    rm -f lib{{language_name}}.a lib{{language_name}}.so lib{{language_name}}.dylib
    rm -f {{language_name}}.pc
    rm -f *.wasm

# Bump version across all config files
bump new_version:
    #!/usr/bin/env bash
    set -euo pipefail
    new="{{new_version}}"
    re='[0-9]+\.[0-9]+\.[0-9]+'
    echo "Bumping version to: $new"
    sed -i '' -E "s/^version := \"${re}\"/version := \"${new}\"/" justfile
    sed -i '' -E "1,10s/\"version\": \"${re}\"/\"version\": \"${new}\"/" package.json
    sed -i '' -E "1,15s/\"version\": \"${re}\"/\"version\": \"${new}\"/g" package-lock.json
    sed -i '' -E "s/^version = \"${re}\"/version = \"${new}\"/" Cargo.toml
    sed -i '' -E "s/^version = \"${re}\"/version = \"${new}\"/" pyproject.toml
    sed -i '' -E "1,10s/\"version\": \"${re}\"/\"version\": \"${new}\"/" tree-sitter.json
    # Cargo.lock is updated by cargo
    cargo update --workspace
    echo "Updated: justfile, package.json, package-lock.json, Cargo.toml, pyproject.toml, tree-sitter.json, Cargo.lock"

# Publish dry run (all registries)
publish-dry-run:
    cargo publish --dry-run

# Install locally (C library)
install prefix="/usr/local":
    #!/usr/bin/env bash
    set -euo pipefail
    INCLUDEDIR="{{prefix}}/include"
    LIBDIR="{{prefix}}/lib"
    install -d "$INCLUDEDIR/tree_sitter" "$LIBDIR"
    install -m644 bindings/c/{{language_name}}.h "$INCLUDEDIR/tree_sitter/{{language_name}}.h"
    install -m644 lib{{language_name}}.a "$LIBDIR/lib{{language_name}}.a" 2>/dev/null || true
    echo "Installed to {{prefix}}"
