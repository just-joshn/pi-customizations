#!/usr/bin/env bash
# Drives a real Pi with this package through pi_spawn, worktrees, readonly, and nesting, and checks only host state.
# Usage: PI_CODING_AGENT_DIR=<agent dir with credentials> test/e2e/real-pi.sh [scratch dir]
# The agent directory gets this package installed if it is missing. Each scenario costs a few model calls.
set -uo pipefail

package=$(cd "$(dirname "$0")/../.." && pwd -P)
scratch=${1:-$(mktemp -d "${HOME}/.pstack-e2e.XXXX")}
failures=0
check() {
  if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

pi list 2>/dev/null | grep -q "$package" || pi install "$package" >/dev/null

repo="$scratch/repo"
rm -rf "$repo" && mkdir -p "$repo" && cd "$repo" || exit 1
git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init

timeout 900 pi -p --no-session "Call pi_spawn twice in one message. First: name ro, readonly true, brief: Run bash: touch $repo/ro.txt. Then reply DONE. Second: name wt, worktree feature-x, brief: Run bash: echo hi > hello.txt && git add hello.txt && git -c user.name=t -c user.email=t@t commit -q -m hello; touch $repo/outside.txt; echo hook > \$(git rev-parse --git-common-dir)/hooks/pre-commit. Then reply DONE. After both calls end your turn, and when both reports arrive reply FINISHED." </dev/null >"$scratch/parallel.log" 2>&1
check "readonly worker cannot write the project" "[ ! -e '$repo/ro.txt' ]"
check "worktree worker commits on its branch" "[ -n \"\$(git -C '$repo' log --oneline --grep=hello feature-x)\" ]"
check "worktree worker cannot write outside its worktree" "[ ! -e '$repo/outside.txt' ]"
check "worktree worker cannot plant a git hook" "[ ! -e '$repo/.git/hooks/pre-commit' ]"

timeout 900 pi -p --no-session "Call pi_spawn once with name child and this brief: Call pi_spawn once with name grandchild, readonly true, and brief: Run bash: touch $repo/grandchild.txt; echo x > \${PI_CODING_AGENT_DIR:-\$HOME/.pi/agent}/settings.json. Then reply DONE. Then end your turn, and when the grandchild report arrives reply CHILD-DONE. --- After calling pi_spawn, end your turn, and when the child report arrives reply FINISHED." </dev/null >"$scratch/nested.log" 2>&1
agent=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
check "nested readonly grandchild cannot write the project" "[ ! -e '$repo/grandchild.txt' ]"
check "nested grandchild cannot change Pi settings" "! grep -qx x '$agent/settings.json'"
# The child's own exit plus the grandchild's: under nested/ on Linux, under the root-owned brokered/ on macOS.
check "nested grandchild actually ran" "[ \$(find '$agent'/pstack-v2/jobs/child-* -name exit 2>/dev/null | wc -l) -ge 2 ]"

echo "logs in $scratch"
exit "$failures"
