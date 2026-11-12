// src/worker-host.ts
import { execFileSync as execFileSync2, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync as closeSync2, constants as constants2, existsSync as existsSync2, fstatSync as fstatSync2, lstatSync as lstatSync2, mkdirSync, openSync as openSync2, readFileSync as readFileSync2, symlinkSync, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { createServer } from "node:net";
import { dirname as dirname2, isAbsolute as isAbsolute3, join as join3, resolve as resolve3 } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// src/container.ts
import { execFile } from "node:child_process";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";

// src/redact.ts
var redactUserinfo = (text) => text.replace(/(\/\/)[^\s/@]+@/g, "$1***@");
var SECRET_NAME = /TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|(^|_)AUTH($|_)/i;
var MIN_SECRET_LENGTH = 6;
function collectStrings(value, into) {
  if (typeof value === "string") {
    if (value.length >= MIN_SECRET_LENGTH)
      into.add(value);
  } else if (Array.isArray(value))
    for (const part of value)
      collectStrings(part, into);
  else if (typeof value === "object" && value !== null)
    for (const part of Object.values(value))
      collectStrings(part, into);
}
function secretValues(env, credentialNames) {
  const names = new Set(credentialNames);
  const found = new Set;
  for (const [name, value] of Object.entries(env)) {
    if (!names.has(name) && !SECRET_NAME.test(name))
      continue;
    if (value.length >= MIN_SECRET_LENGTH)
      found.add(value);
    try {
      collectStrings(JSON.parse(value), found);
    } catch {}
  }
  return [...found].sort((a, b) => b.length - a.length);
}
var scrubber = (secrets) => (text) => secrets.reduce((clean, secret) => clean.split(secret).join("***"), redactUserinfo(text));

// src/container.ts
var CONTAINER_LABEL = "pstack.worker";
var ENVIRONMENT_FILE = join(".pi", "environment.json");
var ENGINE_ENV = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_API_VERSION"];
var CONTAINER_HOME = "/tmp/pstack-home";
var CONTAINER_WORKSPACE = "/tmp/workspace";
var READY_RECORD = "pstack_container_ready";
var hostOnlyEnv = (name) => ["PATH", "HOME", "TMPDIR", "PWD", "OLDPWD", "SHELL", "USER", "LOGNAME", "HOSTNAME", "TMUX", "TMUX_PANE", "PI_CODING_AGENT_DIR"].includes(name) || /^(DOCKER|XDG|SSH)_/.test(name);
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var MOUNT_PATH = /^\/[^\0\n,]*$/;
function parseContainerPlan(raw) {
  if (!isRecord(raw))
    throw new Error("Launch container must be an object");
  const { docker, name, runId, image, user, mounts } = raw;
  if (typeof docker !== "string" || !isAbsolute(docker))
    throw new Error("Launch container.docker must be an absolute path");
  if (typeof name !== "string" || !/^pstack_[a-z0-9-]+_[a-z0-9-]+_[0-9a-f]{8}$/.test(name))
    throw new Error("Launch container.name is invalid");
  if (typeof runId !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(runId))
    throw new Error("Launch container.runId is invalid");
  if (typeof image !== "string" || !/^sha256:[0-9a-f]{64}$/.test(image))
    throw new Error("Launch container.image must be an image id");
  if (user !== null && !(typeof user === "string" && /^\d+:\d+$/.test(user)))
    throw new Error("Launch container.user must be uid:gid or null");
  if (!Array.isArray(mounts) || !mounts.every((mount) => isRecord(mount) && typeof mount["src"] === "string" && MOUNT_PATH.test(mount["src"]) && typeof mount["dst"] === "string" && MOUNT_PATH.test(mount["dst"]) && typeof mount["readonly"] === "boolean"))
    throw new Error("Launch container.mounts must be { src, dst, readonly } with absolute paths");
  return { docker, name, runId, image, user, mounts };
}
function dockerCli(docker, args, env, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = execFile(docker, [...args], { env, timeout: timeoutMs, encoding: "utf8", maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      if (error === null)
        resolveRun(stdout);
      else
        reject(new Error(redactUserinfo(`docker ${args[0] ?? ""} failed: ${stderr.trim() || error.message}`)));
    });
    child.stdin?.end();
  });
}
function clientEnv(source) {
  const names = ["PATH", "HOME", ...ENGINE_ENV];
  return Object.fromEntries(names.flatMap((name) => typeof source[name] === "string" ? [[name, source[name]]] : []));
}
var ENTRYPOINT = `fail() { echo "pstack: $*" >&2; exit 1; }
for tool in node git base64; do command -v "$tool" >/dev/null 2>&1 || fail "the image has no $tool; a container worker's image needs node, git, and base64"; done
while IFS= read -r line; do
  [ -n "$line" ] || break
  name=\${line%%=*}
  value=$(printf %s "\${line#*=}" | base64 -d; printf x)
  export "$name=\${value%x}"
done
[ -n "\${PSTACK_CONTAINER_CLONE_URL:-}" ] || fail "the launch environment did not arrive on stdin"
WS=${CONTAINER_WORKSPACE}
{
  mkdir -p "$HOME" "$PI_CODING_AGENT_DIR" "$WS" || fail "cannot create the workspace"
  git config --global --add safe.directory '*'
  [ -z "\${PSTACK_CONTAINER_GIT_NAME:-}" ] || git config --global user.name "$PSTACK_CONTAINER_GIT_NAME"
  [ -z "\${PSTACK_CONTAINER_GIT_EMAIL:-}" ] || git config --global user.email "$PSTACK_CONTAINER_GIT_EMAIL"
  if [ -n "\${GH_TOKEN:-\${GITHUB_TOKEN:-}}" ]; then
    git config --global credential.https://github.com.helper '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=\${GH_TOKEN:-$GITHUB_TOKEN}"; }; f'
  fi
  git clone --quiet --no-checkout "$PSTACK_CONTAINER_CLONE_URL" "$WS" || fail "could not clone the remote"
  git -C "$WS" rev-parse --verify --quiet "$PSTACK_CONTAINER_COMMIT^{commit}" >/dev/null || fail "commit $PSTACK_CONTAINER_COMMIT is not on the remote"
  git -C "$WS" checkout --quiet -b "$PSTACK_CONTAINER_BRANCH" "$PSTACK_CONTAINER_COMMIT" || fail "cannot check out $PSTACK_CONTAINER_COMMIT"
  if [ -n "\${PSTACK_CONTAINER_INSTALL:-}" ]; then (cd "$WS" && sh -c "$PSTACK_CONTAINER_INSTALL") || fail "the environment's install command failed"; fi
} >&2
unset PSTACK_CONTAINER_CLONE_URL PSTACK_CONTAINER_COMMIT PSTACK_CONTAINER_BRANCH PSTACK_CONTAINER_INSTALL PSTACK_CONTAINER_GIT_NAME PSTACK_CONTAINER_GIT_EMAIL
printf '{"type":"%s"}\\n' ${READY_RECORD}
cd "$WS"
exec "$@"
`;
var outDirOf = (workerDir) => join(workerDir, "out");
function containerRunArgs(plan, workerDir, command) {
  const mount = ({ src, dst, readonly }) => ["--mount", `type=bind,src=${src},dst=${dst}${readonly ? ",readonly" : ""}`];
  return [
    "run",
    "--rm",
    "-i",
    "--init",
    "--name",
    plan.name,
    "--label",
    `${CONTAINER_LABEL}=${plan.name}`,
    "--label",
    `pstack.run=${plan.runId}`,
    ...plan.user === null ? [] : ["--user", plan.user],
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...plan.mounts.flatMap(mount),
    ...mount({ src: outDirOf(workerDir), dst: workerDir, readonly: false }),
    "--entrypoint",
    "/bin/sh",
    plan.image,
    "-c",
    ENTRYPOINT,
    "pstack-container",
    ...command
  ];
}
function containerPreamble(env) {
  return `${Object.entries(env).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new Error(`Invalid environment variable name ${JSON.stringify(name)}`);
    return `${name}=${Buffer.from(value).toString("base64")}
`;
  }).join("")}
`;
}
async function removeWorkerContainers(docker, env, name) {
  const listed = await dockerCli(docker, ["ps", "--all", "--quiet", "--no-trunc", "--filter", `label=${CONTAINER_LABEL}=${name}`], env, 30000);
  const ids = listed.split(`
`).filter(Boolean);
  for (const id of ids)
    await dockerCli(docker, ["rm", "--force", id], env, 60000).catch((error) => {
      if (!/No such container|already in progress/i.test(error instanceof Error ? error.message : String(error)))
        throw error;
    });
  return ids;
}

