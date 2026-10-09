export type UserId = string & { readonly __brand: 'UserId' };

export function asUserId(raw: string): UserId {
  if (raw.length === 0) throw new Error('UserId must be non-empty');
  return raw as UserId;
}
