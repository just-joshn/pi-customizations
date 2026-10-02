export const resultTextLimit = 100000;

export function capResultText(text: string): string {
  return text.length > resultTextLimit ? text.slice(0, resultTextLimit) : text;
}
