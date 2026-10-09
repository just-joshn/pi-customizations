#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

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

  const definitionPath = resolve(
    repositoryRoot,
    "parity/acceptance/setup-pstack/definitions.json",
  );
  const configurationPath = resolve(
    repositoryRoot,
    "parity/acceptance/setup-pstack/configurations.json",
  );
  const definitionBytesPresent = existsSync(definitionPath);
  const configurationBytesPresent = existsSync(configurationPath);

  let measuredDefinitionSha256 = null;
  let measuredConfigurationSha256 = null;
  let definitionsDoc = null;
  let configurationsDoc = null;
  if (definitionBytesPresent) {
    measuredDefinitionSha256 = sha256File(definitionPath);
    definitionsDoc = JSON.parse(readFileSync(definitionPath, "utf8"));
  }
  if (configurationBytesPresent) {
    measuredConfigurationSha256 = sha256File(configurationPath);
    configurationsDoc = JSON.parse(readFileSync(configurationPath, "utf8"));
  }

  const liveRequirementIds = new Set(
    (requirements.requirements ?? []).map((row) => row.id),
  );
  const definitionRequirementIds = new Set(
    (definitionsDoc?.definitions ?? []).map((row) => row.requirementId),
  );
  const idSetsMatch =
    liveRequirementIds.size === definitionRequirementIds.size &&
    [...liveRequirementIds].every((id) => definitionRequirementIds.has(id));

  const owners = [
    requirements.acceptanceDefinitionOwner,
    configurations.acceptanceDefinitionOwner,
    definitionsDoc?.owner ?? null,
    configurationsDoc?.owner ?? null,
  ];
  const independentOwnerNamed =
    owners.every((owner) => typeof owner === "string" && owner.length > 0) &&
    new Set(owners).size === 1;

  const expectedChecklist = {
    "measured-definition-digest-matches-candidate":
      measuredDefinitionSha256 ===
      manifest.candidate.measuredDefinitionSha256,
    "measured-configuration-digest-matches-candidate":
      measuredConfigurationSha256 ===
      manifest.candidate.measuredConfigurationSha256,
    "exact-candidate-bytes-present-in-checkout":
      definitionBytesPresent &&
      configurationBytesPresent &&
      statSync(definitionPath).isFile() &&
      statSync(configurationPath).isFile(),
    "independent-owner-named": independentOwnerNamed,
    "external-custody-established":
      Array.isArray(structural.openBlockers) &&
      !structural.openBlockers.includes("NO_EXTERNAL_CUSTODY"),
    "authorization-granted": structural.authorization !== "NONE",
    "coverage-denominator-complete":
      requirements.coverageDenominatorComplete === true &&
      definitionsDoc?.denominatorComplete === true &&
      idSetsMatch &&
      (definitionsDoc?.definitions?.length ?? 0) ===
        manifest.candidate.definitionCount,
    "supporting-verifier-safe-for-custody": (() => {
      const reportRel =
        "parity/briefs/reports/u-acceptance-verifier-rereview-002-report.md";
      const reportPath = resolve(repositoryRoot, reportRel);
      const toolPath =
        "/private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/tools/verify-acceptance.mjs";
      const expectedTool =
        manifest.supportingVerifierToolDigest ??
        "5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7";
      if (!existsSync(reportPath) || !existsSync(toolPath)) {
        return false;
      }
      const report = readFileSync(reportPath, "utf8");
      const flipYes =
        /supporting-verifier-safe-for-custody[\s\S]{0,200}may flip to PASS/i.test(
          report,
        ) || /\*\*may flip to PASS\*\*/i.test(report);
      return flipYes && sha256File(toolPath) === expectedTool;
    })(),
  };

  const checklistErrors = manifest.custodyChecklist
    .filter((item) => expectedChecklist[item.id] !== item.pass)
    .map(
      (item) =>
        `${item.id} records ${item.pass}, observed ${expectedChecklist[item.id]}`,
    );

  const evidenceHashErrors = Object.entries(manifest.evidenceSha256)
    .filter(([path, expected]) => {
      const absolute = resolve(repositoryRoot, path);
      if (!existsSync(absolute)) {
        return true;
      }
      return sha256File(absolute) !== expected;
    })
    .map(([path]) => `${path} does not match its recorded SHA-256`);

  const failedCustodyChecks = Object.entries(expectedChecklist)
    .filter(([, pass]) => !pass)
    .map(([id]) => id);

  const errors = [
    ...checklistErrors,
    ...evidenceHashErrors,
    ...(manifest.candidate.status === "DRAFT"
      ? []
      : ["candidate status must remain DRAFT until an independent owner freezes"]),
    ...(manifest.candidate.owner === null
      ? []
      : [
          "candidate.owner must remain null in this package; do not invent an owner",
        ]),
    ...(failedCustodyChecks.length === 0
      ? manifest.decision === "READY"
        ? []
        : ["decision must be READY when every custody check passes"]
      : manifest.decision === "BLOCKED"
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
    `PASS: freeze decision remains ${manifest.decision}; ${failedCustodyChecks.length} custody checks fail; ${Object.keys(expectedChecklist).length - failedCustodyChecks.length} pass.\n`,
  );
} catch (error) {
  console.error(
    `FAIL: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
