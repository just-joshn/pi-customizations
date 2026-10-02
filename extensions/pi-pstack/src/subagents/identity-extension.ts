import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

export type ChildIdentity = Readonly<{ headers: Readonly<Record<string, string>>; agentId: string; parentAgentId: string }>;

function withBodyFields(payload: unknown, identity: ChildIdentity): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload;
  return { ...payload, agent_task_id: identity.agentId, parent_agent_id: identity.parentAgentId };
}

/**
 * Stamps every model request of a child with the subagent identity headers. Providers that speak the GitHub Copilot
 * wire format also get the two body fields; every other provider rejects unknown body fields, so it gets headers only.
 */
export function identityExtension(identity: ChildIdentity): ExtensionFactory {
  return (pi) => {
    let copilotWire = false;
    pi.on('model_select', (event) => {
      copilotWire = event.model.provider === 'github-copilot';
    });
    pi.on('before_provider_headers', (event) => {
      for (const [name, value] of Object.entries(identity.headers)) event.headers[name] = value;
    });
    pi.on('before_provider_request', (event) => (copilotWire ? withBodyFields(event.payload, identity) : undefined));
  };
}
