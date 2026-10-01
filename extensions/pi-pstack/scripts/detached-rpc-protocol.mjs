import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

import { Type } from 'typebox';
import { Check } from 'typebox/value';

export const launchSchema = Type.Object({ executable: Type.String({ minLength: 1 }), args: Type.Array(Type.String()), cwd: Type.String({ minLength: 1 }), agentDir: Type.String({ minLength: 1 }) });
export const commandSchema = Type.Object({ id: Type.String({ pattern: '^[0-9a-f-]{36}$' }), command: Type.Object({ type: Type.String({ minLength: 1 }) }, { additionalProperties: true }) });
const responseFields = { id: Type.String(), type: Type.Literal('response'), command: Type.String() };
export const responseSchema = Type.Union([Type.Object({ ...responseFields, success: Type.Literal(true), data: Type.Optional(Type.Unknown()) }), Type.Object({ ...responseFields, success: Type.Literal(false), error: Type.String() })]);
export const statusSchema = Type.Union([
  Type.Object({ kind: Type.Literal('starting'), pid: Type.Integer({ minimum: 1 }) }),
  Type.Object({ kind: Type.Literal('ready'), pid: Type.Integer({ minimum: 1 }), childPid: Type.Integer({ minimum: 1 }) }),
  Type.Object({ kind: Type.Literal('exited'), pid: Type.Integer({ minimum: 1 }), code: Type.Union([Type.Integer(), Type.Null()]) }),
  Type.Object({ kind: Type.Literal('failed'), pid: Type.Integer({ minimum: 1 }), error: Type.String() }),
]);

export async function readRecord(path, schema) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  const value = JSON.parse(text);
  if (!Check(schema, value)) throw new Error(`Invalid detached RPC record: ${path}`);
  return value;
}

export async function writeRecord(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}
