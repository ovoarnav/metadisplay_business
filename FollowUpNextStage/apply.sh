#!/bin/bash
set -euo pipefail
patch_root="$(cd "$(dirname "$0")" && pwd -P)"
if [[ $# -ne 1 ]]; then
  printf '%s\n' 'Usage: bash apply.sh /absolute/path/to/existing/FollowUpDemo' >&2
  exit 2
fi
target_root="$(cd "$1" && pwd -P)"
if [[ ! -f "$target_root/ios/DisplayAccess.xcodeproj/project.pbxproj" ]]; then
  printf '%s\n' 'Choose the existing FollowUpDemo folder containing ios/DisplayAccess.xcodeproj. Nothing was changed.' >&2
  exit 2
fi
# Validate all input hashes and destination paths before changing the target.
python3 - "$patch_root" "$target_root" <<'PY'
from pathlib import Path
import hashlib,json,sys
patch=Path(sys.argv[1]);target=Path(sys.argv[2]);hashes=json.loads((patch/'FILE_MANIFEST.json').read_text())
for relative,digest in hashes.items():
    src=patch/relative
    if src.is_symlink() or not src.is_file() or hashlib.sha256(src.read_bytes()).hexdigest()!=digest:
        raise SystemExit('Patch integrity check failed: '+relative)
files=(patch/'files.txt').read_text().splitlines()
if not files or len(set(files))!=len(files): raise SystemExit('Invalid patch file list')
for relative in files:
    p=Path(relative)
    if p.is_absolute() or '..' in p.parts or not str(p).startswith(('backend/','ios/FollowUp/','ios/FollowUpTests/','scripts/','docs/','evidence/','README.md','STATUS.md','TEST_RESULTS.md')):
        raise SystemExit('Invalid patch destination: '+relative)
    if 'payload/'+relative not in hashes: raise SystemExit('Missing patch hash: '+relative)
    dest=target/p
    for component in [dest,*dest.parents]:
        if component==target: break
        if component.is_symlink(): raise SystemExit('Remove destination symlink before applying: '+str(component))
    if dest.exists() and not dest.is_file(): raise SystemExit('Destination is not a file: '+relative)
    if relative.startswith('ios/') and not dest.is_file(): raise SystemExit('Existing native file missing: '+relative)
if (target/'build-evidence').is_symlink(): raise SystemExit('build-evidence must not be a symlink')
PY
mkdir -p "$target_root/build-evidence"
backup_root="$(mktemp -d "$target_root/build-evidence/next-stage-backup.XXXXXX")"
while IFS= read -r relative; do
  if [[ -f "$target_root/$relative" ]]; then
    mkdir -p "$backup_root/$(dirname "$relative")"
    cp -p "$target_root/$relative" "$backup_root/$relative"
  else
    printf '%s\n' "$relative" >> "$backup_root/new-files.txt"
  fi
done < "$patch_root/files.txt"
while IFS= read -r relative; do
  mkdir -p "$target_root/$(dirname "$relative")"
  cp -p "$patch_root/payload/$relative" "$target_root/$relative"
done < "$patch_root/files.txt"
printf 'Follow-up AI/send update applied. Original affected files saved in:\n%s\n' "$backup_root"
printf '%s\n' 'Open the existing Xcode project, select DisplayAccess and your physical iPhone, then Run.'
printf '%s\n' 'Next: configure the hosted URL/device token and complete private Gmail consent as described in README.md.'
