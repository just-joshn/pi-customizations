export type Ticket = {
  id: string;
  completed: boolean;
  completedAt?: string | null;
};

export function describe(ticket: Ticket): string {
  if (!ticket.completed) return `open:${ticket.id}`;
  const at = ticket.completedAt as string;
  return `done:${ticket.id}@${at.slice(0, 10)}`;
}

export function loadCases(): Ticket[] {
  return [
    { id: 'a', completed: false },
    { id: 'b', completed: true, completedAt: '2026-10-08T15:00:00.000Z' },
    { id: 'c', completed: true },
  ];
}
