#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const packageRoot = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(packageRoot, "../../..");
  const manifestFlagIndex = process.argv.indexOf("--manifest");
  if (manifestFlagIndex !== -1 && !process.argv[manifestFlagIndex + 1]) {
    throw new Error("--manifest requires a path");
  }

  const manifestPath =
    manifestFlagIndex === -1
      ? resolve(packageRoot, "freeze-prep.json")
      : resolve(process.cwd(), process.argv[manifestFlagIndex + 1]);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const requirements = JSON.parse(
    readFileSync(resolve(repositoryRoot, "parity/requirements.json"), "utf8"),
  );
  const configurations = JSON.parse(
    readFileSync(resolve(repositoryRoot, "parity/configurations.json"), "utf8"),
  );
  const structural = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "parity/evidence/acceptance-repair-structural.json",
      ),
      "utf8",
    ),
  );
  const ownerReport = readFileSync(
    resolve(repositoryRoot, "parity/reviews/acceptance-owner-report.md"),
    "utf8",
  );
  const parentAudit = readFileSync(
    resolve(
      repositoryRoot,
      "parity/reviews/acceptance-repair-parent-audit.md",
    ),
    "utf8",
  );

  const definitionBytesPresent = existsSync(
    resolve(
      repositoryRoot,
      "parity/acceptance/setup-pstack/definitions.json",
    ),
  );
  const configurationBytesPresent = existsSync(
    resolve(
      repositoryRoot,
      "parity/acceptance/setup-pstack/configurations.json",
    ),
  );
  const expectedChecklist = {
    "recorded-definition-hash-consistent":
      ownerReport.includes(manifest.candidate.recordedDefinitionSha256) &&
      parentAudit.includes(manifest.candidate.recordedDefinitionSha256) &&
      structural.digests.definitions ===
        manifest.candidate.recordedDefinitionSha256,
    "recorded-configuration-hash-consistent":
      ownerReport.includes(manifest.candidate.recordedConfigurationSha256) &&
      parentAudit.includes(manifest.candidate.recordedConfigurationSha256),
    "exact-candidate-bytes-present-in-checkout":
      definitionBytesPresent && configurationBytesPresent,
    "independent-owner-named":
      Boolean(requirements.acceptanceDefinitionOwner) &&
      requirements.acceptanceDefinitionOwner ===
        configurations.acceptanceDefinitionOwner,
    "external-custody-established":
      !structural.openBlockers.includes("NO_EXTERNAL_CUSTODY"),
    "authorization-granted": structural.authorization !== "NONE",
    "coverage-denominator-complete":
      requirements.coverageDenominatorComplete === true &&
      structural.partition.denominatorComplete === true,
    "supporting-verifier-safe-for-custody": false,
  };
  const checklistErrors = manifest.custodyChecklist
    .filter((item) => expectedChecklist[item.id] !== item.pass)
    .map(
      (item) =>
        `${item.id} records ${item.pass}, observed ${expectedChecklist[item.id]}`,
    );
  const evidenceHashErrors = Object.entries(manifest.evidenceSha256)
    .filter(([path, expected]) => {
      const actual = createHash("sha256")
        .update(readFileSync(resolve(repositoryRoot, path)))
        .digest("hex");
      return actual !== expected;
    })
    .map(([path]) => `${path} does not match its recorded SHA-256`);
  const failedCustodyChecks = Object.entries(expectedChecklist)
    .filter(([, pass]) => !pass)
    .map(([id]) => id);
  const errors = [
    ...checklistErrors,
    ...evidenceHashErrors,
    ...(manifest.candidate.status === structural.partition.status
      ? []
      : ["candidate status does not match the structural record"]),
    ...(manifest.candidate.recordedManifestSha256 ===
    structural.digests.manifest
      ? []
      : ["candidate manifest hash does not match the structural record"]),
    ...(manifest.decision === "BLOCKED"
      ? []
      : [
          `decision ${manifest.decision} is invalid while custody checks fail: ${failedCustodyChecks.join(", ")}`,
        ]),
    ...(requirements.acceptanceDefinitionsFrozen === false
      ? []
      : ["live requirements unexpectedly mark acceptance definitions frozen"]),
  ];

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  process.stdout.write(
    `PASS: freeze decision remains BLOCKED; ${failedCustodyChecks.length} custody checks fail.\n`,
  );
} catch (error) {
  console.error(
    `FAIL: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
