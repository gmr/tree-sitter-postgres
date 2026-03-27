#!/usr/bin/env bash
# harvest-conflicts.sh — iteratively collect unresolved GLR conflicts.
#
# Each iteration:
#   1. Runs tree-sitter generate
#   2. If it reports an unresolved conflict, adds the pair to known-conflicts.json
#   3. Regenerates grammar.js from source (which includes known-conflicts.json)
#   4. Repeats until tree-sitter generate succeeds or max iterations reached.

set -uo pipefail

TS="./node_modules/.bin/tree-sitter"
CONFLICTS_FILE="script/known-conflicts.json"
POSTGRES_DIR="${1:-$HOME/Source/gmr/postgres}"
MAX_ITERATIONS=300
CONFLICT_COUNT=0

echo "Starting conflict-harvesting loop (max $MAX_ITERATIONS iterations)..."
echo "Postgres dir: $POSTGRES_DIR"
echo ""

for i in $(seq 1 $MAX_ITERATIONS); do
  OUTPUT=$($TS generate 2>&1 || true)

  if ! echo "$OUTPUT" | grep -q "Unresolved conflict"; then
    if echo "$OUTPUT" | grep -qiE "^Error|Failed to load"; then
      echo "Non-conflict error at iteration $i:"
      echo "$OUTPUT"
      exit 1
    else
      echo "tree-sitter generate SUCCEEDED after $i iteration(s)."
      echo "Total conflict pairs added: $CONFLICT_COUNT"
      exit 0
    fi
  fi

  # Extract rule names from "Add a conflict for these rules: `X`, `Y`"
  CONFLICT_LINE=$(echo "$OUTPUT" | grep "Add a conflict for these rules:")
  RULE1=$(echo "$CONFLICT_LINE" | grep -oE '\`[a-zA-Z_][a-zA-Z0-9_]*\`' | sed -n '1p' | tr -d '`')
  RULE2=$(echo "$CONFLICT_LINE" | grep -oE '\`[a-zA-Z_][a-zA-Z0-9_]*\`' | sed -n '2p' | tr -d '`')

  if [ -z "$RULE1" ]; then
    echo "Could not parse any rule names from conflict line:"
    echo "  $CONFLICT_LINE"
    echo "Full output:"
    echo "$OUTPUT"
    exit 1
  fi

  # Single-rule conflict (shift/reduce within the rule itself) — add as self-pair
  if [ -z "$RULE2" ] || [ "$RULE1" = "$RULE2" ]; then
    RULE2="$RULE1"
  fi

  # Add to known-conflicts.json using node (avoids python dependency)
  node - "$CONFLICTS_FILE" "$RULE1" "$RULE2" <<'JSEOF'
const fs = require('fs');
const [,, file, r1, r2] = process.argv;
const conflicts = JSON.parse(fs.readFileSync(file, 'utf8'));

// Check if already present (either order)
const already = conflicts.some(([a, b]) =>
  (a === r1 && b === r2) || (a === r2 && b === r1)
);

if (already) {
  console.error(`Conflict [${r1}, ${r2}] already registered — grammar may have a non-conflict error.`);
  process.exit(1);
}

conflicts.push([r1, r2]);
fs.writeFileSync(file, JSON.stringify(conflicts, null, 2) + '\n');
console.log(`  Added: [${r1}, ${r2}]`);
JSEOF

  CONFLICT_COUNT=$((CONFLICT_COUNT + 1))

  # Regenerate grammar.js from source with the updated conflict list
  node script/generate-grammar.js "$POSTGRES_DIR" > /dev/null

done

echo "Reached max $MAX_ITERATIONS iterations with $CONFLICT_COUNT conflict pairs added."
exit 1
