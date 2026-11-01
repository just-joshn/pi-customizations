#!/usr/bin/env bash
# Install a per-workspace user unit so pstack-routines-supervisor survives reboot.
# Idempotent: re-run overwrites the same unit path and reloads it.
set -euo pipefail

usage() {
  echo "Usage: $0 --workspace <abs-path> [--bin <abs-path>]" >&2
  exit 2
}

workspace=""
bin=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      [[ $# -ge 2 ]] || usage
      workspace=$2
      shift 2
      ;;
    --bin)
      [[ $# -ge 2 ]] || usage
      bin=$2
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$workspace" ]] || usage
[[ "$workspace" = /* ]] || {
  echo "error: --workspace must be an absolute path" >&2
  exit 2
}
[[ -d "$workspace" ]] || {
  echo "error: workspace is not a directory: $workspace" >&2
  exit 1
}

here=$(cd "$(dirname "$0")" && pwd)
if [[ -z "$bin" ]]; then
  bin=$(cd "$here/../bin" && pwd)/pstack-routines-supervisor
fi
[[ "$bin" = /* ]] || {
  echo "error: --bin must be an absolute path" >&2
  exit 2
}
[[ -x "$bin" ]] || {
  echo "error: supervisor bin missing or not executable: $bin" >&2
  exit 1
}

# Short content hash so labels stay stable across re-runs for the same path.
safe_hash=$(printf '%s' "$workspace" | shasum -a 256 | cut -c1-12)
os=$(uname -s)

install_darwin() {
  local label="com.pstack.routines-supervisor.${safe_hash}"
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist="$plist_dir/${label}.plist"
  local uid domain
  uid=$(id -u)
  domain="gui/${uid}"

  mkdir -p "$plist_dir"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>--workspace</string>
    <string>${workspace}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workspace}</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/pstack-routines-supervisor-${safe_hash}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/pstack-routines-supervisor-${safe_hash}.err</string>
</dict>
</plist>
EOF

  launchctl bootout "${domain}/${label}" 2>/dev/null || true
  if launchctl bootstrap "$domain" "$plist" 2>/dev/null; then
    launchctl enable "${domain}/${label}" 2>/dev/null || true
    launchctl kickstart -k "${domain}/${label}" 2>/dev/null || true
  else
    # Older launchctl: load -w is enough for KeepAlive + RunAtLoad.
    launchctl unload -w "$plist" 2>/dev/null || true
    launchctl load -w "$plist"
  fi

  echo "Installed launchd agent: $plist"
  echo "  label: $label"
  echo "  bin: $bin"
  echo "  workspace: $workspace"
  echo "Uninstall:"
  echo "  launchctl bootout ${domain}/${label} 2>/dev/null || launchctl unload -w \"$plist\""
  echo "  rm -f \"$plist\""
}

install_linux() {
  local unit_name="pstack-routines-supervisor-${safe_hash}.service"
  local unit_dir="$HOME/.config/systemd/user"
  local unit="$unit_dir/$unit_name"

  mkdir -p "$unit_dir"
  cat >"$unit" <<EOF
[Unit]
Description=pstack durable routines supervisor (${safe_hash})
After=default.target

[Service]
Type=simple
WorkingDirectory=${workspace}
ExecStart=${bin} --workspace ${workspace}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "$unit_name"

  echo "Installed systemd user unit: $unit"
  echo "  unit: $unit_name"
  echo "  bin: $bin"
  echo "  workspace: $workspace"
  echo "If no login session is open after reboot, enable linger so the user unit still starts:"
  echo "  loginctl enable-linger \"$(id -un)\""
  echo "Uninstall:"
  echo "  systemctl --user disable --now $unit_name"
  echo "  rm -f \"$unit\""
  echo "  systemctl --user daemon-reload"
}

case "$os" in
  Darwin)
    install_darwin
    ;;
  Linux)
    install_linux
    ;;
  *)
    echo "error: unsupported OS: $os (need Darwin or Linux)" >&2
    exit 1
    ;;
esac
