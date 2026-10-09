/**
 * Ticket lifecycle: draft → open ⇄ held → (via open) → closed.
 * Sole state field: status. Illegal combos unrepresentable.
 */

/** @typedef {'draft' | 'open' | 'held' | 'closed'} TicketStatus */
/** @typedef {{ readonly status: TicketStatus }} Ticket */

/** @returns {Ticket} */
export function createDraft() {
  return { status: 'draft' };
}

/**
 * draft → open
 * @param {Ticket} ticket
 * @returns {Ticket}
 */
export function open(ticket) {
  if (ticket.status !== 'draft') throw new Error('cannot open');
  return { status: 'open' };
}

/**
 * open → held
 * @param {Ticket} ticket
 * @returns {Ticket}
 */
export function hold(ticket) {
  if (ticket.status !== 'open') throw new Error('cannot hold');
  return { status: 'held' };
}

/**
 * held → open
 * @param {Ticket} ticket
 * @returns {Ticket}
 */
export function release(ticket) {
  if (ticket.status !== 'held') throw new Error('cannot release');
  return { status: 'open' };
}

/**
 * open → closed (held rejected by status check)
 * @param {Ticket} ticket
 * @returns {Ticket}
 */
export function close(ticket) {
  if (ticket.status !== 'open') throw new Error('cannot close');
  return { status: 'closed' };
}

/**
 * @param {Ticket} ticket
 * @returns {'DRAFT' | 'OPEN' | 'HELD' | 'CLOSED'}
 */
export function label(ticket) {
  return ticket.status.toUpperCase();
}
