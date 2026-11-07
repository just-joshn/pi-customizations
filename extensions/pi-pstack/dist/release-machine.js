// src/cloud/release-main.ts
import { renameSync as renameSync2, writeFileSync as writeFileSync3 } from "node:fs";

// src/cloud/machine.ts
import { createWriteStream, existsSync, mkdirSync as mkdirSync2, readdirSync as readdirSync2, readFileSync as readFileSync2, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { isAbsolute, join as join4, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// src/paths.ts
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/child-env.ts
var DEPTH_ENV = "PI_PSTACK_DEPTH";
var AGENT_ENV = "PI_PSTACK_AGENT";
var PARENT_ENV = "PI_PSTACK_PARENT_PID";
var READONLY_ENV = "PI_PSTACK_READONLY";
var ROOT_STORE_ENV = "PI_PSTACK_ROOT_STORE";
var WORKSPACE_ENV = "PI_PSTACK_WORKSPACE_STATE";
var ROOT_WORKSPACE_ENV = "PI_PSTACK_ROOT_WORKSPACE";
var BUILD_PLAN_ENV = "PI_PSTACK_BUILD_PLAN";
var MACHINE_ENV = "PI_PSTACK_MACHINE";
var PROJECT_ENV = "PI_PSTACK_PROJECT";
var AUTOMATION_ENV = "PI_PSTACK_AUTOMATION";
var ROOT_SESSION_ENV = "PI_PSTACK_ROOT_SESSION";
var ROOT_PID_ENV = "PI_PSTACK_ROOT_PID";
function read() {
  const depth = Number(process.env[DEPTH_ENV] ?? "0");
  const parentPid = Number(process.env[PARENT_ENV] ?? "");
  const rootSession = process.env[ROOT_SESSION_ENV];
  const rootPid = Number(process.env[ROOT_PID_ENV] ?? "");
  return {
    depth: Number.isInteger(depth) && depth > 0 ? depth : 0,
    agentType: process.env[AGENT_ENV],
    parentPid: Number.isInteger(parentPid) && parentPid > 1 ? parentPid : undefined,
    readonly: process.env[READONLY_ENV] === "1",
    rootStore: process.env[ROOT_STORE_ENV] || undefined,
    workspaceState: process.env[WORKSPACE_ENV] || undefined,
    rootWorkspace: process.env[ROOT_WORKSPACE_ENV] || undefined,
    buildPlan: process.env[BUILD_PLAN_ENV] || undefined,
    machine: process.env[MACHINE_ENV] || undefined,
    project: process.env[PROJECT_ENV] || undefined,
    automation: process.env[AUTOMATION_ENV] === "1",
    root: depth > 0 && rootSession !== undefined && rootSession !== "" && Number.isInteger(rootPid) && rootPid > 1 ? { sessionId: rootSession, pid: rootPid } : undefined
  };
}
var childIdentity = read();
delete process.env[DEPTH_ENV];
delete process.env[AGENT_ENV];
delete process.env[PARENT_ENV];
delete process.env[READONLY_ENV];
delete process.env[ROOT_STORE_ENV];
delete process.env[WORKSPACE_ENV];
delete process.env[ROOT_WORKSPACE_ENV];
delete process.env[BUILD_PLAN_ENV];
delete process.env[MACHINE_ENV];
delete process.env[PROJECT_ENV];
delete process.env[AUTOMATION_ENV];
delete process.env[ROOT_SESSION_ENV];
delete process.env[ROOT_PID_ENV];

// src/paths.ts
var PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
var SKILLS_DIR = join(PACKAGE_ROOT, "skills");
var AGENTS_DIR = join(PACKAGE_ROOT, "agents");

// src/process-lock.ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
function zombie(pid) {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      return close !== -1 && stat.slice(close + 2, close + 3) === "Z";
    }
    if (process.platform === "darwin") {
      return execFileSync("ps", ["-o", "state=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().startsWith("Z");
    }
    return false;
  } catch {
    return false;
  }
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return false;
  try {
    process.kill(pid, 0);
    return !zombie(pid);
  } catch (error) {
    return error.code === "EPERM";
  }
}
function acquireLease(path) {
  mkdirSync(dirname2(path), { recursive: true, mode: 448 });
  const token = `${process.pid}-${randomUUID()}`;
  const temporary = `${path}.${token}.tmp`;
  mkdirSync(temporary, { mode: 448 });
  try {
    writeFileSync(join2(temporary, token), "", { mode: 384 });
    for (let attempt = 0;attempt < 4; attempt += 1) {
      try {
        renameSync(temporary, path);
        return {
          token,
          release: () => {
            rmSync(join2(path, token), { force: true });
            try {
              rmdirSync(path);
            } catch (error) {
              if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? ""))
                throw error;
            }
          }
        };
      } catch (error) {
        if (!["ENOTEMPTY", "EEXIST"].includes(error.code ?? ""))
          throw error;
      }
      let holders;
      try {
        holders = readdirSync(path);
      } catch (error) {
        if (error.code === "ENOENT")
          continue;
        throw error;
      }
      for (const holder of holders) {
        const pid = Number(/^(\d+)-[a-f0-9-]+$/.exec(holder)?.[1]);
        if (!Number.isInteger(pid))
          throw new Error(`Invalid process lock ${path}. Retain it for diagnosis.`);
        if (alive(pid))
          return;
        rmSync(join2(path, holder), { force: true });
      }
      try {
        rmdirSync(path);
      } catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? ""))
          throw error;
      }
    }
    return;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

