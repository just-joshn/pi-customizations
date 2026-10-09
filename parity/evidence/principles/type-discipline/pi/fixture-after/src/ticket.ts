export type Ticket =
  | { kind: 'open'; id: string }
  | { kind: 'done'; id: string; completedAt: string };

export function describe(ticket: Ticket): string {
  switch (ticket.kind) {
    case 'open':
      return `open:${ticket.id}`;
    case 'done':
      return `done:${ticket.id}@${ticket.completedAt.slice(0, 10)}`;
    default: {
      const _exhaustive: never = ticket;
      return _exhaustive;
    }
  }
}

export function parseTicket(raw: unknown): Ticket | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, completed, completedAt } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || typeof completed !== 'boolean') return null;
  if (!completed) return { kind: 'open', id };
  if (typeof completedAt !== 'string') return null;
  return { kind: 'done', id, completedAt };
}

export function loadCases(): Ticket[] {
  const raw: unknown[] = [
    { id: 'a', completed: false },
    { id: 'b', completed: true, completedAt: '2026-10-08T15:00:00.000Z' },
    { id: 'c', completed: true },
  ];
  return raw.flatMap((r) => parseTicket(r) ?? []);
}
