import { describe, expect, it } from 'vitest';
import type { RoleRow, UpstreamDocument } from '../parity/theme.ts';
import { buildTheme, parseRoleMap, readThemeSchema, resolveRow, resolveScope, themeSchemaPath } from '../parity/theme.ts';

const document: UpstreamDocument = {
  name: 'fixture',
  colors: {
    'editor.foreground': '#AABBCC',
    surface: '#101010',
    tint: '#7F848E60',
    overlay: '#FF000080',
    broken: 'rebeccapurple',
  },
  tokenColors: [
    { scope: 'keyword', settings: { foreground: '#111111' } },
    { scope: 'string', settings: {} },
    {
      scope: ['meta.embedded', 'markup.raw'],
      settings: { foreground: '#555555' },
    },
    {
      scope: 'support.function, support.constant',
      settings: { foreground: '#666666' },
    },
    { scope: 'keyword.operator', settings: { foreground: '#777777' } },
    { scope: 'string', settings: { foreground: '#333333' } },
    { scope: '', settings: { foreground: '#dddddd' } },
    {
      scope: 'markup.heading punctuation.definition.heading',
      settings: { foreground: '#aaaaaa' },
    },
    {
      scope: 'punctuation.definition.heading',
      settings: { foreground: '#999999' },
    },
    { scope: 'constant.numeric', settings: { foreground: '#D19A66' } },
    { scope: 'odd.scope', settings: { foreground: 'currentColor' } },
    { scope: 'variable', settings: {} },
  ],
};

const row = (fields: Partial<RoleRow> & Pick<RoleRow, 'role' | 'kind' | 'source'>): RoleRow => ({
  base: '',
  why: 'fixture',
  ...fields,
});

describe('resolveScope', () => {
  it('returns the color the rule names', () => {
    expect(resolveScope(document, 'keyword')).toBe('#111111');
  });

  it('skips a rule without a foreground', () => {
    expect(resolveScope(document, 'string')).toBe('#333333');
  });

  it('matches the scope a rule names exactly', () => {
    expect(resolveScope(document, 'keyword.operator')).toBe('#777777');
  });

  it('does not match a rule that only extends the name', () => {
    expect(() => resolveScope(document, 'keyword.operator.assignment')).toThrow('no upstream token rule names the scope "keyword.operator.assignment"');
  });

  it('ignores a multi-name selector holding the name', () => {
    expect(resolveScope(document, 'punctuation.definition.heading')).toBe('#999999');
  });

  it('reads a comma-separated scope field', () => {
    expect(resolveScope(document, 'support.function')).toBe('#666666');
    expect(resolveScope(document, 'support.constant')).toBe('#666666');
  });

  it('reads an array scope field', () => {
    expect(resolveScope(document, 'meta.embedded')).toBe('#555555');
    expect(resolveScope(document, 'markup.raw')).toBe('#555555');
  });

  it('lowercases the foreground', () => {
    expect(resolveScope(document, 'constant.numeric')).toBe('#d19a66');
  });

  it('rejects an empty scope path', () => {
    expect(() => resolveScope(document, '')).toThrow('must not be empty');
  });

  it('rejects a parent-scope selector', () => {
    expect(() => resolveScope(document, 'markup.heading punctuation.definition.heading')).toThrow('must be one scope name');
  });

  it('refuses a scope two rules color differently', () => {
    const contested: UpstreamDocument = {
      ...document,
      tokenColors: [
        { scope: 'keyword', settings: { foreground: '#111111' } },
        { scope: 'keyword', settings: { foreground: '#222222' } },
      ],
    };
    expect(() => resolveScope(contested, 'keyword')).toThrow('upstream names the scope "keyword" more than once with different colors (#111111, #222222)');
  });

  it('accepts a scope two rules color the same way', () => {
    const agreeing: UpstreamDocument = {
      ...document,
      tokenColors: [
        { scope: 'keyword', settings: { foreground: '#111111' } },
        { scope: 'keyword', settings: { foreground: '#111111' } },
      ],
    };
    expect(resolveScope(agreeing, 'keyword')).toBe('#111111');
  });

  it('names the missing scope in the error', () => {
    expect(() => resolveScope(document, 'nothing.matches.this')).toThrow('no upstream token rule names the scope "nothing.matches.this"');
  });
});

