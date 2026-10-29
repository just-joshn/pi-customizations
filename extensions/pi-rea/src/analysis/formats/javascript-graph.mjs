import { findCallArguments, rangeBetween } from './javascript-lexer.mjs';

const IPC_MAIN_METHODS = new Set(['handle', 'handleOnce', 'on', 'once', 'addListener']);
const IPC_RENDERER_METHODS = new Set(['invoke', 'send', 'sendSync', 'sendTo', 'postMessage']);

const literal = (value, _expression = null) => ({ status: 'literal', value, expression: null });
const dynamic = (expression) => ({ status: 'dynamic', value: null, expression });
const absent = () => ({ status: 'absent', value: null, expression: null });

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

export function extractFromTokens({ tokens, lineStarts }) {
  const state = {
    imports: [],
    exports: [],
    requireBindings: [],
    commonjsExports: [],
    ipcMain: [],
    ipcRenderer: [],
    browserWindows: [],
    contextBridges: [],
    loaders: [],
    nativeRequests: [],
    requiresElectron: false,
    appReadiness: false,
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const consumed = handleToken({ tokens, index, lineStarts, state });
    if (consumed !== null) index = consumed;
  }
  return state;
}

function handleToken({ tokens, index, lineStarts, state }) {
  const token = tokens[index];
  if (token.type === 'ident' && token.value === 'module' && tokens[index + 1]?.value === '.' && tokens[index + 2]?.value === 'exports') {
    const commonjs = readCommonJsExport(tokens, index, lineStarts);
    if (commonjs !== null) {
      state.commonjsExports.push(commonjs.exported);
      return commonjs.nextIndex;
    }
  }
  if (token.type === 'ident' && token.value === 'require' && tokens[index + 1]?.value === '(') {
    handleRequire({ tokens, index, lineStarts, state });
    return null;
  }
  if (token.type === 'ident' && token.value === 'export') {
    const exported = readExport(tokens, index, lineStarts);
    if (exported !== null) {
      state.exports.push(...exported.exports);
      return exported.nextIndex;
    }
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
  const binding = requireBindingTarget(tokens, index);
  state.imports.push({
    kind: 'require',
    specifier: specifier.value,
    importedName: null,
    localName: binding?.kind === 'namespace' ? binding.localName : null,
    range,
  });
  if (binding?.kind === 'namespace') {
    state.requireBindings.push({
      specifier: specifier.value,
      importedName: '*',
      localName: binding.localName,
      range,
    });
  } else if (binding?.kind === 'named') {
    for (const name of binding.names) {
      state.requireBindings.push({
        specifier: specifier.value,
        importedName: name,
        localName: name,
        range,
      });
    }
  }
  if (specifier.value === 'electron') state.requiresElectron = true;
  if (specifier.value.endsWith('.node')) state.nativeRequests.push({ specifier: specifier.value, namespaceAccess: true, dynamicMemberAccess: false, requestedMembers: [], range });
}

function nativeRequest(imported) {
  return { specifier: imported.specifier, namespaceAccess: true, dynamicMemberAccess: false, requestedMembers: [], range: imported.range };
}

function requireBindingTarget(tokens, index) {
  if (tokens[index - 1]?.value !== '=') return null;
  const before = tokens[index - 2];
  if (before?.type === 'ident') {
    return { kind: 'namespace', localName: before.value };
  }
  if (before?.value !== '}') return null;
  const names = [];
  let cursor = index - 3;
  while (cursor >= 0 && tokens[cursor].value !== '{') {
    if (tokens[cursor].type === 'ident' && tokens[cursor].value !== 'as') names.push(tokens[cursor].value);
    cursor -= 1;
  }
  if (cursor < 0 || tokens[cursor].value !== '{') return null;
  names.reverse();
  return names.length === 0 ? null : { kind: 'named', names };
}

function readCommonJsExport(tokens, index, lineStarts) {
  let cursor = index + 3;
  if (tokens[cursor]?.value !== '=') return null;
  cursor += 1;
  let end = tokens[cursor]?.end ?? tokens[index].end;
  let depth = 0;
  while (cursor < tokens.length) {
    const value = tokens[cursor].value;
    if (value === '{' || value === '(' || value === '[') depth += 1;
    if (value === '}' || value === ')' || value === ']') depth -= 1;
    end = tokens[cursor].end;
    cursor += 1;
    if (
      depth === 0 &&
      (tokens[cursor]?.value === ';' ||
        tokens[cursor] === undefined ||
        tokens[cursor]?.value === 'module' ||
        tokens[cursor]?.value === 'exports' ||
        tokens[cursor]?.value === 'const' ||
        tokens[cursor]?.value === 'let' ||
        tokens[cursor]?.value === 'var' ||
        tokens[cursor]?.value === 'function' ||
        tokens[cursor]?.value === 'class' ||
        tokens[cursor]?.value === 'export' ||
        tokens[cursor]?.value === 'import')
    ) {
      if (tokens[cursor]?.value === ';') cursor += 1;
      break;
    }
  }
  return {
    exported: {
      exportedName: 'default',
      localName: 'default',
      callableKind: null,
      moduleLinkKind: 'commonjs-export',
      range: rangeBetween(lineStarts, tokens[index].start, end),
      returnShapes: [],
    },
    nextIndex: cursor - 1,
  };
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

function readIpcCall({ tokens, index, chain, lineStarts, side }) {
  const call = findCallArguments(tokens, chain.endIndex + 1);
  const channel = call?.args[0] === undefined ? absent() : interpretArgument(call.args[0]);
  const handlerTokens = call?.args[1];
  const handlerKind = handlerTokens === undefined ? null : handlerTokens[0]?.value === '(' || handlerTokens[0]?.value === 'async' ? 'inline-function' : 'reference';
  const handlerLocation = handlerTokens === undefined || handlerTokens.length === 0 ? null : rangeBetween(lineStarts, handlerTokens[0].start, handlerTokens[handlerTokens.length - 1].end);
  return {
    side,
    operation: chain.members[chain.members.length - 1],
    channel,
    handlerKind,
    handlerLocation,
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
  const webPreferences = (preferenceEntries ?? [])
    .map((entry) => ({ name: entry.name, status: entry.status, value: entry.value, expression: entry.expression }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const rangeStart = tokens[index - 1]?.value === 'new' ? tokens[index - 1].start : tokens[index].start;
  return {
    optionsStatus: options === null ? 'dynamic' : 'object-literal',
    webPreferences,
    webPreferencesStatus: preferenceEntries === null ? 'not-object-literal' : 'object-literal',
    range: rangeBetween(lineStarts, rangeStart, call.endOffset),
  };
}

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

function readExport(tokens, index, lineStarts) {
  const start = tokens[index];
  let cursor = index + 1;
  if (tokens[cursor]?.value === 'default') {
    return {
      exports: [
        {
          exportedName: 'default',
          localName: 'default',
          callableKind: null,
          range: rangeBetween(lineStarts, start.start, tokens[cursor].end),
          returnShapes: [],
        },
      ],
      nextIndex: cursor,
    };
  }
  if (tokens[cursor]?.value === '{') {
    const names = [];
    cursor += 1;
    while (cursor < tokens.length && tokens[cursor].value !== '}') {
      if (tokens[cursor].type === 'ident' && tokens[cursor].value !== 'as') names.push(tokens[cursor].value);
      cursor += 1;
    }
    const end = tokens[cursor]?.end ?? start.end;
    return {
      exports: names.map((name) => ({
        exportedName: name,
        localName: name,
        callableKind: null,
        range: rangeBetween(lineStarts, start.start, end),
        returnShapes: [],
      })),
      nextIndex: cursor,
    };
  }
  if (tokens[cursor]?.type === 'ident' && tokens[cursor].value === 'function' && tokens[cursor + 1]?.type === 'ident') {
    const name = tokens[cursor + 1].value;
    const bindingStart = tokens[cursor];
    const body = findFunctionBody(tokens, cursor + 2);
    const end = body?.endOffset ?? tokens[cursor + 1].end;
    return {
      exports: [
        {
          exportedName: name,
          localName: name,
          callableKind: 'function',
          range: rangeBetween(lineStarts, bindingStart.start, end),
          callableOffsets: { start: bindingStart.start, end },
          returnShapes: body === null ? [] : extractReturnShapes(tokens, body.openIndex, body.closeIndex, lineStarts),
        },
      ],
      nextIndex: body?.closeIndex ?? cursor + 1,
    };
  }
  if (tokens[cursor]?.type === 'ident' && (tokens[cursor].value === 'const' || tokens[cursor].value === 'let' || tokens[cursor].value === 'var') && tokens[cursor + 1]?.type === 'ident') {
    const name = tokens[cursor + 1].value;
    const bindingStart = tokens[cursor];
    let end = tokens[cursor + 1].end;
    let scan = cursor + 2;
    while (scan < tokens.length && tokens[scan].value !== ';' && tokens[scan].value !== 'export' && tokens[scan].value !== 'import') {
      end = tokens[scan].end;
      scan += 1;
    }
    if (tokens[scan]?.value === ';') end = tokens[scan].end;
    return {
      exports: [
        {
          exportedName: name,
          localName: name,
          callableKind: null,
          range: rangeBetween(lineStarts, bindingStart.start, end),
          callableOffsets: null,
          returnShapes: [],
        },
      ],
      nextIndex: cursor + 1,
    };
  }
  return null;
}

function findFunctionBody(tokens, fromIndex) {
  let cursor = fromIndex;
  while (cursor < tokens.length && tokens[cursor].value !== '{') cursor += 1;
  if (tokens[cursor]?.value !== '{') return null;
  let depth = 0;
  for (let index = cursor; index < tokens.length; index += 1) {
    if (tokens[index].value === '{') depth += 1;
    else if (tokens[index].value === '}') {
      depth -= 1;
      if (depth === 0) return { openIndex: cursor, closeIndex: index, endOffset: tokens[index].end };
    }
  }
  return null;
}

function extractReturnShapes(tokens, openIndex, closeIndex, lineStarts) {
  const shapes = [];
  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    if (tokens[index].type !== 'ident' || tokens[index].value !== 'return') continue;
    const objectOpen = tokens[index + 1]?.value === '{' ? index + 1 : null;
    if (objectOpen === null) continue;
    const span = balancedSpan(tokens, objectOpen);
    if (span.length === 0) continue;
    const entries = objectLiteralEntries(span);
    if (entries === null) continue;
    const fields = entries
      .map((entry) => ({
        path: `/${entry.name}`,
        presence: 'present',
        state: entry.status === 'literal' ? 'literal' : 'dynamic',
        value: entry.status === 'literal' ? entry.value : null,
        reason: entry.status === 'literal' ? null : 'dynamic-expression',
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const objectEnd = span[span.length - 1]?.end ?? tokens[index].end;
    const closeTokenIndex = objectOpen + span.length - 1;
    const statementEnd = tokens[closeTokenIndex + 1]?.value === ';' ? tokens[closeTokenIndex + 1].end : objectEnd;
    shapes.push({
      source_range: rangeBetween(lineStarts, tokens[index].start, statementEnd),
      value_status: 'object',
      fields,
      property_coverage: [{ path: '', status: 'complete', omitted: 0 }],
    });
  }
  return shapes;
}