// src/run-files.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute as isAbsolute2, join as join2, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";
var ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
function parseId(value, what) {
  if (typeof value !== "string" || !ID.test(value))
    throw new Error(`Invalid ${what}: must match ${ID.source}`);
  return value;
}
var parseRunId = (value) => parseId(value, "runId");
var parseWorkerId = (value) => parseId(value, "workerId");
var TMUX_SESSION = /^pstack_[a-z0-9-]+_[a-z0-9-]+_[0-9a-f]{8}$/;
var runsDir = (project) => join2(project, ".pi", "pstack", "runs");
var runRootOf = (project, runId) => join2(runsDir(project), runId);
var projectOfRunRoot = (runRoot) => resolve2(runRoot, "..", "..", "..", "..");
var workerDirOf = (runRoot, workerId) => join2(runRoot, "workers", workerId);
function controlSocketPath(runRoot, workerId) {
  const local = join2(workerDirOf(runRoot, workerId), "control.sock");
  if (Buffer.byteLength(local) <= 100)
    return local;
  const uid = process.getuid?.() ?? 0;
  return join2("/tmp", `pstack-${uid}`, `${createHash("sha256").update(runRoot).digest("hex").slice(0, 16)}-${workerId}.sock`);
}
function writeJsonAtomic(path, value, mode = 384) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}
`, { mode });
  renameSync(temporary, path);
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
var MAX_EVENT_DATA = 4096;
function appendEvent(runRoot, event) {
  let data = JSON.stringify(event.data ?? null);
  if (data.length > MAX_EVENT_DATA)
    data = JSON.stringify(`${data.slice(0, MAX_EVENT_DATA)}…`);
  const line = `{"ts":${JSON.stringify(new Date().toISOString())},"runId":${JSON.stringify(event.runId)}${event.workerId === undefined ? "" : `,"workerId":${JSON.stringify(event.workerId)}`},"kind":${JSON.stringify(event.kind)},"data":${data}}
