# tree-sitter-postgres justfile

version := "19.0.0-beta.2"
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
    # Only stable and the prerelease suffixes py_new normalizes are supported.
    # Reject anything else up front so we never emit an invalid PEP 440 version.
    if ! echo "$new" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.?[0-9]+)?$'; then
        echo "Error: unsupported version '$new'" >&2
        echo "Supported: x.y.z or x.y.z-{alpha,beta,rc}.N (e.g. 19.0.0-beta.2)" >&2
        exit 1
    fi
    # Match x.y.z with an optional prerelease suffix (e.g. -beta.2)
    re='[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.?[0-9]+)?'
    # pyproject.toml uses PEP 440 form, so match/emit the normalized version
    # (e.g. 19.0.0-beta.2 -> 19.0.0b2) separately.
    py_new=$(echo "$new" | sed -E 's/-alpha\.?/a/; s/-beta\.?/b/; s/-rc\.?/rc/')
    py_re='[0-9]+\.[0-9]+\.[0-9]+([abrc]+[0-9]+)?'
    echo "Bumping version to: $new (pyproject: $py_new)"
    sed -i '' -E "s/^version := \"${re}\"/version := \"${new}\"/" justfile
    sed -i '' -E "1,10s/\"version\": \"${re}\"/\"version\": \"${new}\"/" package.json
    sed -i '' -E "1,15s/\"version\": \"${re}\"/\"version\": \"${new}\"/g" package-lock.json
    sed -i '' -E "s/^version = \"${re}\"/version = \"${new}\"/" Cargo.toml
    sed -i '' -E "s/^version = \"${py_re}\"/version = \"${py_new}\"/" pyproject.toml
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
