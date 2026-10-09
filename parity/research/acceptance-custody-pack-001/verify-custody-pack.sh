#!/usr/bin/env bash
# Verify a custody pack against pinned live-98 DRAFT digests and MANIFEST.sha256.
set -euo pipefail

EXPECTED_DEFINITIONS='e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5'
EXPECTED_CONFIGURATIONS='9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e'

PACK_DIR="${1:-}"
if [[ -z "${PACK_DIR}" ]]; then
  echo "usage: $0 <pack-dir>" >&2
  exit 2
fi
if [[ ! -d "${PACK_DIR}" ]]; then
  echo "FAIL: pack dir missing: ${PACK_DIR}" >&2
  exit 1
fi

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "${path}" ]] || fail "missing file: ${path}"
  [[ ! -L "${path}" ]] || fail "refusing symlink: ${path}"
}

require_file "${PACK_DIR}/definitions.json"
require_file "${PACK_DIR}/configurations.json"
require_file "${PACK_DIR}/MANIFEST.sha256"

hash_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

def_hash="$(hash_file "${PACK_DIR}/definitions.json")"
cfg_hash="$(hash_file "${PACK_DIR}/configurations.json")"

[[ "${def_hash}" == "${EXPECTED_DEFINITIONS}" ]] || \
  fail "definitions digest ${def_hash} != pinned ${EXPECTED_DEFINITIONS}"
[[ "${cfg_hash}" == "${EXPECTED_CONFIGURATIONS}" ]] || \
  fail "configurations digest ${cfg_hash} != pinned ${EXPECTED_CONFIGURATIONS}"

manifest_def="$(awk '$2 == "definitions.json" {print $1; found=1} END {exit found?0:1}' \
  "${PACK_DIR}/MANIFEST.sha256")" || fail "MANIFEST missing definitions.json line"
manifest_cfg="$(awk '$2 == "configurations.json" {print $1; found=1} END {exit found?0:1}' \
  "${PACK_DIR}/MANIFEST.sha256")" || fail "MANIFEST missing configurations.json line"

[[ "${manifest_def}" == "${EXPECTED_DEFINITIONS}" ]] || \
  fail "MANIFEST definitions ${manifest_def} != pinned ${EXPECTED_DEFINITIONS}"
[[ "${manifest_cfg}" == "${EXPECTED_CONFIGURATIONS}" ]] || \
  fail "MANIFEST configurations ${manifest_cfg} != pinned ${EXPECTED_CONFIGURATIONS}"

# When live oracle paths exist, require byte identity with the pack copies.
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LIVE_DEF="${REPO_ROOT}/parity/acceptance/setup-pstack/definitions.json"
LIVE_CFG="${REPO_ROOT}/parity/acceptance/setup-pstack/configurations.json"
if [[ -f "${LIVE_DEF}" && -f "${LIVE_CFG}" ]]; then
  cmp -s "${PACK_DIR}/definitions.json" "${LIVE_DEF}" || \
    fail "pack definitions.json not byte-identical to live path"
  cmp -s "${PACK_DIR}/configurations.json" "${LIVE_CFG}" || \
    fail "pack configurations.json not byte-identical to live path"
  live_def_hash="$(hash_file "${LIVE_DEF}")"
  live_cfg_hash="$(hash_file "${LIVE_CFG}")"
  [[ "${live_def_hash}" == "${EXPECTED_DEFINITIONS}" ]] || \
    fail "live definitions digest drifted to ${live_def_hash}"
  [[ "${live_cfg_hash}" == "${EXPECTED_CONFIGURATIONS}" ]] || \
    fail "live configurations digest drifted to ${live_cfg_hash}"
fi

echo "PASS: custody pack digests match pinned live-98 DRAFT oracles"
echo "definitions=${def_hash}"
echo "configurations=${cfg_hash}"
exit 0