`;
  appendFileSync(join2(runRoot, "events.jsonl"), line, { mode: 384 });
}
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function readRun(runRoot) {
  const raw = readJson(join2(runRoot, "run.json"));
  if (!isRecord2(raw) || raw["schemaVersion"] !== 1)
    throw new Error(`${runRoot}/run.json: unsupported schema`);
  const runId = parseRunId(raw["runId"]);
  if (runId !== basename(runRoot))
    throw new Error(`${runRoot}/run.json: runId ${runId} does not name its directory`);
  const parent = raw["parentSessionFile"];
  if (parent !== null && typeof parent !== "string")
    throw new Error(`${runRoot}/run.json: parentSessionFile must be a string or null`);
  return raw;
}
var WORKER_ROLES = ["poteto", "explorer", "investigator", "candidate", "judge", "verifier", "reviewer", "owner", "watcher", "comment-sicko", "general"];
var THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
var ENGINEERING_CAPABILITIES = { mcp: "inherit", env: "inherit", externalWrite: false };
var AUTOMATION_CAPABILITIES = { mcp: "none", env: "minimal", externalWrite: false };
function parseCapabilities(raw) {
  if (!isRecord2(raw) || !["env,externalWrite,mcp", "env,externalWrite,mcp,spawn"].includes(Object.keys(raw).sort().join(",")) || !["inherit", "none"].includes(raw["mcp"]) || !["inherit", "minimal"].includes(raw["env"]) || typeof raw["externalWrite"] !== "boolean" || raw["spawn"] !== undefined && typeof raw["spawn"] !== "boolean")
    throw new Error("Assignment capabilities must be { mcp: 'inherit' | 'none', env: 'inherit' | 'minimal', externalWrite: boolean, spawn?: boolean }");
  return { mcp: raw["mcp"], env: raw["env"], externalWrite: raw["externalWrite"], ...typeof raw["spawn"] === "boolean" ? { spawn: raw["spawn"] } : {} };
}
var BRIEF = "brief.md";
var MODEL_SPEC = /^(inherit-parent|[^/\s:]+\/[^\s]+)$/;
var COMMIT = /^[0-9a-f]{7,64}$/;
function parseAssignment(raw, defaults) {
  if (!isRecord2(raw))
    throw new Error("Assignment must be a JSON object");
  const allowed = ["schemaVersion", "runId", "workerId", "kind", "role", "brief", "model", "thinkingLevel", "workspace", "skills", "watch", "capabilities"];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new Error(`Assignment has unknown fields: ${unknown.join(", ")}`);
  if ((raw["schemaVersion"] ?? 1) !== 1)
    throw new Error("Assignment schemaVersion must be 1");
  const runId = parseRunId(raw["runId"]);
  const workerId = parseWorkerId(raw["workerId"]);
  const kind = raw["kind"] ?? "pi";
  if (kind !== "pi" && kind !== "watch")
    throw new Error("Assignment kind must be 'pi' or 'watch'");
  const role = raw["role"];
  if (typeof role !== "string" || !WORKER_ROLES.includes(role))
    throw new Error(`Assignment role must be one of ${WORKER_ROLES.join(", ")}`);
  const model = raw["model"];
  if (typeof model !== "string" || !MODEL_SPEC.test(model))
    throw new Error("Assignment model must be 'inherit-parent' or '<provider>/<id>'");
  const thinkingLevel = raw["thinkingLevel"] ?? null;
  if (thinkingLevel !== null && !(typeof thinkingLevel === "string" && THINKING_LEVELS.includes(thinkingLevel)))
    throw new Error(`Assignment thinkingLevel must be null or one of ${THINKING_LEVELS.join(", ")}`);
  const workspace = raw["workspace"];
  if (!isRecord2(workspace))
    throw new Error("Assignment workspace must be an object");
  let parsedWorkspace;
  if ((workspace["mode"] === "worktree" || workspace["mode"] === "container") && Object.keys(workspace).length === 2 && typeof workspace["inputCommit"] === "string" && COMMIT.test(workspace["inputCommit"]))
    parsedWorkspace = { mode: workspace["mode"], inputCommit: workspace["inputCommit"] };
  else if (workspace["mode"] === "readonly" && Object.keys(workspace).every((key) => key === "mode" || key === "path") && (workspace["path"] === undefined || typeof workspace["path"] === "string" && isAbsolute2(workspace["path"])))
    parsedWorkspace = { mode: "readonly", path: workspace["path"] ?? defaults.projectRoot };
  else
    throw new Error("Assignment workspace must be { mode: 'worktree' | 'container', inputCommit: <sha> } or { mode: 'readonly', path: <absolute> }");
  const skills = raw["skills"] ?? [];
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== "string" || skill.length === 0))
    throw new Error("Assignment skills must be an array of skill names");
  const brief = raw["brief"];
  if (brief !== undefined && brief !== BRIEF)
    throw new Error(`Assignment brief must be '${BRIEF}'`);
  const capabilities = raw["capabilities"] === undefined ? defaults.capabilities : parseCapabilities(raw["capabilities"]);
  if (capabilities.spawn === true && parsedWorkspace.mode !== "worktree")
    throw new Error("Assignment capabilities.spawn needs a worktree workspace: a sub-coordinator writes its workers' assignments and keeps its runs in its own workspace");
  const base = { schemaVersion: 1, runId, workerId, role, model, thinkingLevel, workspace: parsedWorkspace, skills, capabilities };
  if (kind === "pi") {
    if (raw["watch"] !== undefined)
      throw new Error("Assignment watch is only for kind 'watch'");
    if (typeof brief !== "string")
      throw new Error("Assignment kind 'pi' needs a brief");
    return { ...base, kind, brief };
  }
  const watch = raw["watch"];
  if (!isRecord2(watch) || Object.keys(watch).some((key) => key !== "argv" && key !== "cwd"))
    throw new Error("Assignment kind 'watch' needs watch: { argv, cwd }");
  const argv = watch["argv"];
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== "string" || part.includes("\x00")))
    throw new Error("Assignment watch.argv must be a non-empty string array");
  const cwd = watch["cwd"] ?? defaults.projectRoot;
  if (typeof cwd !== "string" || !isAbsolute2(cwd))
    throw new Error("Assignment watch.cwd must be absolute");
  return { ...base, kind, ...typeof brief === "string" ? { brief } : {}, watch: { argv, cwd } };
}
function readBrief(workerDir) {
  const path = join2(workerDir, BRIEF);
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === "ELOOP")
      throw new Error(`${path} must be a regular file, not a symlink`);
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path)
      throw new Error(`${path} must be a regular file with a single link inside the worker directory`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
function ownedEntry(path, directory) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
    throw new Error(`${path} must be a real ${directory ? "directory" : "file"}`);
  if (process.getuid !== undefined && stat.uid !== process.getuid())
    throw new Error(`${path} is not owned by this user`);
}
function loadAssignment(path) {
  if (!isAbsolute2(path))
    throw new Error("Assignment path must be absolute");
  const file = resolve2(path);
  if (basename(file) !== "assignment.json")
    throw new Error("Assignment file must be named assignment.json");
  ownedEntry(file, false);
  if (realpathSync(file) !== file)
    throw new Error("Assignment path must be canonical (no symlinks)");
  const workerDir = dirname(file);
  ownedEntry(workerDir, true);
  const runRoot = dirname(dirname(workerDir));
  if (basename(dirname(workerDir)) !== "workers" || basename(dirname(runRoot)) !== "runs")
    throw new Error("Assignment must be at <runRoot>/workers/<workerId>/assignment.json");
  const bytes = readFileSync(file);
  const automated = readRun(runRoot).parentSessionFile === null;
  const assignment = parseAssignment(JSON.parse(bytes.toString("utf8")), { capabilities: automated ? AUTOMATION_CAPABILITIES : ENGINEERING_CAPABILITIES, projectRoot: projectOfRunRoot(runRoot) });
  if (assignment.workerId !== basename(workerDir))
    throw new Error(`Assignment workerId ${assignment.workerId} does not name its directory`);
  if (assignment.runId !== basename(runRoot))
    throw new Error(`Assignment runId ${assignment.runId} does not name its run root`);
  return { assignment, file, runRoot, workerDir, digest: createHash("sha256").update(bytes).digest("hex") };
}
var TERMINAL_PHASES = ["stopped", "failed", "exited"];
var MAX_SETTLES = 1e4;
var isTerminal = (phase) => TERMINAL_PHASES.includes(phase);
function processStartTime(pid) {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    } catch {
      return;
    }
  }
  try {
    return execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { LC_ALL: "C", TZ: "UTC" }, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim() || undefined;
  } catch {
    return;
  }
}
var launchEnvPath = (workerDir) => join2(workerDir, "claim", "launch-env.json");

// src/worker-host.ts
var MAX_CONTROL_BYTES = 65536;
var MAX_INSTRUCTION_BYTES = 32768;
var MAX_RPC_RECORD = 8 * 1024 * 1024;
var MAX_BRIEF_BYTES = 1024 * 1024;
var RPC_DEADLINE_MS = 1e4;
var ABORT_DEADLINE_MS = 60000;
var CONTAINER_START_MS = 30 * 60000;
var STDERR_HOLD = 16384;
var STDERR_OVERLAP = 512;
var MINIMAL_ENV = ["PATH", "HOME", "LANG", "TERM", "TMPDIR", "PI_CODING_AGENT_DIR"];
var HOST_OPERATIONS = ["inspect", "start", "prompt", "steer", "follow-up", "cancel", "shutdown"];
var TEXT_OPERATIONS = ["prompt", "steer", "follow-up"];
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var message = (error) => error instanceof Error ? error.message : String(error);
function parseLaunch(text) {
  if (text === undefined)
    throw new Error("Missing launch argument");
  const raw = JSON.parse(text);
  if (!isRecord3(raw))
    throw new Error("Launch must be an object");
  const strings = (value) => Array.isArray(value) && value.every((part) => typeof part === "string" && !part.includes("\x00"));
  const { piCommand, model, thinkingLevel, appendSystemPrompt, tools, tmuxSession, extraArgs, credentialEnv } = raw;
  const container = raw["container"] === null ? null : parseContainerPlan(raw["container"]);
  if (!strings(piCommand) || piCommand.length === 0 || container === null && !isAbsolute3(piCommand[0] ?? ""))
    throw new Error("Launch piCommand must start with an absolute executable");
  if (model !== null && !(isRecord3(model) && typeof model["provider"] === "string" && typeof model["id"] === "string"))
    throw new Error("Launch model must be { provider, id } or null");
  if (thinkingLevel !== null && !THINKING_LEVELS.includes(thinkingLevel))
    throw new Error("Launch thinkingLevel is invalid");
  if (appendSystemPrompt !== null && !(typeof appendSystemPrompt === "string" && isAbsolute3(appendSystemPrompt)))
    throw new Error("Launch appendSystemPrompt must be an absolute path or null");
  if (tools !== null && !(strings(tools) && tools.every((name) => /^[A-Za-z0-9_*+-]+$/.test(name))))
    throw new Error("Launch tools must be tool names or null");
  if (typeof tmuxSession !== "string" || !TMUX_SESSION.test(tmuxSession))
    throw new Error("Launch tmuxSession is invalid");
  if (!strings(extraArgs))
    throw new Error("Launch extraArgs must be strings");
  if (!strings(credentialEnv) || credentialEnv.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
    throw new Error("Launch credentialEnv must be variable names");
  return {
    piCommand,
    model,
    thinkingLevel,
    appendSystemPrompt,
    tools,
    tmuxSession,
    extraArgs,
    credentialEnv,
    container
  };
}
function launchEnvironment(mode, credentialEnv, source) {
  if (mode === "inherit")
    return Object.fromEntries(Object.entries(source).filter((entry) => entry[1] !== undefined));
  const names = new Set([...MINIMAL_ENV, ...credentialEnv, ...Object.keys(source).filter((name) => name.startsWith("PSTACK_"))]);
  return Object.fromEntries([...names].map((name) => [name, source[name] ?? null]));
}
function takeLaunchEnv(workerDir) {
  const path = launchEnvPath(workerDir);
  const fd = openSync2(path, constants2.O_RDONLY | constants2.O_NOFOLLOW);
  let raw;
  try {
    const stat = fstatSync2(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 63) !== 0 || stat.uid !== process.getuid?.())
      throw new Error(`${path} must be a private regular file owned by this user`);
    raw = JSON.parse(readFileSync2(fd, "utf8"));
  } finally {
    closeSync2(fd);
    unlinkSync(path);
  }
  if (!isRecord3(raw) || Object.entries(raw).some(([name, value]) => !/^[^=\0]+$/.test(name) || typeof value !== "string" && value !== null))
    throw new Error(`${path} must map variable names to strings or null`);
  return raw;
}
function workerEnv(loaded, launch, launchEnv) {
  const present = Object.entries(launchEnv).filter((entry) => entry[1] !== null);
  if (loaded.assignment.capabilities.env === "inherit")
    return Object.fromEntries(present);
  const allowed = new Set([...MINIMAL_ENV, ...launch.credentialEnv]);
  return Object.fromEntries(present.filter(([name]) => allowed.has(name) || name.startsWith("PSTACK_")));
}
function validateControl(value, loaded, instance) {
  if (!isRecord3(value))
    throw new Error("Control must be an object");
  const allowed = ["id", "workerId", "digest", "instance", "operation", "text"];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown control field");
  if (typeof value["id"] !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(value["id"]))
    throw new Error("Invalid command id");
  if (value["workerId"] !== loaded.assignment.workerId || value["digest"] !== loaded.digest)
    throw new Error("Assignment identity mismatch");
  const operation = value["operation"];
  if (typeof operation !== "string" || !HOST_OPERATIONS.includes(operation))
    throw new Error("Unknown operation");
  if (operation !== "inspect" && value["instance"] !== instance)
    throw new Error("Host instance mismatch");
  const text = value["text"];
  if (TEXT_OPERATIONS.includes(operation)) {
    if (typeof text !== "string" || text.length === 0 || Buffer.byteLength(text) > MAX_INSTRUCTION_BYTES)
      throw new Error(`Instruction must contain 1 to ${MAX_INSTRUCTION_BYTES} bytes`);
  } else if (text !== undefined)
    throw new Error("Unexpected instruction text");
  return value;
}
function workspaceDir(loaded) {
  const { assignment } = loaded;
  if (assignment.kind === "watch")
    return assignment.watch.cwd;
  if (assignment.workspace.mode === "readonly")
    return assignment.workspace.path;
  return assignment.workspace.mode === "worktree" ? join3(loaded.workerDir, "worktree") : loaded.workerDir;
}
function prepareOutput(workerDir) {
  const out = outDirOf(workerDir);
  for (const name of ["session", "evidence"])
    mkdirSync(join3(out, name), { recursive: true, mode: 448 });
  for (const name of ["session", "evidence", "report.md"])
    if (lstatSync2(join3(workerDir, name), { throwIfNoEntry: false }) === undefined)
      symlinkSync(join3("out", name), join3(workerDir, name));
}
function containerEnv(piEnv) {
  return { ...Object.fromEntries(Object.entries(piEnv).filter(([name]) => !hostOnlyEnv(name))), HOME: CONTAINER_HOME, PI_CODING_AGENT_DIR: `${CONTAINER_HOME}/agent` };
}
function piArgs(loaded, launch) {
  return [
    "--mode",
    "rpc",
    "--session-dir",
    join3(loaded.workerDir, "session"),
    ...launch.model === null ? [] : ["--model", `${launch.model.provider}/${launch.model.id}`],
    ...launch.thinkingLevel === null ? [] : ["--thinking", launch.thinkingLevel],
    ...launch.appendSystemPrompt === null ? [] : ["--append-system-prompt", launch.appendSystemPrompt],
    ...launch.tools === null ? [] : ["--tools", launch.tools.join(",")],
    ...loaded.assignment.capabilities.mcp === "none" ? ["--no-mcp"] : [],
    ...launch.extraArgs
  ];
}
function claim(loaded, instance) {
  const hostStarted = processStartTime(process.pid);
  if (hostStarted === undefined)
    throw new Error(`Cannot read the start time of this host process ${process.pid}`);
  const identity = { digest: loaded.digest, instance, hostPid: process.pid, hostStarted };
  writeFileSync2(join3(loaded.workerDir, "claim", "identity.json"), `${JSON.stringify(identity)}
