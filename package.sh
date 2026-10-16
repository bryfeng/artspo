#!/bin/sh
# Builds the release files into dist/:
#   artspo-<version>.zip            the whole repo, for people installing by hand (Load unpacked)
#   artspo-extension-<version>.zip  just extension/, the upload for the Chrome Web Store
# Usage: sh package.sh
set -e
cd "$(dirname "$0")"
V=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/artspo-$V.zip" "dist/artspo-extension-$V.zip"
REPO=$(pwd); NAME=$(basename "$REPO")
(cd extension && zip -qr "$REPO/dist/artspo-extension-$V.zip" . -x '*__pycache__*' '*.DS_Store')
(cd .. && zip -qr "$REPO/dist/artspo-$V.zip" "$NAME" -x "$NAME/dist/*" "$NAME/.git/*" '*__pycache__*' '*.DS_Store')
echo "dist/artspo-$V.zip"
echo "dist/artspo-extension-$V.zip"
