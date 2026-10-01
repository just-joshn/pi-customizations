export default [
  {
    path: 'skills/show-me-your-work/scripts/log.sh',
    edits: [
      [
        '# Use `>>` here, never `>`. A network mount can fail this test for a log\n' + '# that exists. Then the cost is one stray header line, not the rows.\n' + 'if [ ! -s "$logfile" ]; then',
        '# Serialize writers so two first writers cannot both write the header. A lock\n' +
          '# older than ten seconds belongs to a killed writer and is taken over.\n' +
          'lockdir="$logfile.lock"\n' +
          'tries=0\n' +
          'until mkdir "$lockdir" 2>/dev/null; do\n' +
          '\ttries=$((tries + 1))\n' +
          '\tif [ "$tries" -gt 200 ]; then rmdir "$lockdir" 2>/dev/null || true; tries=0; fi\n' +
          '\tsleep 0.05\n' +
          'done\n' +
          'trap \'rmdir "$lockdir" 2>/dev/null || true\' EXIT\n\n' +
          '# Use `>>` here, never `>`. A network mount can fail this test for a log\n' +
          '# that exists. Then the cost is one stray header line, not the rows.\n' +
          'if [ ! -s "$logfile" ]; then',
        'Take a mkdir lock around the header test and the append so concurrent first writers write one header.',
      ],
      ['\tcase "$v" in\n', '\tcase "${v#"${v%%[![:space:]]*}"}" in\n', 'Guard on the first non-blank character so leading whitespace cannot hide a formula prefix.'],
    ],
  },
];