`, { mode: 384, flag: "wx" });
}
function prepareWorktree(loaded, inputCommit) {
  const { runId, workerId } = loaded.assignment;
  const project = resolve3(loaded.runRoot, "..", "..", "..", "..");
  if (runRootOf(project, runId) !== loaded.runRoot)
    throw new Error(`${loaded.runRoot} is not <project>/.pi/pstack/runs/${runId}`);
  const path = join3(loaded.workerDir, "worktree");
  const branch = `pstack-run/${runId}/${workerId}`;
  const git = (...args) => execFileSync2("git", ["-C", project, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim();
  if (lstatSync2(path, { throwIfNoEntry: false }) !== undefined)
    throw new Error(`${path}: worktree already exists; a worker never reuses one. Spawn a fresh worker id.`);
  let commit;
  try {
    commit = git("rev-parse", "--verify", "--quiet", `${inputCommit}^{commit}`);
  } catch {
    throw new Error(`inputCommit ${inputCommit} names no commit in ${project}`);
  }
  try {
    git("worktree", "add", "--quiet", "-b", branch, path, commit);
  } catch (error) {
    throw new Error(`git worktree add ${path} on new branch ${branch} failed: ${error.stderr?.trim() || message(error)}`);
  }
}
function prepareSocket(path) {
  const directory = dirname2(path);
  if (directory.startsWith("/tmp/pstack-")) {
    mkdirSync(directory, { recursive: true, mode: 448 });
    const stat = lstatSync2(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 63) !== 0)
      throw new Error(`${directory} must be a private directory owned by this user`);
  }
  if (existsSync2(path))
    unlinkSync(path);
}
async function runHost(assignmentFile, launchText) {
  const loaded = loadAssignment(assignmentFile);
  const launch = parseLaunch(launchText);
  const { assignment, workerDir, runRoot } = loaded;
  const instance = randomUUID();
  claim(loaded, instance);
  const launchEnv = takeLaunchEnv(workerDir);
  const scrub = scrubber(secretValues(workerEnv(loaded, launch, launchEnv), launch.credentialEnv));
  const socketPath = controlSocketPath(runRoot, assignment.workerId);
  const sessionDir = join3(workerDir, "session");
  let phase = "starting";
  let reason = null;
  let exit = null;
  let model = null;
  let sessionFile = null;
  let briefSent = false;
  let generation = 0;
  let acknowledged = 0;
  const unacknowledged = new Map;
  const quiescenceChecks = new Map;
  let runs = 0;
  let recordedRuns = 0;
  let lastRun;
  let settles = [];
  let childPid = null;
  let stderrTail = "";
  let stderrPending = "";
  const showStderr = (text) => {
    const clean = scrub(text);
    stderrTail = `${stderrTail}${clean}`.slice(-8192);
    display("pi diagnostic", clean.slice(-8192).trimEnd());
  };
  let requestNumber = 0;
  let runFailure;
  let childExited = false;
  let mutationPending = false;
  let server;
  let terminal;
  let fatal;
  const waiting = new Map;
  const seen = new Set;
  const sockets = new Set;
  const observation = () => ({
    schemaVersion: 1,
    runId: assignment.runId,
    workerId: assignment.workerId,
    kind: assignment.kind,
    digest: loaded.digest,
    instance,
    hostPid: process.pid,
    childPid,
    tmuxSession: launch.tmuxSession,
    socketPath,
    phase,
    reason,
    model,
    sessionFile,
    briefSent,
    generation,
    settles,
    exit,
    updatedAt: new Date().toISOString()
  });
  const event = (kind, data) => {
    try {
      appendEvent(runRoot, { runId: assignment.runId, workerId: assignment.workerId, kind, data });
    } catch (error) {
      display("host diagnostic", `events.jsonl append failed: ${message(error)}`);
    }
  };
  const save = () => writeJsonAtomic(join3(workerDir, "state.json"), observation());
  const display = (kind, value) => process.stdout.write(scrub(`[${kind}] ${typeof value === "string" ? value : JSON.stringify(value)}
