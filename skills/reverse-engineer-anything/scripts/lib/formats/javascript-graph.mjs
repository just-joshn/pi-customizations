import { findCallArguments, rangeBetween } from './javascript-lexer.mjs';

const IPC_MAIN_METHODS = new Set(['handle', 'handleOnce', 'on', 'once', 'addListener']);
const IPC_RENDERER_METHODS = new Set(['invoke', 'send', 'sendSync', 'sendTo', 'postMessage']);

const literal = (value, _expression = null) => ({ status: 'literal', value, expression: null });
const dynamic = (expression) => ({ status: 'dynamic', value: null, expression });
const absent = () => ({ status: 'absent', value: null, expression: null });

/** The receiver chain at a token index: `a.b.c` yields receiver `a`, members ['b','c']. */
export function chainAt(tokens, index) {
  const start = tokens[index];
  const members = [];
  let cursor = index;
  while (tokens[cursor + 1]?.value === '.' && tokens[cursor + 2]?.type === 'ident') {
    members.push(tokens[cursor + 2].value);
    cursor += 2;
  }
  return { receiver: start?.value ?? null, members, endIndex: cursor, start };
}

/** Interpret an argument span as a literal, a template, or something dynamic. */
export function interpretArgument(argTokens) {
  if (argTokens === undefined || argTokens.length === 0) return absent();
  const meaningful = argTokens.filter((token) => token.value !== '(' && token.value !== ')');
  if (meaningful.length === 1) {
    const token = meaningful[0];
    if (token.type === 'string') return token.dynamic ? dynamic(`\`${token.value}\``) : literal(token.value);
    if (token.type === 'number') return literal(Number(token.value));
    if (token.value === 'true') return literal(true);
    if (token.value === 'false') return literal(false);
    if (token.value === 'null') return literal(null);
    return dynamic(token.value);
  }
  return dynamic(meaningful.map((token) => token.value).join(''));
}

/** Top-level entries of an object literal argument: `{ preload: x, width: 900 }`. */
export function objectLiteralEntries(argTokens) {
  if (argTokens === undefined || argTokens[0]?.value !== '{') return null;
  const entries = [];
  let depth = 0;
  let current = [];
  let pendingKey = null;
  const flush = () => {
    if (current.length === 0) return;
    const value = interpretArgument(current);
    if (pendingKey !== null) entries.push({ name: pendingKey, ...value });
    current = [];
    pendingKey = null;
  };
  for (let index = 1; index < argTokens.length; index += 1) {
    const token = argTokens[index];
    if (token.value === '{' || token.value === '[' || token.value === '(') depth += 1;
    else if (token.value === '}' && depth === 0) {
      flush();
      break;
    } else if (token.value === '}' || token.value === ']' || token.value === ')') depth -= 1;
    else if (token.value === ',' && depth === 0) {
      flush();
      continue;
    } else if (token.value === ':' && depth === 0 && current.length > 0) {
      pendingKey = String(current[current.length - 1].value);
      current = [];
      continue;
    }
    current.push(token);
  }
  return entries;
}

export function objectLiteralKeys(argTokens) {
  const entries = objectLiteralEntries(argTokens);
  if (entries === null) return null;
  return entries.map((entry) => entry.name);
}

/**
 * Extract the static module, Electron and native-request facts from one file's
 * tokens. Every fact carries the source range it came from, because a candidate
 * without its range cannot be checked.
 */
export function extractFromTokens({ tokens, lineStarts }) {
  const state = { imports: [], ipcMain: [], ipcRenderer: [], browserWindows: [], contextBridges: [], loaders: [], nativeRequests: [], requiresElectron: false, appReadiness: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const consumed = handleToken({ tokens, index, lineStarts, state });
    if (consumed !== null) index = consumed;
  }
  return state;
}

