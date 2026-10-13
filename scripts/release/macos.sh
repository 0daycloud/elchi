#!/usr/bin/env bash
# Build, sign, notarize and package Elchi for macOS.
#
#   ELCHI_SIGNING_IDENTITY="Developer ID Application: <Team name> (<TEAMID>)" \
#   ELCHI_NOTARY_PROFILE=elchi-notary \
#   scripts/release/macos.sh
#
# Needs, on this Mac:
# - the Developer ID Application certificate in the login keychain;
# - a notarytool Keychain profile, created once with
#     xcrun notarytool store-credentials elchi-notary --key <AuthKey.p8> --key-id <ID> --issuer <ISSUER>
#   (or --apple-id/--team-id with an app-specific password);
# - Elchi's updater key at ~/.tauri/elchi-updater.key, its password in the
#   Keychain item "elchi-updater-key-password".
#
# Order matters: the app is notarized and stapled first, and only then packed
# into the updater bundle and the DMG, so both carry the same notarized app.
#
# Output: dist/release/<version>/ with Elchi_<v>_universal.dmg,
# Elchi_<v>_universal.app.tar.gz and its .sig.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

IDENTITY="${ELCHI_SIGNING_IDENTITY:?set ELCHI_SIGNING_IDENTITY to the Developer ID Application identity}"
PROFILE="${ELCHI_NOTARY_PROFILE:-elchi-notary}"
TARGET="${ELCHI_MAC_TARGET:-universal-apple-darwin}"
ARCH_LABEL="${TARGET%%-apple-darwin}"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
OUT="$ROOT/dist/release/$VERSION"

fail() { echo "error: $*" >&2; exit 1; }

security find-identity -v -p codesigning | grep -qF "\"$IDENTITY\"" \
  || fail "signing identity not found in the keychain: $IDENTITY"
xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1 \
  || fail "notarytool Keychain profile '$PROFILE' is missing or invalid"
[ -f "$HOME/.tauri/elchi-updater.key" ] || fail "updater key missing: ~/.tauri/elchi-updater.key"

TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/elchi-updater.key")"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s elchi-updater-key-password -w)"
export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

echo "==> Building Elchi $VERSION for $TARGET, signed as: $IDENTITY"
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
# Tauri signs the app (hardened runtime, entitlements from tauri.conf.json).
# Its own notarization is skipped (no APPLE_* credentials in the environment);
# notarytool below does it with the Keychain profile.
APPLE_SIGNING_IDENTITY="$IDENTITY" CI=true \
  bun run tauri build --target "$TARGET" --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'

BUNDLE="$ROOT/src-tauri/target/$TARGET/release/bundle/macos"
APP="$BUNDLE/Elchi.app"
[ -d "$APP" ] || fail "no app bundle at $APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> Notarizing the app"
rm -rf "$OUT" && mkdir -p "$OUT"
ZIP="$OUT/Elchi-notarize.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait
rm -f "$ZIP"
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose "$APP"

echo "==> Updater bundle"
TARBALL="$OUT/Elchi_${VERSION}_${ARCH_LABEL}.app.tar.gz"
tar -C "$BUNDLE" -czf "$TARBALL" Elchi.app
bunx tauri signer sign "$TARBALL" >/dev/null
[ -f "$TARBALL.sig" ] || fail "updater signature was not written"

echo "==> DMG"
DMG="$OUT/Elchi_${VERSION}_${ARCH_LABEL}.dmg"
STAGE="$(mktemp -d)"
ditto "$APP" "$STAGE/Elchi.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Elchi" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
rm -rf "$STAGE"
codesign --sign "$IDENTITY" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose "$DMG"

(cd "$OUT" && shasum -a 256 ./*.dmg ./*.tar.gz > SHA256SUMS)
echo "==> Done: $OUT"
ls -la "$OUT"
