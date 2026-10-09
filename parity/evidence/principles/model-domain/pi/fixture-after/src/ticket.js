const TRANSITIONS = {
  open: { from: 'draft', to: 'open' },
  hold: { from: 'open', to: 'held' },
  release: { from: 'held', to: 'open' },
  close: { from: 'open', to: 'closed' },
};

function transition(name, ticket) {
  const { from, to } = TRANSITIONS[name];
  if (ticket.status !== from) {
    throw new Error(`cannot ${name}`);
  }
  return { status: to };
}

export function createDraft() {
  return { status: 'draft' };
}

export const open = (ticket) => transition('open', ticket);
export const hold = (ticket) => transition('hold', ticket);
export const release = (ticket) => transition('release', ticket);
export const close = (ticket) => transition('close', ticket);

export function label(ticket) {
  return ticket.status.toUpperCase();
}
