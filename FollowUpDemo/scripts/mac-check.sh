#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build-evidence
{
  date -u '+%Y-%m-%dT%H:%M:%SZ'
  sw_vers
  xcode-select -p
  xcodebuild -version
  xcrun swift --version
  xcrun simctl list devices available
} | tee build-evidence/mac-tools.txt
python3 - <<'PY'
import re, subprocess
x=subprocess.check_output(['xcodebuild','-version'],text=True)
m=re.search(r'Xcode (\d+)\.(\d+)',x)
assert m and tuple(map(int,m.groups())) >= (26,4), 'Meta sample requires Xcode 26.4+'
s=subprocess.check_output(['xcrun','swift','--version'],text=True)
m=re.search(r'Swift version (\d+)\.(\d+)',s)
assert m and tuple(map(int,m.groups())) >= (6,3), 'Meta sample requires Swift 6.3+'
PY
xcodebuild -list -project ios/DisplayAccess.xcodeproj | tee build-evidence/xcode-targets.txt
xcodebuild -resolvePackageDependencies -project ios/DisplayAccess.xcodeproj -scheme DisplayAccess | tee build-evidence/package-resolution.txt
xcodebuild -project ios/DisplayAccess.xcodeproj -scheme DisplayAccess \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build-evidence/DerivedData \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY="-" clean build | tee build-evidence/simulator-build.txt
# Pick a simulator UUID printed by simctl. Avoid assuming an installed iPhone name.
if [[ -n "${SIMULATOR_ID:-}" ]]; then
  xcodebuild -project ios/DisplayAccess.xcodeproj -scheme DisplayAccess \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
    -derivedDataPath build-evidence/DerivedData \
    -resultBundlePath "build-evidence/native-tests-$(date -u +%Y%m%dT%H%M%SZ).xcresult" \
    CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY="-" test | tee build-evidence/native-tests.txt
else
  printf '%s\n' 'Simulator build done. Set SIMULATOR_ID to an available UUID and rerun to execute tests.'
fi