`));
  const settle = (settlePhase, why, covers = generation) => {
    recordedRuns = runs;
    const last = settles.at(-1)?.sequence ?? 0;
    settles = [...settles, { sequence: last + 1, generation: covers, phase: settlePhase, reason: why, at: new Date().toISOString() }];
    save();
    event("settle", settles.at(-1));
    display("host settled", { phase: settlePhase, reason: why });
  };
  if (assignment.kind === "pi" && assignment.workspace.mode !== "readonly") {
    try {
      if (assignment.workspace.mode === "worktree")
        prepareWorktree(loaded, assignment.workspace.inputCommit);
      else
        prepareOutput(workerDir);
    } catch (error) {
      phase = "failed";
      reason = message(error);
      display("host failure", reason);
      settle("failed", reason);
      event("failure", { reason });
      process.exitCode = 1;
      return;
    }
  }
  const readonly = assignment.kind === "pi" && assignment.workspace.mode === "readonly";
  const piEnv = { ...workerEnv(loaded, launch, launchEnv), PSTACK_WORKER: "1", PSTACK_RUN_ID: assignment.runId, PSTACK_WORKER_ID: assignment.workerId, PSTACK_RUN_ROOT: runRoot, ...readonly ? { PSTACK_READONLY: "1" } : {} };
  const { container } = launch;
  const dockerEnv = clientEnv(launchEnv);
  const piCommand = [...launch.piCommand, ...piArgs(loaded, launch)];
  const command = assignment.kind === "watch" ? assignment.watch.argv : container === null ? piCommand : [container.docker, ...containerRunArgs(container, workerDir, piCommand)];
  const child = spawn(command[0], command.slice(1), {
    cwd: workspaceDir(loaded),
    detached: true,
    env: container === null ? piEnv : dockerEnv,
    stdio: assignment.kind === "watch" ? ["ignore", "inherit", "inherit"] : ["pipe", "pipe", "pipe"]
  });
  childPid = child.pid ?? null;
  const rejectWaiting = (error) => {
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    waiting.clear();
  };
  const signalChild = (signal) => {
    if (childExited || child.pid === undefined)
      return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH")
        throw error;
    }
  };
  const removeContainer = async () => {
    if (container === null)
      return;
    try {
      event("container_removed", { name: container.name, ids: await removeWorkerContainers(container.docker, dockerEnv, container.name) });
    } catch (error) {
      display("host diagnostic", `container removal failed: ${message(error)}`);
      event("container_removal_failed", { name: container.name, error: message(error) });
    }
  };
  const closed = new Promise((resolveClosed) => {
    child.once("close", async (code, signal) => {
      childExited = true;
      if (stderrPending !== "")
        showStderr(stderrPending);
      stderrPending = "";
      exit = { code, signal };
      rejectWaiting(new Error(`Child exited (${code ?? signal}); outstanding command outcomes are unknown`));
      event("child_exit", exit);
      await removeContainer();
      if (phase === "stopping") {
        save();
      } else if (fatal === undefined) {
        const watchEnded = assignment.kind === "watch";
        phase = watchEnded ? "exited" : "failed";
        reason = watchEnded ? `Watch command exited (${code ?? signal})` : `Pi exited unexpectedly (${code ?? signal})${stderrTail === "" ? "" : `: ${stderrTail.slice(-500)}`}`;
        settle(watchEnded ? "exited" : "failed", reason);
      }
      resolveClosed();
    });
  });
  const writeRpc = (record) => new Promise((resolveWrite, reject) => {
    const stdin = child.stdin;
    if (childExited || stdin === null || stdin.destroyed)
      return reject(new Error("Pi is unavailable; outcome unknown"));
    stdin.write(`${JSON.stringify(record)}
