# Test Projects

## Table of Contents

1. [When to Use Projects](#when-to-use-projects)
2. [Defining Projects](#defining-projects)
3. [Inheritance from the Root Config](#inheritance-from-the-root-config)
4. [Referenced Config Files and Monorepos](#referenced-config-files-and-monorepos)
5. [Nested Projects](#nested-projects)
6. [Per-Project Environment and Settings](#per-project-environment-and-settings)
7. [Per-Project Values with provide and Injected Fixtures](#per-project-values-with-provide-and-injected-fixtures)
8. [Shared Vite Server](#shared-vite-server)
9. [Running and Filtering Projects](#running-and-filtering-projects)
10. [Debugging Project Resolution](#debugging-project-resolution)

## When to Use Projects

Projects (formerly called "workspace") run several configurations in **one** Vitest process. Use them when groups of files need different **runner settings**:

- Different `environment` (node vs `jsdom` vs browser mode)
- Different `pool`, `isolate`, or `fileParallelism`, for example unit tests without isolation and integration tests run one file at a time
- Packages in a monorepo, each with its own config

To give a category of tests a different timeout or retry count, use [tags](annotations-filtering.md#test-tags) instead. To run a subset by name, use `-t`.

## Defining Projects

`test.projects` accepts globs, config file paths, and inline configs:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/*',                       // every folder is a project
      '!packages/legacy',                 // negation excludes
      'apps/*/vitest.config.{unit,e2e}.ts',
      {
        test: {
          name: 'dom',
          include: ['src/**/*.dom.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
})
```

- A file entry must be named `vitest.config.*`, `vite.config.*`, or `vitest.<name>.config.*` / `vite.<name>.config.*`.
- Every project needs a **unique** `name`. Inline projects without a name get their array index. Projects from folders use the `package.json` `name`, or the folder name if there is none.
- The root config is **not** a project unless it lists itself. Its root-only options (`reporters`, `coverage`, `resolveSnapshotPath`, `attachmentsDir`, ...) apply to the whole run.
- `process.cwd()` in tests is the directory Vitest was started from, not the project root.

## Inheritance from the Root Config

> **Version note:** In 5.x **inline** projects inherit the root config by default (`extends: true`), including Vite options like `plugins` and `resolve.alias`. In 4.x you had to set `extends: true` yourself.

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./test/setup.global.ts'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.unit.test.ts'],
          setupFiles: ['./test/setup.unit.ts'], // APPENDED: global + unit
        },
      },
      {
        extends: false,                         // opt out of root options
        test: {
          name: 'scripts',
          include: ['scripts/**/*.test.ts'],
        },
      },
      {
        extends: './vitest.shared.ts',          // inherit from another file instead
        test: { name: 'shared' },
      },
    ],
  },
})
```

Merge rules:

- Arrays such as `setupFiles` are **concatenated**, not replaced.
- `name` and `projects` are never inherited.
- The root `globalSetup` is **not** inherited, because it already runs once per run. It is inherited when you extend a non-root file.
- A project's own `tags` **replace** the inherited `tags`.

## Referenced Config Files and Monorepos

Projects referenced as files or folders **do not** inherit anything from the root. Share settings through a separate file that has no `projects`, and merge it in:

```ts
// vitest.shared.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { restoreMocks: true, unstubEnvs: true },
})
```

```ts
// packages/web/vitest.config.ts
import { defineProject, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(shared, defineProject({
  test: {
    name: 'web',
    environment: 'jsdom',
  },
}))
```

Use `defineProject` in project files. It reports an error if you use a root-only option.

> **Version note:** Do not `mergeConfig` the **root** config into a package config. In 5.x a referenced config that has `projects` becomes a container of nested projects (see below). Usually that fails at startup with `Projects definition references a non-existing file or a directory` or a circular-definition error.

## Nested Projects

A referenced **config file** (not an inline config) can declare its own `projects`. It then acts like a root: it runs no tests itself, and its projects are named `<parent> (<child>)`.

```ts
// packages/app/vitest.config.ts
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'app',
    projects: [
      { test: { name: 'unit', include: ['**/*.unit.test.ts'] } },
      { test: { name: 'e2e', include: ['**/*.e2e.test.ts'] } },
    ],
  },
})
// -> projects "app (unit)" and "app (e2e)"
```

The inline children extend `app`'s config, not the root config. To also run `app`'s own `include`, list `'./vitest.config.ts'` inside its `projects`.

## Per-Project Environment and Settings

Split by filename suffix so each group gets the runner settings it needs:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/*.dom.test.ts'],
          environment: 'node',
          isolate: false,                     // only for files without shared mutable state
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'dom',
          include: ['src/**/*.dom.test.ts'],
          environment: 'jsdom',
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          fileParallelism: false,             // files share one DB / port
          testTimeout: 30_000,
          sequence: { groupOrder: 1 },        // runs after groups with order 0 finish
        },
      },
    ],
  },
})
```

Projects run in parallel by default. Projects with the same `sequence.groupOrder` run together, and groups run from lowest to highest.

## Per-Project Values with provide and Injected Fixtures

A fixture marked `{ injected: true }` uses its default unless a project `provide`s a value:

```ts
// fixtures.ts
import { test as baseTest } from 'vitest'

export const test = baseTest.extend('apiUrl', { injected: true }, 'http://localhost:3000')
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'local' } },
      { test: { name: 'staging', provide: { apiUrl: 'https://staging.example.com' } } },
    ],
  },
})
```

`inject('key')` reads a provided value outside fixtures. Values must be serializable.

## Shared Vite Server

> **Version note:** In 5.x inline projects that don't change the Vite config **share the declaring config's Vite server** (`sharedViteServer: true`). Shared files are transformed once. The declaring config file runs once, so plugins are created once.

A project gets its own server if it sets Vite-level options that change the server (`plugins`, `resolve`, ...), sets `extends` to something other than the declaring config, or sets `alias`, `browser`, `css`, `deps.moduleDirectories`, `deps.optimizer`, `mode`, or `root`. `env`, `setupFiles`, `environment`, and `define` do not prevent sharing.

- If every project repeats the same `plugins` entry, move it to the root so the projects keep sharing.
- If a plugin needs a separate instance per project, set `sharedViteServer: false` or `extends: false` on that project.
- Projects referenced as files always get their own server.

## Running and Filtering Projects

```bash
npx vitest run --project unit                 # one project
npx vitest run -p unit -p dom                 # several (-p is the 5.x shorthand)
npx vitest run --project 'unit*' --project '!unit (browser)'
npx vitest run --project app                  # all nested projects of "app"
npx vitest run --project 'app (unit)'         # one nested project
npx vitest run --project unit src/cart.test.ts -t 'total'
```

A project runs when it matches no negated pattern and, if any positive patterns are given, matches at least one of them.

## Debugging Project Resolution

```bash
DEBUG=vitest:projects npx vitest run
```

This logs which paths each glob matched, why `--project` dropped a project, and whether each project shares a Vite server.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Duplicate or missing project names | Startup error, or unreadable numeric names | Give every project a unique `name` |
| `mergeConfig(rootConfig, ...)` in a package config | Inherits `projects` and becomes a container (5.x) | Merge a `vitest.shared.ts` that has no `projects` |
| Expecting a referenced config to inherit root plugins | Only inline projects inherit | `mergeConfig(shared, defineProject(...))` |
| Re-declaring root `setupFiles` in an inline project | Runs twice, because arrays are concatenated | Declare it once at the root, or `extends: false` |
| Same plugin listed in every inline project | Each project gets its own server and transform cache | Move the plugin to the root config |
| `reporters` / `coverage` in a project config | Not supported per project | Put them in the root config |
| Projects used only to give a category a longer timeout | Unnecessary config split | Tags with `timeout`/`retry` |
| `extends: true` everywhere after upgrading | Already the default in 5.x | Remove it, and add `extends: false` only where needed |
| Using the old `workspace` setup | Replaced by `projects` (deprecated since 3.2) | `test.projects` |

## Related References

- **Base configuration options**: [configuration.md](configuration.md)
- **Tags vs projects, --project with other filters**: [annotations-filtering.md](annotations-filtering.md)
- **Injected fixtures and provide/inject**: [fixtures-hooks.md](fixtures-hooks.md)
- **Isolation and parallelism trade-offs**: [performance.md](../infrastructure-ci-cd/performance.md)
- **Browser projects**: [browser-mode.md](../testing-patterns/browser-mode.md)
- **CI sharding across projects**: [ci.md](../infrastructure-ci-cd/ci.md)
