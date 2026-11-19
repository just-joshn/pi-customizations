import { Buffer } from "node:buffer";
import { type ChildProcess, execFile, type ExecFileException, spawn } from "node:child_process";
import fs from "node:fs";
import { inspect } from "node:util";
import { readMessages } from "./frontends/messages.ts";
import { type Output, PART, type Part } from "./ir.ts";

export function* fileLines(file: string) {
  const fd = fs.openSync(file, "r");
  try {
    let buf = Buffer.allocUnsafe(PART);
    let kept = 0;
    for (;;) {
      if (kept === buf.length) buf = Buffer.concat([buf], buf.length * 2);
      const n = fs.readSync(fd, buf, kept, buf.length - kept, null);
      if (!n) break;
      const end = kept + n;
      const cut = buf.lastIndexOf(10, end - 1);
      if (cut === -1) {
        kept = end;
        continue;
      }
      yield* buf.toString("utf8", 0, cut).split("\n");
      kept = buf.copy(buf, 0, cut + 1, end);
    }
    yield buf.toString("utf8", 0, kept);
  } finally {
    fs.closeSync(fd);
  }
}

export type ChildResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: ExecFileException | undefined;
};

const MAX_CHILD_BUFFER = 1 << 30;
export const SHELL = "/bin/sh";

const childResult = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
): ChildResult => ({
  status: error ? (typeof error.code === "number" ? error.code : null) : 0,
  stdout,
  stderr,
  error: typeof error?.code === "string" ? error : undefined,
});

export const runChild = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) =>
  new Promise<ChildResult>((resolve) => {
    const settle = (error: ExecFileException | null, stdout: string, stderr: string) =>
      resolve(childResult(error, stdout, stderr));
    execFile(file, args, { encoding: "utf8", maxBuffer: MAX_CHILD_BUFFER, ...options }, settle);
  });

export const killGroup = (pid: number) =>
  new Promise((resolve) =>
    spawn(SHELL, ["-c", 'kill -s KILL -- "-$1"', "sh", String(pid)], { stdio: "ignore" }).on(
      "exit",
      resolve,
    ),
  );

export const messageOf = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : inspect(error);

function* chunksOf({ fd, size }: { fd: number; size: number }) {
  for (let pos = 0; pos < size;) {
    const buf = Buffer.allocUnsafe(Math.min(PART, size - pos));
    const n = fs.readSync(fd, buf, 0, buf.length, pos);
    if (!n) break;
    pos += n;
    yield buf.subarray(0, n);
  }
}

const joined = (files: string[]): Output => {
  const opened = files.map((f) => {
    const fd = fs.openSync(f, "r");
    return { fd, size: fs.fstatSync(fd).size };
  });
  return {
    *[Symbol.iterator]() {
      for (const file of opened) yield* chunksOf(file);
    },
  };
};

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

function* outputLines(output: Output) {
  let rest: Uint8Array = new Uint8Array(0);
  for (const part of output) {
    const buf = rest.length ? Buffer.concat([rest, part]) : part;
    const cut = buf.lastIndexOf(10);
    if (cut === -1) {
      rest = buf;
      continue;
    }
    yield* utf8.decode(buf.subarray(0, cut)).split("\n");
    rest = buf.subarray(cut + 1);
  }
  yield utf8.decode(rest);
}

export const messagesOf = (output: Output): Iterable<Part> => ({
  [Symbol.iterator]: () => readMessages(outputLines(output)),
});

export type FileResult = {
  status: number | null;
  stdout: string;
  output: Output;
  error: Error | undefined;
};

export const runToFiles = (
  file: string,
  args: string[],
  { out, ...options }: { out: string; cwd: string; env: NodeJS.ProcessEnv },
) =>
  new Promise<FileResult>((resolve) => {
    const files = [`${out}.stdout`, `${out}.stderr`];
    const fds = files.map((f) => fs.openSync(f, "w"));
    let child: ChildProcess;
    try {
      child = spawn(file, args, { ...options, stdio: ["ignore", ...fds] });
    } finally {
      for (const fd of fds) fs.closeSync(fd);
    }
    let error: Error | undefined;
    const settle = (code: number | null) =>
      resolve({
        status: error ? null : code,
        stdout: files[0],
        output: joined(files),
        error,
      });
    child.on("error", (e) => {
      error = e;
      if (child.pid === undefined) settle(null);
    });
    child.on("close", (code) => {
      if (child.pid !== undefined) settle(code);
    });
  });
