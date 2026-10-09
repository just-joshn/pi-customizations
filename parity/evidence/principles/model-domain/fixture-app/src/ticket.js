export function createDraft() {
  return { isDraft: true, isOpen: false };
}

export function open(ticket) {
  if (!ticket.isDraft || ticket.isOpen) {
    throw new Error('cannot open');
  }
  return { isDraft: false, isOpen: true };
}

export function close(ticket) {
  if (!ticket.isOpen) {
    throw new Error('cannot close');
  }
  return { isDraft: false, isOpen: false };
}

export function label(ticket) {
  if (ticket.isDraft) return 'DRAFT';
  if (ticket.isOpen) return 'OPEN';
  return 'CLOSED';
}