describe('resolveRow', () => {
  it('reads a color row', () => {
    expect(resolveRow(document, row({ role: 'text', kind: 'color', source: 'editor.foreground' }))).toBe('#aabbcc');
  });

  it('resolves a scope row through the token rules', () => {
    expect(resolveRow(document, row({ role: 'keyword', kind: 'scope', source: 'keyword' }))).toBe('#111111');
  });

  it('composites a translucent color over its base', () => {
    const composite = row({
      role: 'overlay',
      kind: 'composite',
      source: 'overlay',
      base: 'surface',
    });
    expect(resolveRow(document, composite)).toBe('#880808');
  });

  it('throws when a color row names a missing key', () => {
    const missing = row({
      role: 'ghost',
      kind: 'color',
      source: 'no.such.key',
    });
    expect(() => resolveRow(document, missing)).toThrow('role ghost: upstream colors has no key "no.such.key"');
  });

  it('throws when an upstream value is not a hex color', () => {
    const broken = row({ role: 'broken', kind: 'color', source: 'broken' });
    expect(() => resolveRow(document, broken)).toThrow('upstream value "rebeccapurple"');
  });

  it('throws when a composite source has no alpha byte', () => {
    const opaque = row({
      role: 'opaque',
      kind: 'composite',
      source: 'editor.foreground',
      base: 'surface',
    });
    expect(() => resolveRow(document, opaque)).toThrow('needs an alpha byte');
  });

  it('throws when a composite base names a missing key', () => {
    const orphan = row({
      role: 'orphan',
      kind: 'composite',
      source: 'overlay',
      base: 'no.such.base',
    });
    expect(() => resolveRow(document, orphan)).toThrow('role orphan: upstream colors has no key "no.such.base"');
  });

  it('throws when a resolved scope value is not a color', () => {
    const odd = row({ role: 'odd', kind: 'scope', source: 'odd.scope' });
    expect(() => resolveRow(document, odd)).toThrow('resolved value "currentcolor" is not a color');
  });
});

describe('parseRoleMap', () => {
  const header = ['role', 'kind', 'source', 'base', 'why'].join('\t');

  it('reads data rows after skipping the header', () => {
    const text = `${header}\naccent\tcolor\tkey\t\twhy one\nshadow\tcomposite\tkey2\tbase2\twhy two\n`;
    expect(parseRoleMap(text)).toEqual([
      {
        role: 'accent',
        kind: 'color',
        source: 'key',
        base: '',
        why: 'why one',
      },
      {
        role: 'shadow',
        kind: 'composite',
        source: 'key2',
        base: 'base2',
        why: 'why two',
      },
    ]);
  });

  it('rejects a row with four fields', () => {
    expect(() => parseRoleMap('accent\tcolor\tkey\twhy')).toThrow('role map line 1: expected 5 tab-separated fields, found 4');
  });

  it('rejects a translucent composite base', () => {
    expect(() =>
      buildTheme(document, [
        row({
          role: 'selectedBg',
          kind: 'composite',
          source: 'tint',
          base: 'tint',
        }),
      ]),
    ).toThrow('role selectedBg: composite base "#7F848E60" must be #rrggbb');
  });

  it('rejects an empty role', () => {
    expect(() => parseRoleMap('\tcolor\tkey\t\twhy')).toThrow('role map line 1: empty role');
  });

  it('rejects an unknown kind', () => {
    expect(() => parseRoleMap('accent\thue\tkey\t\twhy')).toThrow('role map line 1 (accent): "hue" is not a role kind');
  });

  it('rejects an empty source', () => {
    expect(() => parseRoleMap('accent\tcolor\t\t\twhy')).toThrow('role map line 1 (accent): empty source');
  });

  it('rejects a base on a non-composite row', () => {
    expect(() => parseRoleMap('accent\tcolor\tkey\tbase\twhy')).toThrow('base is only allowed on composite rows');
  });

  it('rejects a composite row without a base', () => {
    expect(() => parseRoleMap('accent\tcomposite\tkey\t\twhy')).toThrow('composite rows need a base');
  });

  it('rejects an empty why', () => {
    expect(() => parseRoleMap('accent\tcolor\tkey\t\t')).toThrow('role map line 1 (accent): empty why');
  });

  it('rejects a duplicate role', () => {
    expect(() => parseRoleMap('accent\tcolor\tkey\t\twhy\naccent\tcolor\tother\t\twhy')).toThrow('role map line 2 (accent): duplicate role');
  });

  it('reports the file line number after the header', () => {
    const text = `${header}\naccent\tcolor\tkey\t\twhy\naccent\tcolor\tother\t\twhy`;
    expect(() => parseRoleMap(text)).toThrow('role map line 3 (accent): duplicate role');
  });
});

