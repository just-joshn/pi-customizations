export function formatNote(note) {
  const text = typeof note === 'string' ? note : note.text;
  const createdAt =
    typeof note === 'string' ? new Date().toISOString() : note.createdAt;
  return `- ${createdAt} ${text}`;
}
