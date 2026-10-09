export type UserId = string & { readonly __brand: "UserId" };

export function asUserId(raw: string): UserId {
  return raw as UserId;
}
