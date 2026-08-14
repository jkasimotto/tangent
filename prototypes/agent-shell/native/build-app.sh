#!/bin/bash
# Builds the native Agent Shell app and installs it to ~/Applications.
# Usage: bash native/build-app.sh   (or: npm run app)
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="Agent Shell"
BUILD=build
APP="$BUILD/$APP_NAME.app"

echo "building Reviewed build runtime..."
npm run build -w @tangent/agent-runtime --prefix ../../..
npm run build -w @tangent/repo --prefix ../../..
npm run build -w @tangent/agent-shell --prefix ../../..

rm -rf "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "compiling..."
swiftc -O -o "$APP/Contents/MacOS/$APP_NAME" main.swift

echo "building icon..."
ICONSET="$BUILD/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" ../public/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" ../public/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cp Info.plist "$APP/Contents/Info.plist"
codesign --force --sign - "$APP"

echo "installing to ~/Applications..."
osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
rm -rf "$HOME/Applications/$APP_NAME.app"
ditto "$APP" "$HOME/Applications/$APP_NAME.app"
echo "installed: ~/Applications/$APP_NAME.app"
open "$HOME/Applications/$APP_NAME.app"
echo "reopened: $APP_NAME"