function handleToken({ tokens, index, lineStarts, state }) {
  const token = tokens[index];
  if (token.type === 'ident' && token.value === 'require' && tokens[index + 1]?.value === '(') {
    handleRequire({ tokens, index, lineStarts, state });
    return null;
  }
  if (token.type === 'ident' && (token.value === 'import' || token.value === 'export')) {
    const found = readImport(tokens, index, lineStarts);
    if (found === null) return null;
    state.imports.push(found.import);
    if (found.import.specifier === 'electron') state.requiresElectron = true;
    if (found.import.specifier.endsWith('.node')) state.nativeRequests.push(nativeRequest(found.import));
    return found.nextIndex;
  }
  const chain = chainAt(tokens, index);
  if (chain.receiver === null) return null;
  return handleChain({ tokens, index, chain, lineStarts, state });
}

function handleRequire({ tokens, index, lineStarts, state }) {
  const call = findCallArguments(tokens, index + 1);
  const specifier = call?.args[0] === undefined ? absent() : interpretArgument(call.args[0]);
  if (specifier.status !== 'literal') return;
  const range = rangeBetween(lineStarts, tokens[index].start, call.endOffset);
  state.imports.push({ kind: 'require', specifier: specifier.value, importedName: null, localName: localRequireTarget(tokens, index), range });
  if (specifier.value === 'electron') state.requiresElectron = true;
  if (specifier.value.endsWith('.node')) state.nativeRequests.push({ specifier: specifier.value, namespaceAccess: true, dynamicMemberAccess: false, requestedMembers: [], range });
}

function nativeRequest(imported) {
  return { specifier: imported.specifier, namespaceAccess: true, dynamicMemberAccess: false, requestedMembers: [], range: imported.range };
}

function handleChain({ tokens, index, chain, lineStarts, state }) {
  const method = chain.members[chain.members.length - 1];
  if (tokens[index].value === 'app' && method === 'whenReady') state.appReadiness = true;
  if (chain.members.length === 1 && chain.receiver === 'ipcMain' && IPC_MAIN_METHODS.has(method)) {
    state.ipcMain.push(readIpcCall({ tokens, index, chain, lineStarts, side: 'main' }));
    return null;
  }
  if (chain.members.length === 1 && chain.receiver === 'ipcRenderer' && IPC_RENDERER_METHODS.has(method)) {
    state.ipcRenderer.push(readIpcCall({ tokens, index, chain, lineStarts, side: 'renderer' }));
    return null;
  }
  if (chain.members.length === 1 && chain.receiver === 'contextBridge' && chain.members[0] === 'exposeInMainWorld') {
    const bridge = readContextBridge({ tokens, index, chain, lineStarts });
    if (bridge !== null) state.contextBridges.push(bridge);
    return null;
  }
  if (tokens[index].value === 'BrowserWindow' && tokens[index - 1]?.value === 'new') {
    const window = readBrowserWindow({ tokens, index, lineStarts });
    if (window !== null) state.browserWindows.push(window);
    return null;
  }
  if (method === 'loadFile' || method === 'loadURL') {
    const call = findCallArguments(tokens, chain.endIndex + 1);
    if (call !== null) state.loaders.push({ kind: method, target: interpretArgument(call.args[0]), range: rangeBetween(lineStarts, tokens[index].start, call.endOffset) });
  }
  return null;
}

function localRequireTarget(tokens, index) {
  const before = tokens[index - 1];
  if (before?.value !== '=') return null;
  const name = tokens[index - 2];
  return name?.type === 'ident' ? name.value : null;
}

function readIpcCall({ tokens, index, chain, lineStarts, side }) {
  const call = findCallArguments(tokens, chain.endIndex + 1);
  const channel = call?.args[0] === undefined ? absent() : interpretArgument(call.args[0]);
  return {
    side,
    operation: chain.members[chain.members.length - 1],
    channel,
    handlerKind: call?.args[1] === undefined ? null : call.args[1][0]?.value === '(' ? 'inline-function' : 'reference',
    range: rangeBetween(lineStarts, tokens[index].start, call?.endOffset ?? tokens[chain.endIndex].end),
  };
}

