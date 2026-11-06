#!/bin/sh
# Copy the .md summaries the pipeline wrote next to its data into the repo, so they are versioned and the data files are not.
set -e
ASSETS="${ASSETS:-$HOME/Documents/code/2DRoundAssets}"
cd "$(dirname "$0")/.."
cp "$ASSETS"/reports/*.md docs/reports/ 2>/dev/null || true
ls docs/reports
