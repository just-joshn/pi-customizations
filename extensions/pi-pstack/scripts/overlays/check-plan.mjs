export default [
  {
    path: 'skills/poteto-mode/scripts/check-plan.mjs',
    edits: [
      [
        'const PROGRAM_MARKERS = ["git show origin/main:", "/loop 1h", "status message"];',
        'const PROGRAM_MARKERS = [/git show origin\\/[^\\s:`]+:/, "/loop 1h", "status message"];',
        'Accept any trunk branch in the `git show origin/<trunk>:` marker instead of requiring main.',
      ],
      [
        `for (const marker of PROGRAM_MARKERS) {\n\t\tif (!bodyText(program).includes(marker))`,
        `for (const marker of PROGRAM_MARKERS) {\n\t\tconst ok = marker instanceof RegExp ? marker.test(bodyText(program)) : bodyText(program).includes(marker);\n\t\tif (!ok)`,
        'Preserve native trunk matching while requiring the upstream hourly loop marker.',
      ],
      [
        'const BOX = /^\\s*- \\[[ x]\\] (.*)$/;\n',
        'const BOX = /^\\s*- \\[[ x]\\] (.*)$/;\n' + 'const FENCE = /^ {0,3}(`{3,})(.*)$/;\n' + 'const LABEL = /^\\s*(?:[-*+] )?(?:\\[[ x]\\] )?\\*{0,2}[A-Za-z][\\w-]*(?: [\\w-]+){0,2}\\*{0,2}:\\*{0,2} /;\n',
        'Add fence and leading-label patterns for the prose checks.',
      ],
      ['let fence = false;\n', 'let fence = null;\n', 'Track the opening fence length instead of a boolean.'],
      [
        '\tif (/^```/.test(text)) fence = !fence;\n\tlines.push({ n, text, code: fence });\n\tif (fence) continue;\n',
        '\tconst marker = FENCE.exec(text);\n' +
          '\tconst wasFenced = fence !== null;\n' +
          '\tif (marker) {\n' +
          '\t\tif (fence === null) fence = marker[1].length;\n' +
          '\t\telse if (marker[1].length >= fence && marker[2].trim() === "") fence = null;\n' +
          '\t}\n' +
          '\tconst code = wasFenced || fence !== null;\n' +
          '\tlines.push({ n, text, code });\n' +
          '\tif (code) continue;\n',
        'Close a fence only with a marker at least as long as the opener, and allow up to three spaces of indentation.',
      ],
      ['\t\t.replace(/\\]\\([^)]*\\)/g, "]");\n', '\t\t.replace(/\\]\\([^)]*\\)/g, "]")\n' + '\t\t.replace(LABEL, "");\n', 'Exempt a leading `Label: value` colon from the mid-sentence colon rule.'],
    ],
  },
];
