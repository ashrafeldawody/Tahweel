#!/usr/bin/env bash
set -euo pipefail

INSTALL=0
DEBUG=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    --debug) DEBUG=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT="$REPO/apps/listener"

find_jdk() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    echo "$JAVA_HOME"
    return
  fi
  local candidates=(
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    "/opt/android-studio/jbr"
    "$HOME/android-studio/jbr"
    "/usr/lib/jvm/java-21-openjdk-amd64"
    "/usr/lib/jvm/java-17-openjdk-amd64"
    "/usr/lib/jvm/default-java"
    "/usr/local/opt/openjdk@21"
    "/usr/local/opt/openjdk@17"
    "/opt/homebrew/opt/openjdk@21"
    "/opt/homebrew/opt/openjdk@17"
    "/opt/homebrew/opt/openjdk"
  )
  for c in "${candidates[@]}"; do
    if [ -x "$c/bin/java" ]; then
      echo "$c"
      return
    fi
  done
  if command -v java >/dev/null 2>&1; then
    local bin
    bin="$(command -v java)"
    bin="$(readlink -f "$bin" 2>/dev/null || echo "$bin")"
    echo "$(dirname "$(dirname "$bin")")"
    return
  fi
  echo ""
}

find_sdk() {
  for c in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
    if [ -n "$c" ] && [ -d "$c" ]; then
      echo "$c"
      return
    fi
  done
  echo ""
}

JDK="$(find_jdk)"
if [ -z "$JDK" ]; then
  echo "No JDK found. Install Android Studio or a JDK 17+ and set JAVA_HOME." >&2
  exit 1
fi
SDK="$(find_sdk)"
if [ -z "$SDK" ]; then
  echo "No Android SDK found. Install Android Studio or set ANDROID_HOME." >&2
  exit 1
fi

export JAVA_HOME="$JDK"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export PATH="$JDK/bin:$PATH"

echo "JDK        : $JDK"
echo "Android SDK: $SDK"
echo "Project    : $PROJECT"

printf 'sdk.dir=%s\n' "$SDK" > "$PROJECT/local.properties"

TASK=assembleRelease
VARIANT=release
if [ "$DEBUG" = 1 ]; then
  TASK=assembleDebug
  VARIANT=debug
fi

STARTED=$(date +%s)
(cd "$PROJECT" && chmod +x ./gradlew && ./gradlew --no-daemon "$TASK")
ELAPSED=$(( $(date +%s) - STARTED ))

APK="$(ls -t "$PROJECT/app/build/outputs/apk/$VARIANT"/*.apk 2>/dev/null | head -n 1 || true)"
if [ -z "$APK" ]; then
  echo "APK not found under app/build/outputs/apk/$VARIANT" >&2
  exit 1
fi
echo ""
echo "APK: $APK"
echo "Build took ${ELAPSED}s"

if [ "$INSTALL" = 1 ]; then
  ADB="$SDK/platform-tools/adb"
  if [ ! -x "$ADB" ]; then
    ADB=adb
  fi
  "$ADB" install -r "$APK"
  echo "Installed on the connected device."
fi
