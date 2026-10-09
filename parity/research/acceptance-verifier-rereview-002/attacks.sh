#!/usr/bin/env bash
# Independent containment attacks on disposable copies. Expects every attack refused, outside canaries unchanged.
set -uo pipefail
O=${OWNER:-/private/tmp/pi-pstack-parity-acceptance-owner}/parity/acceptance
REF=${REFERENCE:-/Users/josh-desktop/src/experiments/plugins}
PAR=${PARITY:-/Users/josh-desktop/src/personal/pi-pstack-parity-again/parity}
T=$O/tools/verify-acceptance.mjs
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
d() { shasum -a 256 "$1" | cut -d' ' -f1; }
tree() { (cd "$1" && find . -type f -exec shasum -a 256 {} + | sort | shasum -a 256 | cut -d' ' -f1); }
run() { # name root [extra args]; prints row
  local name=$1 root=$2; shift 2
  out=$(node "$T" --reference-root "$REF" --parity-root "$PAR" --acceptance-root "$root" "$@" 2>&1); code=$?
  printf 'ROW %s | exit=%s | %s\n' "$name" "$code" "$(printf '%s' "$out" | head -c 220 | tr '\n' ' ')"
}
fresh() { cp -R "$O" "$W/$1"; }

# A symlinked setup-pstack parent (write)
fresh A; mv $W/A/setup-pstack $W/A-out; ln -s $W/A-out $W/A/setup-pstack; b=$(tree $W/A-out)
run A-symlinked-parent-write $W/A --write-hashes; echo "   canary_unchanged=$([ "$b" = "$(tree $W/A-out)" ] && echo yes || echo NO)"
# A2 same, verify-only (no write)
run A2-symlinked-parent-verify $W/A
# B hardlinked MANIFEST
fresh B; printf 'C\n' > $W/B-c; rm $W/B/MANIFEST.sha256; ln $W/B-c $W/B/MANIFEST.sha256; b=$(d $W/B-c)
run B-hardlink-manifest $W/B --write-hashes; echo "   canary_unchanged=$([ "$b" = "$(d $W/B-c)" ] && echo yes || echo NO)"
# B2 hardlinked record-hashes
fresh B2; printf 'C\n' > $W/B2-c; rm $W/B2/setup-pstack/record-hashes.json; ln $W/B2-c $W/B2/setup-pstack/record-hashes.json; b=$(d $W/B2-c)
run B2-hardlink-record-hashes $W/B2 --write-hashes; echo "   canary_unchanged=$([ "$b" = "$(d $W/B2-c)" ] && echo yes || echo NO)"
# C final symlink MANIFEST
fresh C; printf 'C\n' > $W/C-c; rm $W/C/MANIFEST.sha256; ln -s $W/C-c $W/C/MANIFEST.sha256; b=$(d $W/C-c)
run C-final-symlink-manifest $W/C --write-hashes; echo "   canary_unchanged=$([ "$b" = "$(d $W/C-c)" ] && echo yes || echo NO)"
# C2 final symlink record-hashes
fresh C2; printf 'C\n' > $W/C2-c; rm $W/C2/setup-pstack/record-hashes.json; ln -s $W/C2-c $W/C2/setup-pstack/record-hashes.json; b=$(d $W/C2-c)
run C2-final-symlink-record-hashes $W/C2 --write-hashes; echo "   canary_unchanged=$([ "$b" = "$(d $W/C2-c)" ] && echo yes || echo NO)"
# C3 dangling final symlink manifest (target absent outside)
fresh C3; rm $W/C3/MANIFEST.sha256; ln -s $W/C3-absent $W/C3/MANIFEST.sha256
run C3-dangling-symlink-manifest $W/C3 --write-hashes; echo "   outside_file_created=$([ -e $W/C3-absent ] && echo YES || echo no)"
# D directory symlink traversal inside tree (review -> outside dir)
fresh D; mkdir $W/D-out; printf 'x\n' > $W/D-out/f; mv $W/D/review $W/D-review-moved; ln -s $W/D-out $W/D/review; b=$(tree $W/D-out)
run D-dir-symlink-traversal-write $W/D --write-hashes; echo "   canary_unchanged=$([ "$b" = "$(tree $W/D-out)" ] && echo yes || echo NO) manifest_unchanged=$([ "$(d $W/D/MANIFEST.sha256)" = "$(d $O/MANIFEST.sha256)" ] && echo yes || echo NO)"
run D2-dir-symlink-traversal-verify $W/D
# E symlinked acceptance-root itself
fresh E; ln -s $W/E $W/E-link
run E-symlinked-root-verify $W/E-link --expect-manifest-sha256 $(d $O/MANIFEST.sha256)
# F control: clean pinned verify
run F-clean-pinned $O --expect-manifest-sha256 $(d $O/MANIFEST.sha256)
# G control: owner tree untouched
echo "owner_tree_digest_after=$(tree $O)"
