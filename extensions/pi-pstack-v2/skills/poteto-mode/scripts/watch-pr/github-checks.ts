import { record, string } from "./github-json.ts";
import type { Check } from "./types.ts";

interface CheckDetails {
  readonly name: string;
  readonly description: string;
  readonly link: string;
  readonly workflow: string;
}
const GATE_NAME = "Code Review Gate";
const FAST_FAILURE_STATES = ["FAILURE", "ERROR"];

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;
const upperOrEmpty = (value: unknown): string =>
  typeof value === "string" ? value.toUpperCase() : "";
function checkDetails(
  value: Record<string, unknown>,
  nameKey: string
): CheckDetails {
  return {
    name: string(value[nameKey], nameKey),
    description: stringOr(value.description, ""),
    link: stringOr(value.link, stringOr(value.detailsUrl, "")),
    workflow: stringOr(value.workflow, ""),
  };
}
// Every read path classifies the owner-approval gate here, so the rule has one
// home. A gate that is pending or waits on an owner approval must not count as
// pending or failed, or the watcher waits on a human.
function gateOr(
  kind: "pending" | "failed",
  details: CheckDetails,
  reportedState: string
): Check {
  return details.name === GATE_NAME
    ? { ...details, kind: "code-review-gate", name: GATE_NAME, reportedState }
    : { ...details, kind, reportedState };
}
export function parseFastCheck(value: unknown): Check {
  const object = record(value, "check");
  const details = checkDetails(object, "name");
  const state = string(object.state, "check.state").toUpperCase();
  const bucket = string(object.bucket, "check.bucket");
  if (state === "ACTION_REQUIRED") return gateOr("failed", details, state);
  if (bucket === "fail" || FAST_FAILURE_STATES.includes(state))
    return { ...details, kind: "failed", reportedState: state };
  if (bucket === "pending") return gateOr("pending", details, state);
  if (bucket === "pass")
    return { ...details, kind: "passed", reportedState: state };
  if (bucket === "skipping")
    return { ...details, kind: "skipped", reportedState: state };
  return { ...details, kind: "failed", reportedState: state };
}
function checkRunCheck(details: CheckDetails, object: Record<string, unknown>) {
  const status = upperOrEmpty(object.status);
  const conclusion = upperOrEmpty(object.conclusion);
  if (status !== "COMPLETED") return gateOr("pending", details, "PENDING");
  if (conclusion === "SUCCESS")
    return { ...details, kind: "passed", reportedState: "SUCCESS" } as const;
  if (conclusion === "NEUTRAL" || conclusion === "SKIPPED")
    return { ...details, kind: "skipped", reportedState: conclusion } as const;
  if (conclusion === "ACTION_REQUIRED")
    return gateOr("failed", details, conclusion);
  return { ...details, kind: "failed", reportedState: "FAILURE" } as const;
}
function statusContextCheck(
  details: CheckDetails,
  object: Record<string, unknown>
) {
  const state = upperOrEmpty(object.state);
  if (state === "PENDING" || state === "EXPECTED")
    return gateOr("pending", details, "PENDING");
  return state === "SUCCESS"
    ? ({ ...details, kind: "passed", reportedState: state } as const)
    : ({
        ...details,
        kind: "failed",
        reportedState: state || "FAILURE",
      } as const);
}
export function mapRollupNode(value: unknown): Check | null {
  const object = record(value, "rollup node");
  const typename = object.__typename;
  if (typename !== "CheckRun" && typename !== "StatusContext") return null;
  const base = checkDetails(object, typename === "CheckRun" ? "name" : "context");
  const details = { ...base, link: stringOr(object.targetUrl, base.link) };
  return typename === "CheckRun"
    ? checkRunCheck(details, object)
    : statusContextCheck(details, object);
}