describe('readThemeSchema', () => {
  const schema = {
    properties: {
      colors: {
        required: ['accent'],
        properties: { accent: {}, thinkingMax: {} },
      },
      export: { properties: { pageBg: {} } },
    },
  };

  it('separates required schema colors from optional ones', () => {
    expect(readThemeSchema(schema)).toEqual({
      required: ['accent'],
      optional: ['thinkingMax'],
      exportProps: ['pageBg'],
    });
  });

  it('rejects a schema that is not an object', () => {
    expect(() => readThemeSchema('nope')).toThrow('theme schema must be an object');
  });

  it('rejects a schema without a properties object', () => {
    expect(() => readThemeSchema({})).toThrow('theme schema properties must be an object');
  });

  it('rejects a schema without color properties', () => {
    expect(() => readThemeSchema({ properties: { colors: { required: ['accent'] } } })).toThrow('theme schema colors.properties must be an object');
  });

  it('rejects a required list that is not all strings', () => {
    const broken = {
      properties: {
        colors: { required: ['accent', 7], properties: { accent: {} } },
        export: { properties: {} },
      },
    };
    expect(() => readThemeSchema(broken)).toThrow('theme schema colors.required must be an array of strings');
  });

  it('rejects a required color with no property', () => {
    const broken = {
      properties: {
        colors: { required: ['ghost'], properties: {} },
        export: { properties: {} },
      },
    };
    expect(() => readThemeSchema(broken)).toThrow('required color "ghost" without a property');
  });

  it('rejects a schema without an export section', () => {
    expect(() =>
      readThemeSchema({
        properties: { colors: { required: [], properties: {} } },
      }),
    ).toThrow('theme schema export must be an object');
  });
});

describe('themeSchemaPath', () => {
  it('builds the vendored pi schema path', () => {
    expect(themeSchemaPath('/tmp/pkg')).toBe('/tmp/pkg/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json');
  });
});

describe('buildTheme', () => {
  const rows: readonly RoleRow[] = [
    row({ role: 'text', kind: 'color', source: 'editor.foreground' }),
    row({
      role: 'selectedBg',
      kind: 'composite',
      source: 'tint',
      base: 'surface',
    }),
    row({ role: 'export.pageBg', kind: 'color', source: 'surface' }),
    row({ role: 'export.cardBg', kind: 'color', source: 'editor.foreground' }),
  ];

  it('splits export roles out of colors and sorts both', () => {
    const theme = buildTheme(document, rows);
    expect(theme).toEqual({
      $schema: 'https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json',
      name: 'one-dark-pro-flat',
      appearance: 'dark',
      colors: { selectedBg: '#3a3c3f', text: '#aabbcc' },
      export: { cardBg: '#aabbcc', pageBg: '#101010' },
    });
    expect(Object.keys(theme.colors)).toEqual(['selectedBg', 'text']);
    expect(Object.keys(theme.export)).toEqual(['cardBg', 'pageBg']);
  });

  it('rejects a duplicate target key', () => {
    const duplicate = [row({ role: 'text', kind: 'color', source: 'surface' }), row({ role: 'text', kind: 'color', source: 'surface' })];
    expect(() => buildTheme(document, duplicate)).toThrow('role text: duplicate target key "text"');
  });

  it('rejects a translucent composite base', () => {
    expect(() =>
      buildTheme(document, [
        row({
          role: 'selectedBg',
          kind: 'composite',
          source: 'tint',
          base: 'tint',
        }),
      ]),
    ).toThrow('role selectedBg: composite base "#7F848E60" must be #rrggbb');
  });

  it('rejects an empty role', () => {
    expect(() => buildTheme(document, [row({ role: '', kind: 'color', source: 'surface' })])).toThrow('role must not be empty');
  });

  it('rejects a role with whitespace', () => {
    expect(() => buildTheme(document, [row({ role: 'two words', kind: 'color', source: 'surface' })])).toThrow('must not contain whitespace');
  });

  it('rejects an export role with no property name', () => {
    expect(() => buildTheme(document, [row({ role: 'export.', kind: 'color', source: 'surface' })])).toThrow('needs a property name');
  });
});
