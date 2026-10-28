export interface DerNode {
  readonly tag: number;
  readonly offset: number;
  readonly headerBytes: number;
  readonly length: number;
  readonly contentOffset: number;
  readonly end: number;
}

export const readDerNode = (bytes: Buffer, offset: number): DerNode => {
  if (offset >= bytes.length) throw new Error('truncated DER');
  const tag = bytes[offset]!;
  let cursor = offset + 1;
  if (cursor >= bytes.length) throw new Error('truncated DER length');
  const first = bytes[cursor]!;
  cursor += 1;
  let length = 0;
  if ((first & 0x80) === 0) length = first;
  else {
    const count = first & 0x7f;
    if (count === 0 || count > 4 || cursor + count > bytes.length) throw new Error('invalid DER length');
    for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[cursor + index]!;
    cursor += count;
  }
  const contentOffset = cursor;
  const end = contentOffset + length;
  if (end > bytes.length) throw new Error('truncated DER content');
  return { tag, offset, headerBytes: contentOffset - offset, length, contentOffset, end };
};

export const derChildren = (bytes: Buffer, node: DerNode): DerNode[] => {
  if ((node.tag & 0x20) === 0) return [];
  const children: DerNode[] = [];
  let cursor = node.contentOffset;
  while (cursor < node.end) {
    const child = readDerNode(bytes, cursor);
    children.push(child);
    cursor = child.end;
  }
  return children;
};

export const derOid = (bytes: Buffer, node: DerNode): string => {
  if (node.tag !== 0x06) throw new Error('expected OID');
  const body = bytes.subarray(node.contentOffset, node.end);
  if (body.length === 0) return '';
  const values = [Math.floor(body[0]! / 40), body[0]! % 40];
  let value = 0;
  for (let index = 1; index < body.length; index += 1) {
    value = (value << 7) | (body[index]! & 0x7f);
    if ((body[index]! & 0x80) === 0) {
      values.push(value);
      value = 0;
    }
  }
  return values.join('.');
};

export const derIntegerHex = (bytes: Buffer, node: DerNode): string => bytes.subarray(node.contentOffset, node.end).toString('hex');

export const derUtf8 = (bytes: Buffer, node: DerNode): string => {
  if (node.tag === 0x0c || node.tag === 0x13 || node.tag === 0x14 || node.tag === 0x16 || node.tag === 0x1e) {
    const raw = bytes.subarray(node.contentOffset, node.end);
    return node.tag === 0x1e ? raw.toString('utf16le') : raw.toString('utf8');
  }
  return bytes.subarray(node.contentOffset, node.end).toString('utf8');
};
