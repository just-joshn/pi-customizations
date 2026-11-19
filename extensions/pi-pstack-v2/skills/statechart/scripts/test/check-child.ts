import assert from "node:assert/strict";
import { z } from "zod";
import { check } from "../run.ts";

const [, , login, broken] = z.array(z.string()).parse(process.argv);

await check(`${login}.tla`, `${login}.cfg`);
await assert.rejects(check(`${broken}.tla`, `${broken}.cfg`), /SANY could not read/);
