export type Ticket =
  | { status: 'open'; id: string }
  | { status: 'done'; id: string; completedAt: string };

export function describe(ticket: Ticket): string {
  switch (ticket.status) {
    case 'open':
      return `open:${ticket.id}`;
    case 'done':
      return `done:${ticket.id}@${ticket.completedAt.slice(0, 10)}`;
  }
}

export function loadCases(): Ticket[] {
  return [
    { status: 'open', id: 'a' },
    { status: 'done', id: 'b', completedAt: '2026-10-08T15:00:00.000Z' },
  ];
}
