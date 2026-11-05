#!/bin/bash
# Bundle iru-form-engine modules into api/_python/ for Vercel deployment
# Run as part of buildCommand: npm run build && bash scripts/bundle-form-engine.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/../iru-form-engine"
DEST="$REPO_ROOT/api/_python"

echo "Bundling form-engine modules..."
mkdir -p "$DEST"

# Copy all Python modules
cp "$SRC"/*.py "$DEST/" 2>/dev/null || {
    echo "WARNING: Could not copy from $SRC, trying alternative..."
    # Fallback: already copied manually
}

# Copy JSON data files (baselines, field maps)
cp "$SRC"/*.json "$DEST/" 2>/dev/null || true

# Rewrite imports in api/fill-*.py to use _python prefix
# The fill scripts do: sys.path.insert(0, '../../iru-form-engine')
# We need them to import from _python instead
for f in "$REPO_ROOT"/api/fill-*.py; do
    if [ -f "$f" ]; then
        echo "Patching $f for bundled imports..."
        # Replace the sys.path hack with _python import path
        # The _python directory is a sibling of fill-*.py in the api/ dir
        python3 - "$f" << 'PYEOF'
import sys
path = sys.argv[1]
with open(path) as fh:
    src = fh.read()

# Replace the iru-form-engine path insert with api/_python
old = "sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../iru-form-engine'))"
new = "sys.path.insert(0, os.path.dirname(__file__))  # _python is sibling"

if old in src:
    src = src.replace(old, new)
    # Also need to handle 'from binder import' -> 'from _python.binder import'
    # But since _python is now on sys.path via api/ dir, and _python is a package,
    # we can do: import _python.binder - actually simpler: add api/ to path and use _python.X
    with open(path, 'w') as out:
        out.write(src)
    print(f"  Patched {path}")
else:
    print(f"  No patch needed for {path}")
PYEOF
    fi
done

echo "Bundle complete: $(ls "$DEST"/*.py 2>/dev/null | wc -l) Python modules"
