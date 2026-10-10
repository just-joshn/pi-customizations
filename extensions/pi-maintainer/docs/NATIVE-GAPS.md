# Native gaps

Every custom adapter in pi-maintainer, with the eight answers that `extensions/AGENTS.md` requires before custom logic is added. The answers are, in order: the exact required behavior, the Pi mechanism evaluated, why the public API cannot express the requirement, why omitting the behavior is unacceptable, the smallest adapter, the Pi-owned state that stays authoritative, the verification, and the condition for deleting the adapter.

All citations refer to installed Pi 1.1.0 under `CA` = `@earendil-works/pi-coding-agent/` and to the Aider checkout at `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`.

## Settings

### Option files and environment variables

1. **Behavior.** Aider resolves each option from the command line, then `AIDER_<NAME>`, then `.aider.conf.yml` in the home directory, the Git root, and the working directory (later files win), then an explicit `--config` file above those, then the argparse default (`aider/main.py:464-501`, configargparse `parse_known_args`). pi-maintainer applies the same order with `PI_MAINTAINER_<NAME>` and `.pi-maintainer.conf.yml`.
2. **Mechanism evaluated.** `pi.registerFlag` and `pi.getFlag` for the command line; `pi.getSettings()` for settings.
3. **Why it cannot.** `pi.getSettings()` returns Pi's own merged settings (`CA/dist/core/extensions/types.d.ts:1262`). There is no extension settings namespace, no `registerSettings`, no environment-variable binding, and no Git-root settings layer.
4. **Why not omit.** Aider users configure edit format, dry run, encoding, files, and every later SAR's options through these files and variables. Without them, a configured Aider setup has no equivalent.
5. **Adapter.** `src/settings/`: `config-files.ts` finds the files and parses YAML with PyYAML's scalar typing (`yaml-values.ts`), `sources.ts` converts each source the way configargparse's `convert_item_to_command_line_arg` does, and `resolve.ts` picks the highest-precedence valid value per option.
6. **Authoritative Pi state.** Pi's CLI parsing and flag registry. The adapter reads flags only through `pi.getFlag`, and never reads `process.argv`.
7. **Verification.** `test/settings/settings.oracle.test.ts` runs 52 resolution cases through Aider's own `get_parser` and configargparse with real home, Git-root, and working-directory files, and 12 YAML typing cases through configargparse's `YAMLConfigFileParser`. Reversing the file precedence fails 5 of them.
8. **Delete when.** Pi offers extension-owned settings with environment and project-root layers, or the operator drops Aider's configuration surface.

### `.env` files

1. **Behavior.** Aider loads `.env` from the home directory, the Git root, the working directory, and `--env-file` (default `<git root>/.env`), later files overriding earlier ones and duplicates keeping their last place, with python-dotenv's grammar and `${VAR}` interpolation (`aider/main.py:305-388`). The values feed the second option parse.
2. **Mechanism evaluated.** None in Pi. Pi reads provider credentials itself and offers no dotenv loading to extensions.
3. **Why it cannot.** No Pi API loads `.env` files for an extension.
4. **Why not omit.** `PI_MAINTAINER_*` variables in a project `.env` are a documented way to configure Aider, and the operator decision in `docs/ARCHITECTURE.md` requires them.
5. **Adapter.** `src/settings/dotenv.ts` ports python-dotenv's parser and `resolve_variables`. `load.ts` applies the files to a copy of the environment.
6. **Authoritative Pi state.** Pi's `process.env`. The adapter never writes it, because Aider's `load_dotenv(override=True)` would replace provider credentials that Pi owns. This is a deliberate adaptation: `.env` values reach option resolution and the environment of commands pi-maintainer runs, not Pi.
7. **Verification.** 22 python-dotenv cases and 5 `generate_search_path_list` cases in `test/settings/settings.oracle.test.ts`; `test/settings/load.test.ts` proves `process.env` is untouched.
8. **Delete when.** Pi loads project `.env` files for extensions.

### Flag spellings Pi cannot express

`pi.registerFlag` accepts `boolean` or `string` flags. `CA/dist/cli/args.js:241-255` stores every unknown long flag in a `Map`, so one name keeps one value and distinct names lose their relative order. Each Aider option kind below needs a small adapter in `src/settings/sources.ts`, and each adapter is verified in `test/settings/load.test.ts`.

| Aider kind | Example | What Pi does | Adapter |
| --- | --- | --- | --- |
| `BooleanOptionalAction` | `--dry-run`, `--no-dry-run` | Two unrelated boolean flags | Both names are registered. When both are given, Pi cannot report which came last, so the problem is reported and `--no-` wins. |
| `action="append"` | `--file a --file b` | Last value wins | A flag value in configargparse's list syntax, `--file '[a.py, b.py]'`, becomes a list. A plain value is one item. |
| Aliases of one action | `--edit-format`, `--chat-mode` | Two unrelated string flags | Both are registered and map to one option. When both are given, the conflict is reported and the alias wins. |
| `store_const` into another option | `--architect` | A boolean flag | Registered as a boolean that writes `architect` into `edit-format`. A conflict with `--edit-format` is reported. |
| `type=int`, `type=float`, `choices` | `--line-endings crlf` | A string | Parsed once with Python's `int`/`float` rules and checked against the choices. An invalid value is reported and skipped; Aider exits with status 2. |
| Short options | `-c CONFIG` | Rejected as an unknown short option | None. Only the long form `--config` exists. |
| Positional files | `aider a.py b.py` | Positional arguments are prompt messages | None. Use `--file`. |

Two Pi parsing behaviors have no adapter. A boolean extension flag followed by a word takes the word as its value (`args.js:248-251`), so `pi --dry-run "fix it"` loses the prompt; write the prompt first or after `--`. Flag values exist only after extensions load (`CA/dist/core/agent-session-services.js:8-46`), so resolution runs on `session_start`, not in the factory.

These rows are deleted when Pi's extension flags gain negation, repetition, and ordering.
