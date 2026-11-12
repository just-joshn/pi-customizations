#!/bin/sh
# Merge a unit branch into the integration branch. Derived files are regenerated, decision logs are unioned,
# and any other conflict stops the merge before a commit can carry conflict markers.
set -eu
branch=$1
message=$2
cd "$(git rev-parse --show-toplevel)"
git merge -q --no-ff "$branch" -m "$message" || true
for f in $(git diff --name-only --diff-filter=U); do
  case $f in
    */dist/*|*manifest.json|*parity-status.md|*CHECKS.md) git checkout --theirs "$f" ;;
    *decisions.tsv) python3 -c "import re,sys;p=sys.argv[1];s=open(p).read();open(p,'w').write(re.sub(r'^(<<<<<<< .*|=======|>>>>>>> .*)\n','',s,flags=re.M))" "$f" ;;
    *) echo "unresolved conflict: $f (resolve by hand, then rerun from the regenerate step)"; exit 1 ;;
  esac
  git add "$f"
done
(cd extensions/pi-pstack && node scripts/compile-skills.mjs >/dev/null && bun scripts/build-helpers.mjs >/dev/null)
if git grep -n -E '^(<<<<<<<|>>>>>>>) ' -- extensions/pi-pstack parity >/dev/null; then echo "conflict markers remain"; exit 1; fi
git add -A extensions/pi-pstack parity
git diff --cached --quiet || git commit -qm "$message"
git log -1 --oneline
