const hexVal = (c) =>
  c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;

// Byte at s[i] === '%' followed by two hex digits, or -1.
function byteAt(s, i) {
  if (s.charCodeAt(i) !== 37) return -1;
  const h = hexVal(s.charCodeAt(i + 1));
  const l = hexVal(s.charCodeAt(i + 2));
  return h < 0 || l < 0 ? -1 : (h << 4) | l;
}

// Decode s[start, end): '+' -> space, %XX as UTF-8 bytes; malformed kept literally.
function decode(s, start, end) {
  let out = '';
  let run = start;
  let i = start;
  while (i < end) {
    const c = s.charCodeAt(i);
    if (c === 43) {
      out += s.slice(run, i) + ' ';
      run = ++i;
      continue;
    }
    if (c !== 37) {
      i++;
      continue;
    }
    const b = i + 2 < end ? byteAt(s, i) : -1;
    if (b < 0) {
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let min = 0;
    if (b < 0x80) { cp = b; }
    else if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; min = 0x10000; }
    else { i++; continue; }
    let j = i + 3;
    let ok = true;
    for (let k = 0; k < need; k++, j += 3) {
      const cb = j + 2 < end ? byteAt(s, j) : -1;
      if (cb < 0 || (cb & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (cb & 0x3f);
    }
    if (ok && need > 0 && (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) ok = false;
    if (!ok) { i++; continue; }
    out += s.slice(run, i) + String.fromCodePoint(cp);
    i = run = j;
  }
  return out + s.slice(run, end);
}

export function parseQuery(qs) {
  const result = Object.create(null);
  if (typeof qs !== 'string' || qs.length === 0) return result;
  const n = qs.length;
  let pos = qs.charCodeAt(0) === 63 ? 1 : 0;
  let keyEnd = -1; // index of first '=' in current pair, -1 if none
  let start = pos;
  for (let i = pos; i <= n; i++) {
    const c = i < n ? qs.charCodeAt(i) : 38;
    if (c === 61) {
      if (keyEnd < 0) keyEnd = i;
    } else if (c === 38) {
      if (i > start) {
        const key = decode(qs, start, keyEnd < 0 ? i : keyEnd);
        const value = keyEnd < 0 ? '' : decode(qs, keyEnd + 1, i);
        const list = result[key];
        if (list) list.push(value);
        else result[key] = [value];
      }
      start = i + 1;
      keyEnd = -1;
    }
  }
  return result;
}