`, (error) => error ? reject(error) : resolveWrite());
  });
  let markReady = () => {
    return;
  };
  const containerReady = new Promise((resolveReady) => {
    markReady = resolveReady;
  });
  const nextRequestId = () => `${instance}-${++requestNumber}`;
  const request = (type, fields = {}, deadline = RPC_DEADLINE_MS, id = nextRequestId()) => new Promise((resolveRequest, reject) => {
    if (waiting.size >= 32)
      return reject(new Error("Too many pending RPC commands"));
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`Pi ${type} deadline expired; outcome unknown, do not retry`));
    }, deadline);
    waiting.set(id, { timer, resolve: resolveRequest, reject });
    writeRpc({ id, type, ...fields }).catch((error) => {
      if (!waiting.delete(id))
        return;
      clearTimeout(timer);
      reject(error);
    });
  });
  const checkQuiescence = (otherwise) => {
    const id = nextRequestId();
    quiescenceChecks.set(id, { acknowledged, runs, otherwise });
    request("get_state", {}, RPC_DEADLINE_MS, id).catch((error) => {
      quiescenceChecks.delete(id);
      if (!childExited && phase !== "stopping")
        fail(error);
    });
  };
  const closeChild = async () => {
    if (childExited)
      return closed;
    if (assignment.kind === "watch")
      signalChild("SIGTERM");
    else
      child.stdin?.end();
    const term = setTimeout(() => signalChild("SIGTERM"), 3000);
    const kill = setTimeout(() => signalChild("SIGKILL"), 6000);
    try {
      return await closed;
    } finally {
      clearTimeout(term);
      clearTimeout(kill);
    }
  };
  const finishHost = () => {
    terminal?.close();
    process.stdin.pause();
    for (const socket of sockets)
      socket.end();
    server?.close(() => {
      try {
        unlinkSync(socketPath);
      } catch {}
      process.exitCode = phase === "failed" ? 1 : 0;
    });
    if (server === undefined)
      process.exitCode = phase === "failed" ? 1 : 0;
  };
  const fail = (error) => {
    if (fatal !== undefined)
      return fatal;
    const wasTerminal = isTerminal(phase);
    phase = "failed";
    reason = message(error);
    display("host failure", reason);
    fatal = (async () => {
      try {
        if (!wasTerminal)
          settle("failed", reason);
        event("failure", { reason });
      } catch {}
      signalChild("SIGTERM");
      await closeChild();
      finishHost();
    })();
    return fatal;
  };
  child.once("error", (error) => void fail(error));
  if (assignment.kind === "pi") {
    child.stdin?.on("error", (error) => {
      if (phase !== "stopping" && !childExited)
        fail(error);
    });
    if (container !== null)
      child.stdin?.write(containerPreamble(containerEnv(piEnv)));
    child.stderr?.on("data", (chunk) => {
      stderrPending += chunk.toString("utf8");
      const cut = stderrPending.lastIndexOf(`
