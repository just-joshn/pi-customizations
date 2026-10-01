export default [
  {
    path: 'skills/poteto-mode/scripts/check-plan.mjs',
    edits: [
      [
        'const PROGRAM_MARKERS = ["/goal", "git show origin/main:", /30[- ]minute/, "status message"];',
        'const PROGRAM_MARKERS = ["/goal", /git show origin\\/[^\\s:`]+:/, /30[- ]minute/, "status message"];',
        'Accept any trunk branch in the `git show origin/<trunk>:` marker instead of requiring main.',
      ],
      [
        'const BOX = /^\\s*- \\[[ x]\\] (.*)$/;\n',
        'const BOX = /^\\s*- \\[[ x]\\] (.*)$/;\n' +
          'const FENCE = /^ {0,3}(`{3,})(.*)$/;\n' +
          'const LABEL = /^\\s*(?:[-*+] )?(?:\\[[ x]\\] )?\\*{0,2}[A-Za-z][\\w-]*(?: [\\w-]+){0,2}\\*{0,2}:\\*{0,2} /;\n',
        'Add fence and leading-label patterns for the prose checks.',
      ],
      [
        'let fence = false;\n',
        'let fence = null;\n',
        'Track the opening fence length instead of a boolean.',
      ],
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
      [
        '\t\t.replace(/\\]\\([^)]*\\)/g, "]");\n',
        '\t\t.replace(/\\]\\([^)]*\\)/g, "]")\n' +
          '\t\t.replace(LABEL, "");\n',
        'Exempt a leading `Label: value` colon from the mid-sentence colon rule.',
      ],
    ],
  },
];
