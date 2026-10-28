
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export const deepDiff = (left, right, path = '') => {
  const diffs = [];
  if (Object.is(left, right)) return diffs;
  if (typeof left !== typeof right || left === null || right === null || Array.isArray(left) !== Array.isArray(right)) {
    diffs.push({ path: path || '$', left, right, kind: 'type_or_null' });
    return diffs;
  }
  if (Array.isArray(left)) {
    if (left.length !== right.length) {
      diffs.push({ path: path || '$', left: `length ${left.length}`, right: `length ${right.length}`, kind: 'array_length' });
    }
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i += 1) {
      const child = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= left.length) diffs.push({ path: child, left: undefined, right: right[i], kind: 'missing_left' });
      else if (i >= right.length) diffs.push({ path: child, left: left[i], right: undefined, kind: 'missing_right' });
      else diffs.push(...deepDiff(left[i], right[i], child));
    }
    return diffs;
  }
  if (!isObject(left)) {
    if (left !== right) diffs.push({ path: path || '$', left, right, kind: 'value' });
    return diffs;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of [...keys].sort()) {
    const child = path ? `${path}.${key}` : key;
    if (!(key in left)) diffs.push({ path: child, left: undefined, right: right[key], kind: 'missing_left' });
    else if (!(key in right)) diffs.push({ path: child, left: left[key], right: undefined, kind: 'missing_right' });
    else diffs.push(...deepDiff(left[key], right[key], child));
  }
  return diffs;
};

export const pathAllowed = (diffPath, patterns) => {
  for (const pattern of patterns) {
    if (pattern === diffPath) return true;
    if (pattern.endsWith('.*') && (diffPath === pattern.slice(0, -2) || diffPath.startsWith(pattern.slice(0, -1)))) return true;
    if (pattern.endsWith('[*]') && diffPath.startsWith(pattern.slice(0, -3) + '[')) return true;
  }
  return false;
};
