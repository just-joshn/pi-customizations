# Running Robolectric Compose Tests in CI

## Table of Contents

1. [What CI Needs](#what-ci-needs)
2. [Basic GitHub Actions Workflow](#basic-github-actions-workflow)
3. [Caching Robolectric's Android Jars](#caching-robolectrics-android-jars)
4. [Offline Mode](#offline-mode)
5. [Test Reports and JUnit XML](#test-reports-and-junit-xml)
6. [Sharding Across Jobs](#sharding-across-jobs)
7. [Screenshot Tests and Roborazzi Diffs](#screenshot-tests-and-roborazzi-diffs)
8. [Anti-Patterns](#anti-patterns)
9. [Troubleshooting](#troubleshooting)
10. [Related References](#related-references)

## What CI Needs

Robolectric Compose tests are ordinary local unit tests: no emulator, no device, no KVM. A CI job needs:

| Need | Why |
| --- | --- |
| A JDK the stack supports | AGP 9.5 and Robolectric 4.17 run on JDK 25. On JDK 24+ the test JVM also needs `--add-opens=java.base/jdk.internal.access=ALL-UNNAMED` ([setup-configuration.md](../core/setup-configuration.md)) |
| The Gradle wrapper | Run `./gradlew`, not a preinstalled Gradle |
| Network access on the first run, or a cache | Robolectric downloads one `android-all-instrumented` jar per SDK level at test time, outside Gradle's dependency cache |
| The variant test task | `testDebugUnitTest` (or `test` for every variant). `--tests` only works on the variant task |

Pick one variant in CI. AGP's `test` task runs the unit tests of every variant (debug and release), which doubles the run for no extra coverage in most apps.

## Basic GitHub Actions Workflow

```yaml
name: Unit tests
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '25'
      - uses: gradle/actions/setup-gradle@v6
      - name: Robolectric android-all jars
        uses: actions/cache@v6
        with:
          path: ~/.m2/repository/org/robolectric
          key: robolectric-${{ hashFiles('gradle/libs.versions.toml') }}
      - run: ./gradlew testDebugUnitTest --continue
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with:
          name: unit-test-results
          path: |
            **/build/test-results/testDebugUnitTest/
            **/build/reports/tests/testDebugUnitTest/
```

Notes on each step:

- **Action versions.** The majors above are the current ones at the time of writing (checkout v7, setup-java v6, setup-gradle v6, cache v6, upload-artifact v7). Pin by major tag as each action's README does, and let Dependabot bump them.
- **`setup-gradle`** caches Gradle User Home (dependencies, wrapper, build cache), validates the wrapper jar, and writes a job summary. By default only builds on the default branch **write** the cache; other branches read it. Change that with `cache-read-only`.
- **`--continue`** keeps running other modules' test tasks after one fails, so one run reports every failure.
- **`if: ${{ !cancelled() }}`** uploads reports when tests fail, which is when you need them.

Do not also set `cache: gradle` on `setup-java` when you use `setup-gradle`. The `setup-gradle` docs recommend against it because two mechanisms saving Gradle User Home can interfere.

## Caching Robolectric's Android Jars

Robolectric does not resolve `android-all-instrumented` through Gradle. At test time its `MavenDependencyResolver` downloads the jar into the **local Maven repository**: the `maven.repo.local` system property if set, else `localRepository` from `~/.m2/settings.xml`, else `~/.m2/repository`. The jars land in `~/.m2/repository/org/robolectric/android-all-instrumented/<version>/`.

So `setup-gradle`'s cache does not cover them, and a CI job without its own cache downloads them on every run. They are large; on our machine the SDK 36 jar directory is 208 MB and SDK 34 is 144 MB. Each SDK level a test runs on (`@Config(sdk = [...])`, `minSdk`/`maxSdk`) adds one.

Cache `~/.m2/repository/org/robolectric` with `actions/cache`, as in the workflow above. Key it on the file that pins the Robolectric version, because each Robolectric release maps SDK levels to specific jar versions. Add a `restore-keys` prefix if you want an old cache to seed a new one after an upgrade.

The download is guarded by a lock file at `~/.robolectric-download-lock`, so parallel test JVMs on one machine do not download the same jar twice.

To download from a mirror instead of Maven Central, set Robolectric's repository system properties on the test task (`robolectric.dependency.repo.url`, `robolectric.dependency.repo.id`, and optionally `.username`, `.password`, `.proxy.host`, `.proxy.port`):

```kts
android {
    testOptions {
        unitTests.all {
            it.systemProperty("robolectric.dependency.repo.url", "https://maven.internal.example.com/maven2")
            it.systemProperty("robolectric.dependency.repo.id", "internal")
        }
    }
}
```

## Offline Mode

For hermetic CI (no network during tests), point Robolectric at a directory that already holds the jars:

```kts
android {
    testOptions {
        unitTests.all {
            it.systemProperty("robolectric.offline", "true")
            it.systemProperty("robolectric.dependency.dir", rootProject.file("robolectric-jars").path)
        }
    }
}
```

With `robolectric.offline=true` or `robolectric.dependency.dir` set, Robolectric switches to its `LocalDependencyResolver`, which looks for a flat file named `<artifactId>-<version>.jar` in that directory, for example `android-all-instrumented-16-robolectric-13921718-i7.jar` for SDK 36 under Robolectric 4.17. If `robolectric.offline` is `true` and no directory is set, it looks in the test task's working directory.

A missing jar fails every test in the class with a message that names the exact file it wanted:

```text
ERROR: Unable to locate dependency: '/tmp/ciexp/emptyjars/android-all-instrumented-16-robolectric-13921718-i7.jar'
ERROR: Parent directory exists but is missing the dependency
java.lang.IllegalArgumentException: Path is not a file: /tmp/ciexp/emptyjars/android-all-instrumented-16-robolectric-13921718-i7.jar
```

That makes the directory easy to fill: run the suite once with network access, then copy the jars from `~/.m2/repository/org/robolectric/android-all-instrumented/*/` into it. Re-check the file names after every Robolectric upgrade. Both settings above were verified against Robolectric 4.17's `LegacyDependencyResolver` source and in a local run (all tests passed offline from a filled directory).

## Test Reports and JUnit XML

AGP's unit test tasks write the standard Gradle outputs per module and variant:

| Output | Path |
| --- | --- |
| JUnit XML, one file per class | `build/test-results/testDebugUnitTest/TEST-<class>.xml` |
| HTML report | `build/reports/tests/testDebugUnitTest/index.html` |

Upload both. The XML is what CI test-report integrations read; the HTML report shows each failure's stack trace and the test's stdout and stderr.

The `time` attribute in the XML is a quick way to spot Robolectric startup: the first test in each JVM fork carries the sandbox setup (2–5 s with the pinned stack), and the rest of the class runs in tens of milliseconds. See [performance.md](performance.md#where-the-time-goes).

To make the console useful in CI logs, log failures with full exceptions:

```kts
tasks.withType<Test>().configureEach {
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
```

## Sharding Across Jobs

Gradle has no built-in shard flag. Three ways to split a slow suite across CI jobs, simplest first:

| Approach | How | Fits when |
| --- | --- | --- |
| Per module | Matrix over `:feature:a:testDebugUnitTest`, `:feature:b:testDebugUnitTest`, … | Multi-module apps; modules are roughly balanced |
| Per package | Matrix over `--tests 'com.example.checkout.*'` patterns | One big module with clear feature packages |
| Hash of class name | A Gradle `exclude` spec keyed on two properties | One big module, no natural split |

Splitting by module is the most cache-friendly, because each job runs whole test tasks that Gradle's build cache can skip when nothing changed ([performance.md](performance.md#gradle-build-cache-and-configuration-cache)).

Hash sharding, as an `exclude` spec on the test task. The spec sees compiled class files; nested classes (`Outer$Inner`) stay in their outer class's shard:

```kts
val shardTotal = providers.gradleProperty("shardTotal").map(String::toInt)
val shardIndex = providers.gradleProperty("shardIndex").map(String::toInt)

tasks.withType<Test>().configureEach {
    if (shardTotal.isPresent) {
        val total = shardTotal.get()
        val index = shardIndex.get()
        exclude { file ->
            val className = file.relativePath.pathString.removeSuffix(".class").substringBefore('$')
            !file.isDirectory && Math.floorMod(className.hashCode(), total) != index
        }
        // A shard can end up with no classes; don't fail it.
        filter.isFailOnNoMatchingTests = false
    }
}
```

With the pinned stack this split 8 classes 3/2/3 across 3 shards, with every class in exactly one shard. A shard that receives no classes fails with `No tests found for given includes:` unless `filter.isFailOnNoMatchingTests = false`; with it set, the empty shard passed.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shardIndex: [0, 1, 2, 3]
        shardTotal: [4]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '25'
      - uses: gradle/actions/setup-gradle@v6
      - uses: actions/cache@v6
        with:
          path: ~/.m2/repository/org/robolectric
          key: robolectric-${{ hashFiles('gradle/libs.versions.toml') }}
      - run: >
          ./gradlew :app:testDebugUnitTest
          -PshardIndex=${{ matrix.shardIndex }} -PshardTotal=${{ matrix.shardTotal }}
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with:
          name: test-results-${{ matrix.shardIndex }}
          path: app/build/test-results/testDebugUnitTest/
```

Each shard pays JVM and Robolectric startup again, so sharding pays off only when the suite is much longer than that startup. Hash sharding balances by class count, not duration; one slow class can dominate its shard. `fail-fast: false` keeps the other shards running so you see every failure.

## Screenshot Tests and Roborazzi Diffs

Roborazzi's record/verify/compare tasks and when to use each are in [screenshot-testing.md](../testing-patterns/screenshot-testing.md#record-verify-compare). In CI, run verify and upload Roborazzi's outputs when it fails:

```yaml
      - run: ./gradlew :app:verifyRoborazziDebug
      - uses: actions/upload-artifact@v7
        if: ${{ failure() }}
        with:
          name: roborazzi-diffs
          path: |
            app/build/outputs/roborazzi/
            app/build/reports/roborazzi/
            app/build/test-results/roborazzi/
          retention-days: 14
```

| Path | Contents |
| --- | --- |
| `build/outputs/roborazzi/` | Reference images by default (unless `roborazzi.outputDir` moves them, for example into `src/screenshots`), plus `<name>_actual.png` and `<name>_compare.png` for each mismatch |
| `build/reports/roborazzi/debug/index.html` | Roborazzi's HTML report of the run (the README says `build/reports/roborazzi/index.html`; 1.78.0 wrote it under the variant name with the pinned stack) |
| `build/test-results/roborazzi/` | JSON results per image |

With the pinned stack, changing a composable's text after recording and then running `verifyRoborazziDebug` failed the test and left `shot.png`, `shot_actual.png`, and `shot_compare.png` side by side in `build/outputs/roborazzi/`.

Committed reference images make verify self-contained. Roborazzi's README also shows a variant that stores references as an artifact from `main` and downloads them before verify; that keeps binaries out of Git but couples PR jobs to the last `main` run.

Screenshot tests need `@GraphicsMode(NATIVE)` and render text with the fonts of the machine that runs them. Record and verify on the same OS image (for example always `ubuntu-latest`), or references recorded on a laptop will fail in CI. When several Roborazzi tasks run in one Gradle invocation, Roborazzi's README recommends `separateOutputDirs` to stop them racing on one output directory.

## Anti-Patterns

| Anti-Pattern | Problem | Instead |
| --- | --- | --- |
| No cache for `~/.m2/repository/org/robolectric` | Hundreds of MB downloaded per job; flaky when Maven Central is slow | `actions/cache` keyed on the Robolectric version |
| Running `./gradlew test` | Runs debug and release unit tests | Run `testDebugUnitTest` |
| `--tests` on `test` | `Unknown command-line option '--tests'` | Use the variant task ([annotations-filtering.md](../core/annotations-filtering.md#running-a-subset-from-the-command-line)) |
| Uploading reports only on success | No artifacts when you need them | `if: ${{ !cancelled() }}` or `failure()` |
| `setup-java` `cache: gradle` plus `setup-gradle` | Two caches fight over Gradle User Home | Let `setup-gradle` own it |
| `robolectric.offline=true` with an empty or stale directory | Every test fails with `Path is not a file` | Fill it from `~/.m2` and re-check after upgrades |
| Recording screenshots locally, verifying on Linux CI | Font and rendering differences fail every image | Record and verify on the same OS image |
| Many shards for a small suite | Each shard repeats JVM, Gradle configuration, and sandbox startup | Shard only when tests dominate the job time |

## Troubleshooting

### Tests pass locally, fail in CI with download or network errors

Robolectric is fetching `android-all-instrumented` at test time. Add the jar cache, set a mirror with `robolectric.dependency.repo.url`, or go [offline](#offline-mode).

### `IllegalArgumentException: Path is not a file: …android-all-instrumented-…jar`

Offline mode is on and the directory lacks that SDK's jar. Copy the named file in, or remove the `@Config(sdk = …)` that needs it.

### Robolectric fails on JDK 24+ before any test runs

The test JVM is missing `--add-opens=java.base/jdk.internal.access=ALL-UNNAMED` (robolectric/robolectric#11434). See [setup-configuration.md](../core/setup-configuration.md).

### A shard fails with `No tests found for given includes:`

The hash put no classes in that shard. Set `filter.isFailOnNoMatchingTests = false` on the test task, or use fewer shards.

## Related References

- **Gradle and Robolectric setup**: [setup-configuration.md](../core/setup-configuration.md)
- **Filtering with `--tests`, categories, excluding screenshot tests**: [annotations-filtering.md](../core/annotations-filtering.md)
- **Forks, sandbox reuse, build cache**: [performance.md](performance.md)
- **Coverage reports in CI**: [coverage.md](coverage.md)
- **Roborazzi setup and tasks**: [screenshot-testing.md](../testing-patterns/screenshot-testing.md)
- **Which tests run on the JVM vs a device**: [test-architecture.md](../architecture/test-architecture.md)