`);
      if (cut !== -1) {
        showStderr(stderrPending.slice(0, cut + 1));
        stderrPending = stderrPending.slice(cut + 1);
      } else if (stderrPending.length > STDERR_HOLD) {
        showStderr(stderrPending.slice(0, -STDERR_OVERLAP));
        stderrPending = stderrPending.slice(-STDERR_OVERLAP);
      }
    });
    let rpcBuffer = Buffer.alloc(0);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    child.stdout?.on("data", (chunk) => {
      try {
        rpcBuffer = Buffer.concat([rpcBuffer, chunk]);
        for (let newline = rpcBuffer.indexOf(10);newline !== -1; newline = rpcBuffer.indexOf(10)) {
          if (newline > MAX_RPC_RECORD)
            throw new Error("Pi record exceeds the size limit");
          let line = rpcBuffer.subarray(0, newline);
          rpcBuffer = rpcBuffer.subarray(newline + 1);
          if (line.at(-1) === 13)
            line = line.subarray(0, -1);
          onRecord(JSON.parse(decoder.decode(line)));
        }
        if (rpcBuffer.length > MAX_RPC_RECORD)
          throw new Error("Unterminated Pi record exceeds the size limit");
      } catch (error) {
        fail(error);
      }
    });
  }
  const onRecord = (record) => {
    if (!isRecord3(record) || typeof record["type"] !== "string")
      throw new Error("Malformed Pi RPC record");
    const type = record["type"];
    if (type === READY_RECORD) {
      markReady();
      display("container ready", container?.name ?? "");
    } else if (type === "agent_start") {
      runFailure = undefined;
      if (phase === "idle")
        phase = "running";
      save();
      event("agent_start");
    } else if (type === "message_end" && isRecord3(record["message"]) && record["message"]["role"] === "assistant") {
      const assistant = record["message"];
      const stop = assistant["stopReason"];
      if (stop === "error")
        runFailure = typeof assistant["errorMessage"] === "string" ? assistant["errorMessage"] : "Model error";
      const content = assistant["content"];
      const text = Array.isArray(content) ? content.flatMap((part) => isRecord3(part) && part["type"] === "text" && typeof part["text"] === "string" ? [part["text"]] : []).join("") : "";
      if (text !== "")
        display("pi response", text);
    } else if (type === "tool_execution_start") {
      display("pi tool", `${String(record["toolName"])} ${JSON.stringify(record["args"] ?? {}).slice(0, 300)}`);
    } else if (type === "agent_settled") {
      const aborted = record["aborted"] === true;
      if (phase === "running")
        phase = "idle";
      lastRun = { phase: aborted ? "aborted" : runFailure !== undefined ? "failed" : "idle", reason: aborted ? "Run aborted" : runFailure ?? null };
      runs += 1;
      checkQuiescence(lastRun);
    } else if (type === "compaction_end" || type === "auto_retry_end") {
      checkQuiescence({ phase: "idle", reason: null });
    } else if (type === "response") {
      const id = typeof record["id"] === "string" ? record["id"] : undefined;
      const success = record["success"] === true;
      const data = record["data"];
      const carried = id === undefined ? undefined : unacknowledged.get(id);
      if (id !== undefined && carried !== undefined) {
        unacknowledged.delete(id);
        if (success)
          acknowledged = Math.max(acknowledged, carried);
        else if (generation === carried)
          generation -= 1;
        save();
        if (success && isRecord3(data) && data["disposition"] === "handled")
          checkQuiescence({ phase: "handled", reason: null });
        else if (success && phase === "idle")
          checkQuiescence(lastRun ?? { phase: "idle", reason: null });
      }
      const check = id === undefined ? undefined : quiescenceChecks.get(id);
      if (id !== undefined && check !== undefined) {
        quiescenceChecks.delete(id);
        const quiescent = success && isRecord3(data) && data["isStreaming"] === false && data["pendingMessageCount"] === 0;
        const current = runs === check.runs && phase !== "running";
        const uncovered = runs > recordedRuns && check.acknowledged > 0 || check.acknowledged > (settles.at(-1)?.generation ?? 0);
        const outcome = runs > recordedRuns && lastRun !== undefined ? lastRun : check.otherwise;
        if (quiescent && current && uncovered && phase !== "stopping" && !isTerminal(phase))
          settle(outcome.phase, outcome.reason, check.acknowledged);
      }
      const pending = id === undefined ? undefined : waiting.get(id);
      if (pending !== undefined && id !== undefined) {
        waiting.delete(id);
        clearTimeout(pending.timer);
        if (record["success"] === true)
          pending.resolve(record["data"]);
        else
          pending.reject(new Error(typeof record["error"] === "string" ? record["error"] : "Pi rejected command"));
      }
    } else if (type === "extension_ui_request") {
      display("pi ui", { method: record["method"], title: record["title"] });
      if (["select", "confirm", "input", "editor"].includes(String(record["method"])))
        writeRpc({ type: "extension_ui_response", id: record["id"], cancelled: true }).catch(fail);
    }
  };
  const inspectPi = async () => {
    if (childExited || assignment.kind === "watch" || isTerminal(phase))
      return observation();
    const fresh = await request("get_state");
    if (!isRecord3(fresh) || typeof fresh["sessionFile"] !== "string" || dirname2(fresh["sessionFile"]) !== sessionDir)
      throw new Error("Pi session is not in the assigned session directory");
    const freshModel = isRecord3(fresh["model"]) ? { provider: String(fresh["model"]["provider"]), id: String(fresh["model"]["id"]) } : null;
    if (launch.model !== null && (freshModel?.provider !== launch.model.provider || freshModel.id !== launch.model.id))
      throw new Error(`Pi model ${freshModel?.provider}/${freshModel?.id} is not the assigned ${launch.model.provider}/${launch.model.id}`);
    if (sessionFile !== null && fresh["sessionFile"] !== sessionFile)
      throw new Error("Pi session changed unexpectedly");
    sessionFile = fresh["sessionFile"];
    model = freshModel;
    return observation();
  };
  const forward = async (text, streamingBehavior) => {
    if (settles.length >= MAX_SETTLES)
      throw new Error(`Worker has recorded ${settles.length} settles, the limit; spawn a fresh worker for more work`);
    generation += 1;
    save();
    const id = nextRequestId();
    unacknowledged.set(id, generation);
    const result = await request("prompt", { message: text, streamingBehavior }, RPC_DEADLINE_MS, id);
    return { disposition: isRecord3(result) ? result["disposition"] : undefined };
  };
  const dispatch = async (operation, text) => {
    if (operation === "inspect")
      return inspectPi();
    if (mutationPending || phase === "stopping" || phase === "cancelling")
      throw new Error("Host control is busy; request rejected");
    if (operation !== "shutdown" && (childExited || isTerminal(phase)))
      throw new Error(`Worker is ${phase}; request rejected`);
    if (assignment.kind === "watch" && operation !== "shutdown")
      throw new Error("A watch worker only accepts inspect and shutdown");
    mutationPending = true;
    try {
      event("control", { operation });
      if (operation === "start") {
        if (briefSent)
          throw new Error("Brief already sent; request not replayed");
        const brief = readBrief(workerDir);
        if (brief.length === 0 || brief.length > MAX_BRIEF_BYTES)
          throw new Error(`Brief must contain 1 to ${MAX_BRIEF_BYTES} bytes`);
        const result = await forward(brief.toString("utf8"), "followUp");
        briefSent = true;
        save();
        return result;
      }
      if (operation === "prompt" || operation === "steer" || operation === "follow-up")
        return forward(text, operation === "steer" ? "steer" : "followUp");
      if (operation === "cancel") {
        const before = await request("get_state");
        phase = "cancelling";
        const removed = await request("clear_queue");
        await request("abort", {}, ABORT_DEADLINE_MS);
        const after = await request("get_state");
        if (after["isStreaming"] === true || after["pendingMessageCount"] !== 0)
          throw new Error("Cancellation did not reach quiescence");
        phase = "idle";
        save();
        checkQuiescence({ phase: "aborted", reason: "Run cancelled" });
        return { disposition: "cancelled", removed, wasStreaming: before["isStreaming"] === true };
      }
      const before = phase;
      phase = "stopping";
      reason = "Stopped";
      save();
      let removed = null;
      if (!childExited && assignment.kind === "pi") {
        removed = await request("clear_queue").catch(() => null);
        await request("abort", {}, ABORT_DEADLINE_MS).catch(() => {
          return;
        });
      }
      await closeChild();
      phase = isTerminal(before) ? before : "stopped";
      if (isTerminal(before))
        save();
      else
        settle("aborted", "Stopped by request");
      event("shutdown", exit);
      return { disposition: "stopped", removed, exit };
    } catch (error) {
      if (phase === "cancelling")
        phase = childExited ? "failed" : "idle";
      throw error;
    } finally {
      mutationPending = false;
    }
  };
  const serve = (socket) => {
    if (sockets.size >= 8) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let received = false;
    const timeout = setTimeout(() => socket.destroy(), ABORT_DEADLINE_MS + 15000);
    socket.on("error", () => {
      return;
    });
    socket.once("close", () => {
      clearTimeout(timeout);
      sockets.delete(socket);
    });
    const respond = (value) => socket.end(`${JSON.stringify(value)}
