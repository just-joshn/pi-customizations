import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants as fsConstants, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { capabilityUnavailable, type ReaError } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';

const execFileAsync = promisify(execFile);

const TSHARK_ENV = 'REA_TSHARK_COMMAND';
const CAPINFOS_ENV = 'REA_CAPINFOS_COMMAND';

const PCAP_PROVIDER_NAME = 'Packet capture analysis';
const PCAP_TOOL_REMEDIATION = `Supply Wireshark 4.x tshark and capinfos on PATH or through absolute ${TSHARK_ENV} and ${CAPINFOS_ENV}; REA does not install them.`;
const PCAP_UNSUPPORTED_HOST_MESSAGE = "Packet summaries require an enforceable native memory bound: Linux with util-linux prlimit, or Windows with owned Job Objects. This host's capture boundary remains unsupported.";
const IDENTITY_UNAVAILABLE_LIMITATION = 'Artifact identity is unavailable for this observation.';

type WiresharkTool = 'tshark' | 'capinfos';

interface WiresharkSelection {
  readonly command: string;
  readonly source: 'environment' | 'path';
}

interface WiresharkIdentity {
  readonly command: string;
  readonly source: 'environment' | 'path';
  readonly version: string | null;
  readonly resolvedPath: string | null;
  readonly sha256: string | null;
  readonly identityStatus: 'verified' | 'unresolved';
}

const envKeyOf = (tool: WiresharkTool): string => (tool === 'tshark' ? TSHARK_ENV : CAPINFOS_ENV);

const joinReasonAndRemediation = (reason: string): string => `${/[.!?]$/u.test(reason) ? reason : `${reason}.`} ${PCAP_TOOL_REMEDIATION}`;

const pcapUnavailableObject = (operation: string, reason: string): ReaError => capabilityUnavailable(joinReasonAndRemediation(reason), { provider_id: 'pcap', operation, reason }, joinReasonAndRemediation(reason));

const selectWiresharkTool = (tool: WiresharkTool, operation: string): WiresharkSelection => {
  const key = envKeyOf(tool);
  const configured = process.env[key];
  if (configured === undefined || configured.trim() === '') return { command: tool, source: 'path' };
  if (!isAbsolute(configured)) {
    throw pcapUnavailableObject(operation, `${key} must be an absolute path to the ${tool} binary`);
  }
  return { command: configured, source: 'environment' };
};

const locateWiresharkTool = (tool: WiresharkTool): string | undefined => {
  for (const directory of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = `${directory}/${tool}`;
    try {
      accessSync(candidate, fsConstants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Absent or non-executable candidates leave later PATH entries eligible.
    }
  }
  return undefined;
};

const resolveWiresharkTool = (tool: WiresharkTool, operation: string): WiresharkSelection => {
  const selection = selectWiresharkTool(tool, operation);
  if (selection.source === 'environment') return selection;
  const located = locateWiresharkTool(tool);
  if (located === undefined) {
    throw pcapUnavailableObject(operation, `${tool} was not found in an absolute PATH entry; add it to PATH or set ${envKeyOf(tool)} to its absolute path`);
  }
  return { command: located, source: 'path' };
};

const resolveWiresharkTools = (operation: string): readonly [WiresharkSelection, WiresharkSelection] => [resolveWiresharkTool('tshark', operation), resolveWiresharkTool('capinfos', operation)];

const bannerFor = async (command: string): Promise<string> => {
  const { stdout } = await execFileAsync(command, ['--version'], { timeout: 30_000 });
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry !== '');
  return line ?? '';
};

const parseWiresharkVersion = (tool: WiresharkTool, line: string, operation: string): string => {
  const parsed = new RegExp(`^${tool} \\(Wireshark\\) (\\d+)\\.\\d+\\.\\d+`, 'iu').exec(line);
  if (parsed === null) {
    throw pcapUnavailableObject(operation, `The selected ${tool} command did not report a version. Set ${envKeyOf(tool)} to its absolute executable path.`);
  }
  if (parsed[1] !== '4') {
    throw pcapUnavailableObject(operation, 'Packet capture inspection currently requires Wireshark 4.x tools; select an installation with the admitted output profile.');
  }
  return line;
};

const probeWiresharkIdentity = async (tool: WiresharkTool, selection: WiresharkSelection, operation: string): Promise<WiresharkIdentity> => {
  let version: string;
  try {
    version = parseWiresharkVersion(tool, await bannerFor(selection.command), operation);
  } catch (error) {
    if (error && typeof error === 'object' && 'payload' in error) throw error;
    throw pcapUnavailableObject(operation, `The selected ${tool} command did not report a version. Set ${envKeyOf(tool)} to its absolute executable path.`);
  }
  try {
    const resolvedPath = realpathSync(selection.command);
    const bytes = await readFile(resolvedPath);
    return {
      ...selection,
      version,
      resolvedPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      identityStatus: 'verified',
    };
  } catch {
    return { ...selection, version, resolvedPath: null, sha256: null, identityStatus: 'unresolved' };
  }
};

const probePcapClient = async (operation: string): Promise<{ tshark: WiresharkIdentity; capinfos: WiresharkIdentity }> => {
  const [tsharkSelection, capinfosSelection] = resolveWiresharkTools(operation);
  const tshark = await probeWiresharkIdentity('tshark', tsharkSelection, operation);
  const capinfos = await probeWiresharkIdentity('capinfos', capinfosSelection, operation);
  return { tshark, capinfos };
};

const projectIdentity = (prefix: 'tshark' | 'capinfos', identity: WiresharkIdentity): Record<string, unknown> => ({
  [`${prefix}_command`]: identity.command,
  [`${prefix}_source`]: identity.source,
  [`${prefix}_version`]: identity.version,
  [`${prefix}_resolved_path`]: identity.resolvedPath,
  [`${prefix}_sha256`]: identity.sha256,
  [`${prefix}_identity_status`]: identity.identityStatus,
});

export const inspectPcapClient = async (session: ReaSession): Promise<AgentToolResult<unknown>> => {
  const { tshark, capinfos } = await probePcapClient('inspect_pcap_client');
  const record = createEvidence({
    subject: null,
    provider: { id: 'pcap', name: PCAP_PROVIDER_NAME, version: tshark.version },
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_pcap_client',
    parameters: {},
    raw_result: null,
    normalized_result: { client: { ...projectIdentity('tshark', tshark), ...projectIdentity('capinfos', capinfos) } },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [IDENTITY_UNAVAILABLE_LIMITATION],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export const inspectPcapCapture = async (_session: ReaSession, _params: { readonly path?: string }): Promise<AgentToolResult<unknown>> => {
  await probePcapClient('inspect_pcap_capture');
  if (process.platform !== 'linux' && process.platform !== 'win32') {
    throw capabilityUnavailable(PCAP_UNSUPPORTED_HOST_MESSAGE, { provider_id: 'pcap', operation: 'inspect_pcap_capture', reason: PCAP_UNSUPPORTED_HOST_MESSAGE }, PCAP_UNSUPPORTED_HOST_MESSAGE);
  }
  throw capabilityUnavailable('pi-rea advertises inspect_pcap_capture but has not implemented capture summaries yet, so the call fails closed instead of returning a substitute result. parity/pi-rea/ tracks the gap.', {
    provider_id: 'pcap',
    operation: 'inspect_pcap_capture',
    reason: 'not_implemented',
  });
};
