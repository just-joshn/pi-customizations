// In-memory ticket store. Owns persistence and id allocation.
let nextId = 1;
const tickets = new Map();

export function createTicket({ title, status = 'open' }) {
  if (!title || typeof title !== 'string') throw new Error('title required');
  const id = String(nextId++);
  const ticket = { id, title, status, createdAt: Date.now() };
  tickets.set(id, ticket);
  return { ...ticket };
}

export function getTicket(id) {
  const ticket = tickets.get(id);
  return ticket ? { ...ticket } : null;
}

export function listTickets() {
  return [...tickets.values()].map((t) => ({ ...t }));
}
