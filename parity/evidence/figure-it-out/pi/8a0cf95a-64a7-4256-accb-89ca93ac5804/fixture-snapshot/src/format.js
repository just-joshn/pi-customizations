export function formatNote(text, createdAt = new Date().toISOString()) {
  return `- ${createdAt} ${text}`;
}