`);
    socket.on("data", (chunk) => {
      if (received) {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_CONTROL_BYTES) {
        received = true;
        respond({ ok: false, error: "Control record exceeds limit", outcome: "rejected" });
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline === -1)
        return;
      received = true;
      (async () => {
        let control;
        try {
          if (buffer.subarray(newline + 1).length !== 0)
            throw new Error("Only one control record per connection");
          control = validateControl(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, newline))), loaded, instance);
          if (seen.has(control.id))
            throw new Error("Duplicate command id; request not replayed");
          if (seen.size >= 4096)
            seen.clear();
          seen.add(control.id);
          const result = await dispatch(control.operation, control.text);
          respond({ ok: true, id: control.id, workerId: assignment.workerId, digest: loaded.digest, instance, result });
          if (control.operation === "shutdown")
            finishHost();
        } catch (error) {
          respond({ ok: false, id: control?.id, error: message(error), outcome: /unknown/.test(message(error)) ? "unknown" : "rejected" });
        }
      })();
    });
  };
  try {
    event("launch", { command, hostPid: process.pid, childPid: child.pid, instance });
    save();
    if (container !== null) {
      const deadline = setTimeout(() => void fail(new Error(`The container was not ready within ${CONTAINER_START_MS / 60000} minutes`)), CONTAINER_START_MS);
      await Promise.race([containerReady, closed]);
      clearTimeout(deadline);
    }
    if (assignment.kind === "pi")
      await inspectPi();
    if (!isTerminal(phase))
      phase = assignment.kind === "watch" ? "running" : "idle";
    save();
    prepareSocket(socketPath);
    const umask = process.umask(63);
    server = createServer(serve);
    try {
      await new Promise((resolveListen, reject) => {
        server?.once("error", reject);
        server?.listen(socketPath, resolveListen);
      });
    } finally {
      process.umask(umask);
    }
    chmodSync(socketPath, 384);
    event("ready", { phase, socketPath });
    display("host ready", { worker: assignment.workerId, run: assignment.runId, phase, model, sessionFile, socket: socketPath });
    display("host help", "prompt <text> | steer <text> | follow-up <text> | cancel | status | shutdown   (Ctrl-C cancels the current run)");
    terminal = createInterface({ input: process.stdin, crlfDelay: Infinity });
    terminal.on("line", (line) => {
      const space = line.indexOf(" ");
      const word = space === -1 ? line.trim() : line.slice(0, space);
      const operation = word === "status" ? "inspect" : word;
      const text = space === -1 ? undefined : line.slice(space + 1);
      if (operation === "")
        return;
      try {
        const control = validateControl({ id: randomUUID(), workerId: assignment.workerId, digest: loaded.digest, instance, operation, ...text === undefined ? {} : { text } }, loaded, instance);
        display("operator command", line);
        dispatch(control.operation, control.text).then((result) => {
          display("operator receipt", result);
          if (control.operation === "shutdown")
            finishHost();
        }).catch((error) => display("operator error", message(error)));
      } catch (error) {
        display("operator error", message(error));
      }
    });
    for (const signal of ["SIGTERM", "SIGHUP"])
      process.on(signal, () => {
        if (phase === "stopping")
          return;
        dispatch("shutdown").then(finishHost, fail);
      });
    process.on("SIGINT", () => {
      if (assignment.kind === "pi" && phase === "running")
        dispatch("cancel").then((result) => display("operator receipt", result), (error) => display("operator error", message(error)));
    });
  } catch (error) {
    await fail(error);
  }
}
if (process.argv[1] !== undefined && resolve3(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHost(process.argv[2] ?? "", process.argv[3]).catch((error) => {
    console.error(`[host failure] ${message(error)}`);
    process.exitCode = 1;
  });
}
export {
  HOST_OPERATIONS,
  MAX_CONTROL_BYTES,
  MAX_INSTRUCTION_BYTES,
  launchEnvironment,
  parseLaunch,
  piArgs,
  runHost,
  validateControl
};