// src/cloud/docker.ts
import { execFile } from "node:child_process";
var DOCKER_CONTEXT_ENV = "PSTACK_CLOUD_DOCKER_CONTEXT";
var PROBE_TIMEOUT_MS = 5000;
function dockerPrefix(env = process.env) {
  const context = env[DOCKER_CONTEXT_ENV];
  return context === undefined || context === "" ? [] : ["--context", context];
}

class DockerError extends Error {
  stderr;
  constructor(message, stderr) {
    super(message);
    this.name = "DockerError";
    this.stderr = stderr;
  }
}
function docker(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("docker", [...dockerPrefix(), ...args], { encoding: "buffer", maxBuffer: 64 << 20, ...options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }, ...options.signal === undefined ? {} : { signal: options.signal } }, (error, stdout, stderr) => {
      const err = stderr.toString("utf8").trim();
      if (error === null)
        resolve(stdout.toString("utf8"));
      else
        reject(new DockerError(`docker ${args[0] ?? ""} failed: ${err === "" ? error.message : err}`, err));
    });
    if (options.input !== undefined)
      child.stdin?.end(options.input);
    else
      child.stdin?.end();
  });
}
async function containerState(name) {
  try {
    const state = (await docker(["inspect", "--format", "{{.State.Status}}", name], { timeoutMs: PROBE_TIMEOUT_MS })).trim();
    switch (state) {
      case "running":
      case "exited":
      case "created":
      case "paused":
      case "restarting":
      case "removing":
      case "dead":
        return state;
      default:
        return "missing";
    }
  } catch (error) {
    if (error instanceof DockerError && /no such (object|container)/i.test(error.stderr))
      return "missing";
    throw error;
  }
}

// src/cloud/environment.ts
import { join as join3, resolve as resolve2 } from "node:path";
var ENVIRONMENT_FILE = join3(".pi", "environment.json");

// src/cloud/machine.ts
var INSTALL_TIMEOUT_MS = 30 * 60000;
function readRun(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return;
  }
}
function readPid(path) {
  try {
    return Number.parseInt(readFileSync2(path, "utf8"), 10);
  } catch {
    return Number.NaN;
  }
}
var isUnder = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || !path.startsWith("..") && !isAbsolute(path);
};
function inUse(machine, locks, self) {
  if (!existsSync(locks))
    return false;
  return readdirSync2(locks).some((name) => {
    if (!name.endsWith(".lock"))
      return false;
    const pid = readPid(join4(locks, name));
    if (pid === self || !alive(pid))
      return false;
    const record = readRun(join4(locks, `${name.slice(0, -".lock".length)}.json`));
    if (record?.machine?.container !== machine.container && !(typeof record?.cwd === "string" && isUnder(machine.path, record.cwd)))
      return false;
    return record.run?.pid !== pid || typeof record.run.exit !== "string" || !existsSync(record.run.exit);
  });
}
var LEASE_POLL_MS = 100;
async function withMachineLease(machine, locks, step) {
  if (machine.driver === "worktree")
    return step();
  const path = join4(locks, `${machine.container}.lease`);
  let lease = acquireLease(path);
  while (lease === undefined) {
    await sleep(LEASE_POLL_MS);
    lease = acquireLease(path);
  }
  try {
    return await step();
  } finally {
    lease.release();
  }
}
async function releaseMachine(machine, locks, options = {}) {
  if (machine.driver === "worktree")
    return;
  await withMachineLease(machine, locks, async () => {
    try {
      if (!inUse(machine, locks, options.self) && await containerState(machine.container) === "running")
        await docker(["stop", "--time", "5", machine.container], { timeoutMs: 30000 });
    } finally {
      options.finish?.();
    }
  });
}

// src/cloud/release-main.ts
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is not set.`);
  return value;
}
var [self = "", code = ""] = process.argv.slice(2);
var exit = required("PSTACK_EXIT");
await releaseMachine({ driver: "container", container: required("PSTACK_MACHINE_CONTAINER"), path: required("PSTACK_MACHINE_PATH") }, required("PSTACK_LOCKS"), {
  self: Number(self),
  finish: () => {
    writeFileSync3(`${exit}.tmp`, code);
    renameSync2(`${exit}.tmp`, exit);
  }
});
