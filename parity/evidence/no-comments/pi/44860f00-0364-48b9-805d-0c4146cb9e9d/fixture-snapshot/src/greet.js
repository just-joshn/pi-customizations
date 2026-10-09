export function greet(name) {
  const cleaned = String(name).trim();
  const message = `Hello, ${cleaned}!`;
  return message;
}
