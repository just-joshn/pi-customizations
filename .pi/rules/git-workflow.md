# Git Workflow

## Branch Naming

- `feat/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation changes
- `chore/` - Tooling, dependencies, and maintenance
- `test/` - Test-only changes

## Commit Message Format

```
<type>(<scope>): <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

## Feature Implementation Workflow

1. **Plan First** - Use `planner` agent (`~/.agents/agents/planner.md`)
2. **TDD Approach** - Use `test-engineer` agent (`~/.agents/agents/test-engineer.md`)
3. **Code Review** - Use `code-reviewer` agent (`~/.agents/agents/code-reviewer.md`) after writing code
4. **Commit** - Follow conventional commits format

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to inspect all changes
3. Write a concise PR summary covering why, what changed, scope, blast radius, and verification
4. Push with `-u` flag on a new branch
