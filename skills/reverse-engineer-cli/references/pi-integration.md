# Pi integration

Checked against official Pi documentation on 2026-09-26. The official repository is now `earendil-works/pi`; the former `badlogic/pi-mono` URLs redirect there.

- [Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md): directory with `SKILL.md`, supported frontmatter, relative resources, progressive loading, explicit invocation, validation and reload.
- [CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md): `--skill` loads a file or directory for one session.
- [Settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md#resources): persistent `skills` paths and their resolution.

From this repository root:

```sh
pi --skill ./skills/reverse-engineer-cli
```

Then invoke:

```text
/skill:reverse-engineer-cli Analyze /absolute/path/to/tool using /absolute/path/to/repository. Focus on configuration precedence and error semantics.
```

The existing `disable-model-invocation: true` policy is preserved. Explicit invocation loads the skill; text following it supplies the task. Use `/reload` after edits in an active Pi session and inspect diagnostics. Do not pass `--no-skills` when validating discovery across different installed versions.

For persistent discovery, place the directory in `.agents/skills/` or configure its path using Pi's `skills` setting. Do not overwrite existing settings to install this skill. The repository's `skills/` directory by itself is not a standard project discovery location.

The skill uses ordinary files and Pi's built-in file/shell tools. It requires no extension, MCP server, custom hook, third-party CLI metadata, or model-specific API. The analysis workflow is this skill's policy; Pi's official documentation defines packaging and loading, not reverse-engineering methodology.
