#!/usr/bin/env bash
# Chrome Web Store 제출용 익스텐션 zip 빌드
# 사용법: ./build.sh
# 산출물: dist/unmixaudio-<version>.zip

set -e

cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
DIST_DIR="dist"
OUT_ZIP="$DIST_DIR/unmixaudio-$VERSION.zip"

echo "[build] manifest version: $VERSION"
mkdir -p "$DIST_DIR"
rm -f "$OUT_ZIP"

# 익스텐션에 실제로 사용되는 파일만 명시적으로 포함 (whitelist 방식)
# 화이트리스트로 가는 이유: dev/, test/, backend deploy config 같은 부속 자산을
#                       실수로 같이 묶어 보내지 않기 위함.
zip -r "$OUT_ZIP" \
  manifest.json \
  background.js \
  offscreen.html offscreen.js \
  sandbox.html sandbox.js \
  sidepanel.html sidepanel.js \
  content-script.js \
  audio-worklet-processor.js \
  privacy-policy.html \
  icons/ \
  lib/ \
  -x "**/.DS_Store" \
  -x "lib/meyda.min.js" \
  > /dev/null

SIZE=$(du -h "$OUT_ZIP" | cut -f1)
echo "[build] OK: $OUT_ZIP ($SIZE)"
echo ""
echo "[build] zip 내용 검증:"
unzip -l "$OUT_ZIP" | tail -20
