#!/bin/bash
# Bundle iru-form-engine modules into api/_python/ for Vercel deployment
# Run as part of buildCommand: npm run build && bash scripts/bundle-form-engine.sh
#
# HISTORY (Carbon Pass 1 finding 21e): this script used to copy *.py from
# a sibling ../iru-form-engine checkout and patch api/fill-*.py imports.
# Both are dead: the fill scripts were consolidated into api/fill.py, and
# api/_python/ is tracked in git (force-added despite .gitignore), so the
# modules arrive with the checkout — there is nothing to copy in Vercel's
# build container (no sibling directory exists there). The script now only
# verifies the bundled modules are present, so a missing api/_python/
# fails the build loudly instead of failing /api/fill at runtime.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$REPO_ROOT/api/_python"

echo "Verifying bundled form-engine modules..."
mkdir -p "$DEST"

# The fill path needs at least the core binder modules; fail the build
# if the checkout is missing them rather than shipping a broken /api/fill.
missing=0
for mod in binder.py biographic.py address.py master_binder.py i90_full_binder.py i130_full_registry.py i485_full_binder.py n400_full_binder.py i765_full_binder.py i589_full_binder.py; do
    if [ ! -f "$DEST/$mod" ]; then
        echo "ERROR: missing bundled module: api/_python/$mod" >&2
        missing=1
    fi
done
if [ "$missing" -ne 0 ]; then
    echo "ERROR: api/_python/ is incomplete; see above." >&2
    exit 1
fi

echo "Bundle verified: $(ls "$DEST"/*.py 2>/dev/null | wc -l) Python modules in api/_python/"
