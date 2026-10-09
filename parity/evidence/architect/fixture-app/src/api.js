// HTTP-shaped API facade over the store. Ownership: request validation and DTO shaping.
import { createTicket, listTickets, getTicket } from './store.js';

export function list() {
  return { ok: true, tickets: listTickets() };
}

export function create(body) {
  try {
    const ticket = createTicket({ title: body?.title, status: body?.status });
    return { ok: true, ticket };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

export function get(id) {
  const ticket = getTicket(id);
  if (!ticket) return { ok: false, error: 'not found' };
  return { ok: true, ticket };
}
