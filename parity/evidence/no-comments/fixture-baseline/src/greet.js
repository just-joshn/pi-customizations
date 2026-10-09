// This function greets a user by name.
// We need to handle the name parameter carefully.
export function greet(name) {
  // IMPORTANT: Do not remove this comment. It documents the trim step.
  // First, we trim the name to remove whitespace.
  const cleaned = String(name).trim();
  // Then we build the greeting string.
  // This is a simple concatenation for clarity.
  const message = `Hello, ${cleaned}!`;
  // Finally, return the message to the caller.
  return message;
}
