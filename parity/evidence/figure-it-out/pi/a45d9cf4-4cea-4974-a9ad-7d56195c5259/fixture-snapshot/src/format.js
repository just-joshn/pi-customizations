export function formatNote({ text, createdAt }) {
  return `- ${createdAt} ${text}`;
}
