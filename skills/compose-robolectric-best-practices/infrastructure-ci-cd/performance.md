# Speeding Up the Suite

## Table of Contents

1. [Where the Time Goes](#where-the-time-goes)
2. [Sandbox Reuse](#sandbox-reuse)
3. [SDK Matrices](#sdk-matrices)
4. [Graphics Mode Cost](#graphics-mode-cost)
5. [Parallel Forks](#parallel-forks)
6. [forkEvery](#forkevery)
7. [JVM Heap](#jvm-heap)
8. [Gradle Build Cache and Configuration Cache](#gradle-build-cache-and-configuration-cache)
9. [Coverage Instrumentation](#coverage-instrumentation)
10. [Measuring](#measuring)
11. [Anti-Patterns](#anti-patterns)
12. [Related References](#related-references)

## Where the Time Goes

A Robolectric Compose test run pays three kinds of cost:

| Cost | When | Size with the pinned stack |
| --- | --- | --- |
| Test JVM start | Once per fork | Part of the first test's time |
| Robolectric sandbox creation (instrumented Android framework class loader, resources) | Once per distinct sandbox configuration per fork | 2–5 s |
| The test itself (`setContent`, actions, assertions) | Every test | 25–70 ms for a small screen |

The JUnit XML shows it directly. Four identical classes of three small Compose tests each, in one fork:

```text
exp.Plain1Test   5.398 0.049 0.046
exp.Plain2Test   0.065 0.047 0.037
exp.Plain3Test   0.038 0.043 0.045
exp.Plain4Test   0.028 0.030 0.032
```

The first test carries the whole startup; everything after reuses the sandbox. Almost every speedup below is about paying that startup fewer times.

## Sandbox Reuse

Robolectric's `SandboxManager` keeps an LRU cache of sandboxes inside each test JVM. Its key (Robolectric 4.17 source) is:

| Part of the key | Changed by |
| --- | --- |
| SDK level | `@Config(sdk = …)`, `minSdk`/`maxSdk`, `robolectric.properties` `sdk` |
| Instrumentation configuration | `@Config(shadows = …)` and `instrumentedPackages` that change what gets instrumented |
| Resources mode | `@ResourcesMode` |
| Looper mode | `@LooperMode` |
| Graphics mode | `@GraphicsMode` |

Anything else, including `@Config(qualifiers = …)`, `fontScale`, and `application`, is applied per test inside an existing sandbox. Measured in one fork, after a sandbox for the default configuration existed:

| Class | First test |
| --- | --- |
| Default config | 0.03 s (reused) |
| `@Config(qualifiers = "fr-night")` | 0.04 s (reused) |
| `@Config(sdk = [34])` | 2.15 s (new sandbox) |
| `@GraphicsMode(NATIVE)` vs the `LEGACY` default | 2–3.5 s (new sandbox for whichever ran second) |

So vary qualifiers freely, but treat each extra SDK level, graphics mode, or looper mode as one more startup per fork. The cache holds three times as many sandboxes as there are supported SDKs, so a fork rarely evicts one; the cost is creating them in the first place, and it is paid again in every fork.

Set module-wide defaults once in `src/test/resources/robolectric.properties` ([setup-configuration.md](../core/setup-configuration.md#config-and-robolectricproperties)) so most classes share one configuration, and put per-class overrides only where a test needs them.

## SDK Matrices

`@Config(sdk = [28, 34, 36])` runs every test in the class once per level. That triples the test time, adds a sandbox per level per fork, and downloads one `android-all-instrumented` jar per level (144–208 MB each for recent levels) on the first run ([ci.md](ci.md#caching-robolectrics-android-jars)).

Run most Compose UI tests on the default SDK (the `targetSdk`) and keep multi-SDK runs for code that branches on `Build.VERSION.SDK_INT`. To trim a run without editing annotations, set the `robolectric.enabledSdks` system property; tests targeting other levels are not run:

```kts
android {
    testOptions {
        unitTests.all {
            providers.gradleProperty("enabledSdks").orNull?.let { sdks ->
                it.systemProperty("robolectric.enabledSdks", sdks)
            }
        }
    }
}
```

`./gradlew :app:testDebugUnitTest -PenabledSdks=36` runs a `@Config(sdk = [34, 36])` class only on 36 (three tests instead of six with the pinned stack). Use it for fast PR runs and keep the full matrix on `main` or nightly. How multi-SDK test names look and how to filter them is in [annotations-filtering.md](../core/annotations-filtering.md#sdk-ranges-and-test-names).

## Graphics Mode Cost

`LEGACY` (the 4.17 default) makes Android graphics no-ops, which is all semantics-based Compose tests need. `NATIVE` loads Android's native graphics libraries so pixels and real text measurement work. It is a separate sandbox (see above) and does more work per frame.

Use `NATIVE` on the classes that need it (screenshot tests, tests that depend on real text layout) rather than module-wide, unless most of the module needs it. Mixing modes in one module is fine, but each fork that runs both pays for two sandboxes. Keeping screenshot tests in their own module or test task keeps the other forks on one sandbox. See [setup-configuration.md](../core/setup-configuration.md#looper-and-graphics-modes) and [screenshot-testing.md](../testing-patterns/screenshot-testing.md).

## Parallel Forks

Gradle runs test classes in one JVM by default (`maxParallelForks = 1`). Raising it starts more JVMs, each with its own sandbox startup and heap:

```kts
android {
    testOptions {
        unitTests.all {
            it.maxParallelForks = (Runtime.getRuntime().availableProcessors() / 2).coerceAtLeast(1)
        }
    }
}
```

| Fact (Gradle `Test` DSL) | Consequence |
| --- | --- |
| `maxParallelForks` cannot exceed `--max-workers` | It is also limited by other tasks running at the same time |
| Gradle limits started test processes across all `Test` tasks | In a multi-module build, modules already run test tasks in parallel with `--parallel` |
| Classes, not methods, are distributed | One slow class still runs on one fork |

Measure before keeping it. With the pinned stack (41 small classes, a loaded 10-core machine) wall time was 11 s with 1 fork, 12 s with 2, and 12 s with 4: each extra fork paid 2–5 s of startup, which ate the gain. Forks help when a module's test time is much larger than startup, and in single-module projects; in multi-module builds, `--parallel` across modules often gives the same benefit for free.

Parallel forks are separate processes, so static state is not shared between them. Tests that leak state through singletons can still interfere within one fork, see [rules-fixtures.md](../core/rules-fixtures.md).

## forkEvery

`forkEvery = N` restarts the test JVM after N classes. It is a workaround for leaks (memory, static state) and destroys sandbox reuse: each new JVM pays startup again.

| Setting (41 classes, 1 fork) | Wall time |
| --- | --- |
| default (`forkEvery = 0`, reuse one JVM) | 11–17 s |
| `forkEvery = 1` | 158 s |
| `forkEvery = 1`, `maxParallelForks = 4` | 124 s |

Gradle's own docs call `forkEvery = 1` "very expensive". Fix the leak instead. If you must, use a large N (for example 100) so startup is amortized.

## JVM Heap

Gradle leaves `maxHeapSize` unset for test JVMs, so each fork gets the JVM default (a fraction of physical memory). Sandboxes are large (the SDK 36 framework jar alone is about 200 MB on disk), and each distinct sandbox in a fork adds to the heap. Set an explicit heap when forks hit `OutOfMemoryError` or when several forks share a CI runner:

```kts
android {
    testOptions {
        unitTests.all {
            it.maxHeapSize = "2g"
        }
    }
}
```

Total memory is roughly forks × heap, plus the Gradle daemon (`org.gradle.jvmargs`) and Kotlin daemon. On a 7 GB CI runner, two 2 GB forks is a safer start than four.

## Gradle Build Cache and Configuration Cache

Test tasks are cacheable. With the build cache on, a test task whose inputs (code, dependencies, JVM args, system properties) are unchanged is restored instead of run:

```properties
# gradle.properties
org.gradle.caching=true
org.gradle.configuration-cache=true
```

With the pinned stack with AGP 9.5.1 and Gradle 9.9.1, a second build after `clean` showed `> Task :blocks:testDebugUnitTest FROM-CACHE` and `Configuration cache entry reused.`, finishing in about 1 s. In CI, `setup-gradle` saves the local build cache with Gradle User Home ([ci.md](ci.md#basic-github-actions-workflow)), so unchanged modules skip their tests on later runs of the same branch. Use `--rerun` to force one task to run despite the cache.

System properties and JVM arguments are part of the test task's inputs. A value that changes on every run, such as a timestamp in `systemProperty(...)`, makes every run a cache miss.

## Coverage Instrumentation

Coverage agents instrument every loaded class. Applying the Kover plugin instruments every test task in the module by default, even when no report is requested; JaCoCo via AGP instruments only when `enableUnitTestCoverage` is on. In one 41-class run, Kover's agent added about 3 s (14 s vs 11 s; noisy, measure your own suite). Keep coverage in a dedicated CI job, or turn the agent off for fast runs. See [coverage.md](coverage.md#keeping-coverage-off-the-fast-path).

## Measuring

| Tool | What it shows |
| --- | --- |
| JUnit XML `time` per test | Sandbox startup (the slow first test per fork) and slow tests |
| `./gradlew … --profile` | HTML report in `build/reports/profile/` with configuration and task times |
| `./gradlew … --scan` | Build Scan with per-task and per-test timing, cache hits, and fork details |
| `--rerun` on the test task | Reruns tests without recompiling, so comparisons measure only test time |

Compare settings with `--rerun` on the test task, not `--rerun-tasks`, which also recompiles everything and hides the difference. Run each setting more than once; other load on the machine moves the numbers a lot.

## Anti-Patterns

| Anti-Pattern | Problem | Instead |
| --- | --- | --- |
| `forkEvery = 1` | New JVM and sandbox per class (14× slower with the pinned stack) | Fix leaking state; at most a large N |
| `@Config(sdk = [...])` on every class | Multiplies tests, sandboxes, and jar downloads | Default SDK; multi-SDK only where code branches on SDK |
| `graphicsMode=NATIVE` module-wide for a few screenshot tests | Every test pays for native graphics | `@GraphicsMode(NATIVE)` on screenshot classes |
| Many `@Config(shadows = …)` variations | Each distinct instrumentation config is a new sandbox | Share one configuration or a base class |
| Raising `maxParallelForks` without measuring | Startup per fork can cancel the gain; more memory | Measure with `--rerun`; prefer `--parallel` across modules |
| Coverage agent on every local run | Slower tests for a report nobody reads | Coverage in its own CI job |
| Changing system properties per run | Test task is never `FROM-CACHE` | Stable inputs |

## Related References

- **Robolectric config, SDK levels, graphics mode**: [setup-configuration.md](../core/setup-configuration.md)
- **Per-test `@Config` and filtering**: [annotations-filtering.md](../core/annotations-filtering.md)
- **CI caching and sharding**: [ci.md](ci.md)
- **Coverage setup**: [coverage.md](coverage.md)
- **Screenshot tests**: [screenshot-testing.md](../testing-patterns/screenshot-testing.md)
- **Shared state between tests**: [rules-fixtures.md](../core/rules-fixtures.md)
