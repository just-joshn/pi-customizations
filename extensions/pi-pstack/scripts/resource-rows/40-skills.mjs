const skill = (name) => new RegExp(`^skills/${name}/SKILL\\.md$`);

export default [
  [
    /^skills\/reflect\/references\/synthesizer\.md$/,
    '- "path-shaped triggers belong in `paths:`, not description prose"',
    '- "Use directory-scoped `AGENTS.md` for persistent context and imperative descriptions or `/skill:name` for on-demand skills."',
    'Map path-shaped guidance to Pi context files and native on-demand skill routing.',
  ],
  [skill('why'), '(open files, recent edits, cursor location, what was just discussed)', '(available file context, recent edits, what was just discussed)', 'Use available file context without assuming Pi exposes editor cursor metadata.'],
  [
    skill('automate-me'),
    'This skill orchestrates three others: an inline mining pass (see step 1), the `create-skill` skill (authoring), and the **unslop** skill (prose discipline).',
    'This skill orchestrates two skills and an inline pass. The inline pass mines the history (see step 1). The skills are the `create-skill` skill (authoring) and the **unslop** skill (prose discipline).',
    'Count the inline mining pass separately from the skills.',
  ],
  [
    skill('principle-experience-first'),
    'Foundational thinking governs the *sequence* of work.',
    '[Foundational thinking](../principle-foundational-thinking/SKILL.md) governs the *sequence* of work.',
    'Link the principle that the leaf names.',
  ],
  [/^skills\/typescript-best-practices\/references\/patterns\.md$/, "Match the `readonly __brand: 'X'` shape.", 'Match the `readonly __brand: "X"` shape.', 'Use the double-quote style that the code and the rule table use.'],
  [
    skill('how'),
    'without the explorer-findings section.',
    'without the explorer-findings section. Drop the sentence that begins "Multiple explorer agents have traced", the paragraph that begins "The explorers each investigated", and the sentence "The explorers did the work, so you shouldn\'t need to re-explore from scratch." No explorer ran, so the explainer explores for itself.',
    'Remove explorer wording from the simple-path explainer prompt.',
  ],
  [skill('arena'), 'per the Laziness Protocol', 'per the **laziness-protocol** principle skill', 'Name the principle skill so the reference is greppable.'],
  [
    skill('reflect'),
    "The system prompt names the active workspace's Pi session directory. Use that path. Do not glob across `~/.pi/agent/sessions/*/`. That crosses workspace boundaries and reads private chats from unrelated projects.",
    'The host contract names this session\'s transcript file ("This session transcript is ..."). Use that exact path. When it says the session is in memory, or when you need an earlier session in this workspace, call `pstack_context({ history: true })` and use only its matching transcript paths. Do not glob the Pi session storage directory. It can hold other workspaces, and reading it crosses workspace boundaries and reads private chats from unrelated projects.',
    'Use the exact transcript path the host contract names instead of globbing the shared session directory.',
  ],
  [
    skill('reflect'),
    "For each candidate, read the first JSONL line whose `message.role` is `user` and check that its `message.content` (a string, or the `text` of its first text block) contains the conversation's opening user prompt. Take the matching path.",
    "Check that the chosen file's first user line (the first JSONL line whose `message.role` is `user`, with `message.content` a string or the `text` of its first text block) contains the conversation's opening user prompt. Take the matching path.",
    'Verify the named transcript instead of scanning candidates.',
  ],
  [
    skill('teach'),
    "reach for the image-generation tool and draw it marker-on-whiteboard style with a few short labels, since image models garble long text. Generate that picture, don't settle for describing it in words.",
    "reach for an image tool only when the host contract names one. Pi registers no image-generation tool, so otherwise draw it as an SVG or mermaid sketch with a few short labels and say that you substituted it for an image. Keep labels short, since long text garbles. Produce that picture, don't settle for describing it in words.",
    'Name a fallback because Pi registers no image-generation tool.',
  ],
  [
    skill('deslop'),
    'Keep the final summary concise (1-3 sentences).',
    'Keep the final summary concise (1-3 sentences) and end it with a receipt of files touched and edits per focus area, for example `3 files; comments 4, defensive checks 1, any casts 0, nesting 2, other 0`.',
    'Make the deslop result a countable receipt.',
  ],
];
