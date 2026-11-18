#!/usr/bin/env bash
# Adds Material Symbols (Rounded) icons to the app as vector drawables:
#
#   scripts/material-symbol.sh inbox qr_code_2        # outlined
#   FILL=1 scripts/material-symbol.sh check_circle     # filled, as ic_check_circle_filled
#   MIRROR=1 scripts/material-symbol.sh arrow_forward  # flipped in right-to-left languages
#
# Each icon is written to app/src/main/res/drawable/ic_<name>.xml from
# Google's published Material Symbols SVGs, so the app needs no icon library.
set -euo pipefail
cd "$(dirname "$0")/.."
style="default"
suffix=""
mirror="false"
[ "${MIRROR:-0}" = "1" ] && mirror="true"
if [ "${FILL:-0}" = "1" ]; then
  style="fill1"
  suffix="_filled"
fi
for name in "$@"; do
  svg="$(curl -fsSL "https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsrounded/${name}/${style}/24px.svg")"
  path="$(printf '%s' "$svg" | sed -E 's/.*<path d="([^"]+)".*/\1/')"
  cat > "app/src/main/res/drawable/ic_${name}${suffix}.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<!-- Material Symbols Rounded: ${name} (Apache License 2.0) -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:autoMirrored="${mirror}"
    android:viewportWidth="960"
    android:viewportHeight="960">
    <group android:translateY="960">
        <path
            android:fillColor="@android:color/white"
            android:pathData="${path}" />
    </group>
</vector>
XML
  echo "ic_${name}${suffix}"
done
