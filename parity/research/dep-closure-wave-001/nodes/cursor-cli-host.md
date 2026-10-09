# cursor-cli-host

Previously incomplete: True

## Disposition

Public CLI contract docs for overview, using, configuration, permissions, parameters, slash-commands, and skills were re-hashed and quoted. Host ownedBehavior is covered at docs level. dependenciesEnumerated remains false; live integrations and closed-source tool schemas remain open.

proposeReadingComplete: True
proposeDependenciesEnumerated: False

## Sources

- `parity/research/cursor-host/cli/parent-snapshots/cli_overview.md` sha256=`c56ae1d766654ca892b2cfb513a2f7f5ef0082f107d225fb4319fa9f20109e85` bytes=3341
  - lines 1-6 (non-empty):
```
# Cursor CLI
Cursor CLI lets you interact with AI agents directly from your terminal to write, review, and modify code. Whether you prefer an interactive terminal interface or print automation for scripts and CI pipelines, the CLI provides powerful coding assistance right where you work.
## Getting started
```bash
# Install (macOS, Linux, WSL)
curl https://cursor.com/install -fsS | bash
```
- `parity/research/cursor-host/cli/parent-snapshots/cli_using.md` sha256=`b070cb1f882dd8e8b9ab7434ff6f96fe1f181c4907ee242773ae6bbbedb47b0b` bytes=5771
  - lines 1-6 (non-empty):
```
# Using Agent in CLI
## Modes
The CLI supports the same [modes](https://cursor.com/docs/agent/overview.md) as the editor. Switch modes using slash commands or the `--mode` flag.
### Plan mode
Use Plan mode to design your approach before coding. The agent asks clarifying questions to refine your plan.
- Press Shift+Tab to rotate to Plan mode
```
- `parity/research/cursor-host/cli/parent-snapshots/cli_reference_configuration.md` sha256=`aab79ccc8949c23f30c45e0928ea80cefb5ee4ee6ff1723a3864ac61851f2a87` bytes=7756
  - lines 1-6 (non-empty):
```
# Configuration
Configure the Agent CLI using the `cli-config.json` file.
## File location
| Type    | Platform    | Path                                       |
| :------ | :---------- | :----------------------------------------- |
| Global  | macOS/Linux | `~/.cursor/cli-config.json`                |
```
- `parity/research/cursor-host/cli/parent-snapshots/cli_reference_permissions.md` sha256=`9f8264f5d8136496f008e0949cdad81760b8fa7784e3d6a2a04757c13c960f15` bytes=4430
  - lines 1-6 (non-empty):
```
# Permissions
Configure what the agent is allowed to do using permission tokens in your CLI configuration. Permissions are set in `~/.cursor/cli-config.json` (global) or `<project>/.cursor/cli.json` (project-specific).
## Permission types
### Shell commands
**Format:** `Shell(commandBase)`
Controls access to shell commands. The `commandBase` is the first token in the command line. Supports glob patterns and an optional `command:args` syntax for finer control.
```
- `parity/research/cursor-host/cli/parent-snapshots/cli_reference_parameters.md` sha256=`b50b48d66f4f420a8d1d4a6c3087aa74d3fa37f2c5363933ac30754ef10a8c78` bytes=16113
  - lines 1-6 (non-empty):
```
# Parameters
## Global options
Global options can be used with any command:
| Option                     | Description                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `-v, --version`            | Output the version number                                                                                            |
```
- `parity/research/cursor-host/cli/parent-snapshots/cli_reference_slash-commands.md` sha256=`a39f8c0086b6ca6e2bfde6c3595142987cdef4489ad0c0e213510bb746947111` bytes=6309
  - lines 1-6 (non-empty):
```
# Slash commands
| Command                                | Description                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/model [filter]`                      | Select a model. Press `Tab` to edit.                                                                                   |
| `/run-everything [on\|off\|status]`    | Toggle Run Everything or show its status. `/auto-run` is an alias.                                                     |
| `/plan [prompt]`                       | Switch to Plan mode, show the current plan, or submit a prompt in Plan mode         
```
- `parity/reference/cursor-docs/skills.md` sha256=`5ccb25304f16e82a7f58c0241a0a16a072adb33f7697e43c5704c46738e002ac` bytes=17995
  - lines 1-6 (non-empty):
```
# Agent Skills
Agent Skills is an open standard for extending AI agents with specialized capabilities. Skills package domain-specific knowledge and workflows that agents can use to perform specific tasks.
## What are skills?
A skill is a portable, version-controlled package that teaches agents how to perform domain-specific tasks. Skills can include scripts, templates, and references that agents may act on using their tools.
### Portable
Skills work across any agent that supports the Agent Skills standard.
```
