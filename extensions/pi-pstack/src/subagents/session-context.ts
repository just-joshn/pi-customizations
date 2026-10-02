import type { SessionManager } from '@earendil-works/pi-coding-agent';

type ChildContext = Readonly<{ id: string; depth: number; foreground?: boolean }>;

export function saveChildContext(manager: SessionManager, context: ChildContext): void {
  manager.appendCustomEntry('pstack-agent-identity', context.id);
  manager.appendCustomEntry('pstack-agent-depth', context.depth);
  manager.appendCustomEntry('pstack-agent-foreground', context.foreground === true);
}
