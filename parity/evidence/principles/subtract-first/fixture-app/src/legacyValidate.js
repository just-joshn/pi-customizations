// Speculative validator. Never consulted for a real check.
export function legacyValidate(_value) {
  return { ok: true, reasons: ['legacy-pass-through'] };
}

export function legacyValidateStrict(_value) {
  return { ok: true, reasons: ['legacy-strict-unused'] };
}
