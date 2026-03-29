# tree-sitter-postgres justfile

version := "1.0.0"
language_name := "tree-sitter-postgres"
ts := "./node_modules/.bin/tree-sitter"

# Default: run tests
default: test

# Run corpus tests
test:
    {{ts}} test

# Generate the postgres grammar from PostgreSQL source
generate-postgres pg_dir="$HOME/Source/gmr/postgres":
    node script/generate-grammar.js {{pg_dir}}
    {{ts}} generate postgres/grammar.js

# Generate the plpgsql parser
generate-plpgsql:
    cd plpgsql && {{ts}} generate

# Generate both grammars
generate pg_dir="$HOME/Source/gmr/postgres": (generate-postgres pg_dir) generate-plpgsql

# Harvest GLR conflicts for the postgres grammar
harvest-conflicts pg_dir="$HOME/Source/gmr/postgres":
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
    old="{{version}}"
    new="{{new_version}}"
    echo "Bumping version: $old → $new"
    sed -i '' "s/^version := \"$old\"/version := \"$new\"/" justfile
    sed -i '' "s/\"version\": \"$old\"/\"version\": \"$new\"/" package.json
    sed -i '' "s/^version = \"$old\"/version = \"$new\"/" Cargo.toml
    sed -i '' "s/^version = \"$old\"/version = \"$new\"/" pyproject.toml
    sed -i '' "s/\"version\": \"$old\"/\"version\": \"$new\"/" tree-sitter.json
    # Cargo.lock is updated by cargo
    cargo update --workspace
    echo "Updated: justfile, package.json, Cargo.toml, pyproject.toml, tree-sitter.json, Cargo.lock"

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