function readContextBridge({ tokens, index, chain, lineStarts }) {
  const call = findCallArguments(tokens, chain.endIndex + 1);
  if (call === null) return null;
  const key = call.args[0] === undefined ? absent() : interpretArgument(call.args[0]);
  const members = call.args[1] === undefined ? null : objectLiteralKeys(call.args[1]);
  return {
    apiKey: key,
    apiStatus: members === null ? 'dynamic' : 'object-literal',
    members: members ?? [],
    unknownMembers: members === null ? 1 : 0,
    range: rangeBetween(lineStarts, tokens[index].start, call.endOffset),
  };
}

function readBrowserWindow({ tokens, index, lineStarts }) {
  const call = findCallArguments(tokens, index + 1);
  if (call === null) return null;
  const optionsTokens = call.args[0] ?? null;
  const options = optionsTokens === null ? null : objectLiteralEntries(optionsTokens);
  const preferenceTokens = optionsTokens === null ? null : findNestedObjectTokens(optionsTokens, 'webPreferences');
  const preferenceEntries = preferenceTokens === null ? null : objectLiteralEntries(preferenceTokens);
  const webPreferences = (preferenceEntries ?? []).map((entry) => ({ name: entry.name, status: entry.status, value: entry.value, expression: entry.expression }));
  return {
    optionsStatus: options === null ? 'dynamic' : 'object-literal',
    webPreferences,
    webPreferencesStatus: preferenceEntries === null ? 'not-object-literal' : 'object-literal',
    range: rangeBetween(lineStarts, tokens[index].start, call.endOffset),
  };
}

/** The balanced token span of a nested object literal assigned to `key`. */
function findNestedObjectTokens(argTokens, key) {
  let depth = 0;
  for (let index = 0; index < argTokens.length; index += 1) {
    const token = argTokens[index];
    if (token.value === '{' || token.value === '[' || token.value === '(') depth += 1;
    else if (token.value === '}' || token.value === ']' || token.value === ')') depth -= 1;
    if (depth === 1 && token.type === 'ident' && token.value === key && argTokens[index + 1]?.value === ':') {
      const open = argTokens.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.value === '{');
      return open < 0 ? null : balancedSpan(argTokens, open);
    }
  }
  return null;
}

function balancedSpan(tokens, openIndex) {
  let depth = 0;
  const collected = [];
  for (let cursor = openIndex; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor].value === '{') depth += 1;
    else if (tokens[cursor].value === '}') depth -= 1;
    collected.push(tokens[cursor]);
    if (depth === 0) return collected;
  }
  return collected;
}

function readImport(tokens, index, lineStarts) {
  const start = tokens[index];
  let cursor = index + 1;
  let importedName = null;
  let localName = null;
  if (tokens[cursor]?.type === 'ident' && tokens[cursor + 1]?.value === 'from') {
    localName = tokens[cursor].value;
    cursor += 1;
  }
  if (tokens[cursor]?.value === '{') {
    const names = [];
    cursor += 1;
    while (cursor < tokens.length && tokens[cursor].value !== '}') {
      if (tokens[cursor].type === 'ident' && tokens[cursor].value !== 'as') names.push(tokens[cursor].value);
      cursor += 1;
    }
    importedName = names[0] ?? null;
    cursor += 1;
  }
  if (tokens[cursor]?.value === '*') {
    importedName = '*';
    cursor += 1;
    if (tokens[cursor]?.value === 'as') cursor += 2;
  }
  if (tokens[cursor]?.value === 'from') cursor += 1;
  let specifierToken = tokens[cursor];
  let kind = 'import';
  if (specifierToken?.value === '(') {
    specifierToken = tokens[cursor + 1];
    kind = 'dynamic-import';
  }
  if (specifierToken?.type !== 'string') return null;
  const end = tokens[cursor]?.end ?? specifierToken.end;
  return {
    import: { kind, specifier: specifierToken.value, importedName, localName, range: rangeBetween(lineStarts, start.start, end) },
    nextIndex: cursor,
  };
}
