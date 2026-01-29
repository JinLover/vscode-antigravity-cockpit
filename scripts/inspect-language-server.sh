#!/usr/bin/env bash
set -euo pipefail

BIN_PATH_DEFAULT="/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm"
BIN_PATH="${1:-$BIN_PATH_DEFAULT}"

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Binary not found: $BIN_PATH" >&2
  echo "Usage: $0 /path/to/language_server" >&2
  exit 1
fi

if ! command -v strings >/dev/null 2>&1; then
  echo "Missing 'strings' command. Install binutils or Xcode tools." >&2
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  GREP="rg"
  GREP_OPTS=("-n")
else
  GREP="grep"
  GREP_OPTS=("-n")
fi

TMP_OUT=$(mktemp)
trap 'rm -f "$TMP_OUT"' EXIT

strings "$BIN_PATH" > "$TMP_OUT"

echo "== Detected RPC paths (GetUserStatus / GetUnleashData) =="
$GREP "GetUserStatus|GetUnleashData" "${GREP_OPTS[@]}" "$TMP_OUT" | \
  $GREP "exa\.|language_server_pb|seat_management_pb" "${GREP_OPTS[@]}" || true

echo

echo "== Candidate services =="
$GREP "Service" "${GREP_OPTS[@]}" "$TMP_OUT" | \
  $GREP "LanguageServerService|SeatManagementService|ApiServerService|ExtensionServerService" "${GREP_OPTS[@]}" | \
  sed 's/.*\(LanguageServerService\|SeatManagementService\|ApiServerService\|ExtensionServerService\).*/\1/' | \
  sort -u || true

echo

echo "== Raw endpoint lines (full path hints) =="
$GREP "third_party/jetski/.*\.proto" "${GREP_OPTS[@]}" "$TMP_OUT" | head -n 40 || true

