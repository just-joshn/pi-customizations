// Thin HTTP-shaped adapter over the store. Owns request validation only.
import { createTicket, getTicket, listTickets } from './store.js';

export function handle(req) {
  if (req.method === 'GET' && req.path === '/tickets') {
    return { status: 200, body: listTickets() };
  }
  if (req.method === 'GET' && req.path?.startsWith('/tickets/')) {
    const id = req.path.slice('/tickets/'.length);
    const ticket = getTicket(id);
    return ticket ? { status: 200, body: ticket } : { status: 404, body: { error: 'missing' } };
  }
  if (req.method === 'POST' && req.path === '/tickets') {
    try {
      return { status: 201, body: createTicket(req.body ?? {}) };
    } catch (error) {
      return { status: 400, body: { error: String(error.message || error) } };
    }
  }
  return { status: 404, body: { error: 'unknown route' } };
}
