# Coverage for Robolectric Compose Tests

## Table of Contents

1. [Choosing a Tool](#choosing-a-tool)
2. [JaCoCo Through AGP](#jacoco-through-agp)
3. [The Robolectric Fix: includeNoLocationClasses](#the-robolectric-fix-includenolocationclasses)
4. [Kover](#kover)
5. [Filtering Compose-Generated Code](#filtering-compose-generated-code)
6. [Coverage in CI](#coverage-in-ci)
7. [Keeping Coverage Off the Fast Path](#keeping-coverage-off-the-fast-path)
8. [Using Coverage Well](#using-coverage-well)
9. [Anti-Patterns](#anti-patterns)
10. [Troubleshooting](#troubleshooting)
11. [Related References](#related-references)

## Choosing a Tool

| Tool | Setup | Robolectric needs | Pick it when |
| --- | --- | --- | --- |
| JaCoCo via AGP | `enableUnitTestCoverage = true` on a build type | `isIncludeNoLocationClasses = true`, or app classes show 0% | You already use JaCoCo, or merge with instrumented-test coverage |
| Kover 0.9.11 | Apply `org.jetbrains.kotlinx.kover` | Nothing extra with the pinned stack | Kotlin projects that want a Gradle-native DSL for filters and thresholds |

Both instrument classes with a JVM agent while tests run. Robolectric loads app classes through its own sandbox class loader, and that is what trips up JaCoCo's default settings.

Neither tool is applied by the snippets elsewhere in this skill, so the `kts` blocks below are not compiled by the skill's harness. Each was run against a copy of the harness project (AGP 9.5.1, Gradle 9.9.1, JDK 25, Robolectric 4.17) with one composable in `src/main` and a Robolectric Compose test that clicks it.

## JaCoCo Through AGP

```kts
android {
    buildTypes {
        debug {
            enableUnitTestCoverage = true
        }
    }
}
```

This makes AGP apply Gradle's `jacoco` plugin, attach the JaCoCo agent to `testDebugUnitTest`, and register a report task:

```bash
./gradlew :app:testDebugUnitTest :app:createDebugUnitTestCoverageReport
```

| Output | Path |
| --- | --- |
| Execution data | `build/outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec` |
| HTML report | `build/reports/coverage/test/debug/index.html` |
| XML report (for CI tools) | `build/reports/coverage/test/debug/report.xml` |

AGP 9.5.1 used JaCoCo 0.8.15 with the pinned stack (the HTML footer names the version). To choose another JaCoCo version, set `jacocoVersion` in the `testCoverage` block; setting it to 0.8.14 produced a 0.8.14 report:

```kts
android {
    testCoverage {
        jacocoVersion = "0.8.14"
    }
}
```

`createDebugUnitTestCoverageReport` does not accept `--tests`. To cover a subset, name the test task first with its filter: `./gradlew :app:testDebugUnitTest --tests 'com.example.checkout.*' :app:createDebugUnitTestCoverageReport`.

## The Robolectric Fix: includeNoLocationClasses

With only `enableUnitTestCoverage = true`, the pinned stack reported **0%** for a composable the test clicked through:

```text
Element  Missed Instructions  Cov.
exp      …                    0%
```

The JaCoCo agent started with `inclnolocationclasses=false` (visible in the test JVM's `-javaagent:` argument). Classes defined by Robolectric's sandbox class loader have no code-source location, so JaCoCo skips them by default. Turn them on for the test tasks:

```kts
plugins.withId("jacoco") {
    tasks.withType<Test>().configureEach {
        extensions.configure<JacocoTaskExtension> {
            isIncludeNoLocationClasses = true
            excludes = listOf("jdk.internal.*")
        }
    }
}
```

After this change the same test reported 94% instruction coverage for the composable's package.

Two details matter on AGP 9.5:

- **Wrap it in `plugins.withId("jacoco")`.** AGP applies the `jacoco` plugin later than the module's build script runs. The commonly copied form without it, `tasks.withType<Test>().configureEach { configure<JacocoTaskExtension> { … } }`, failed with the pinned stack with `Extension of type 'JacocoTaskExtension' does not exist`.
- **`excludes = listOf("jdk.internal.*")`** is the usual companion setting, so the agent does not instrument JDK-internal classes that the flag would otherwise pull in. With the pinned stack on JDK 25 with JaCoCo 0.8.15, the report was the same with and without it. It costs nothing; keep it unless you have a reason not to.

## Kover

```kts
// root build.gradle.kts
plugins {
    id("org.jetbrains.kotlinx.kover") version "0.9.11" apply false
}

// app/build.gradle.kts
plugins {
    id("org.jetbrains.kotlinx.kover")
}
```

Kover creates a report variant per Android build variant, plus a "total" variant for all of them. Each report task runs the matching unit tests first:

| Task | Output |
| --- | --- |
| `:app:koverHtmlReportDebug` | `build/reports/kover/htmlDebug/index.html` |
| `:app:koverXmlReportDebug` (JaCoCo-compatible XML) | `build/reports/kover/reportDebug.xml` |
| `:app:koverVerifyDebug` | Fails the build when a rule is violated |
| `:app:koverHtmlReport`, `koverXmlReport`, `koverVerify` | The same for the total variant (all build variants) |

With no extra configuration, the same Robolectric test reported 96% instruction coverage for the composable's package under Kover. No `includeNoLocationClasses` equivalent was needed.

Thresholds go in a `verify` block, here for the debug variant:

```kts
kover {
    reports {
        variant("debug") {
            verify {
                rule {
                    minBound(80)
                }
            }
        }
    }
}
```

A violation fails `koverVerifyDebug` with a message such as `Rule violated: lines covered percentage is 19.047600, but expected minimum is 80`. The bound is line coverage for the whole module by default; `groupBy` and `coverageUnits` on a rule change that. Verification rules for the total variant also run as part of `check`; report generation does not unless you set `onCheck = true` on the report.

Kover 0.9.11 printed one Gradle deprecation warning on Gradle 9.9.1 with the pinned stack (`Configuration.setVisible(boolean)`, from `kotlinx.kover.gradle.plugin.commons.ConfigurationsKt.asBucket`). It does not fail the build unless the build sets `--warning-mode=fail`.

## Filtering Compose-Generated Code

The Compose compiler generates classes that are not your code, such as `ComposableSingletons$<File>Kt` holding lambdas, and `@Preview` functions exist only for the IDE. Excluding them keeps the percentage about real UI logic.

With Kover:

```kts
kover {
    reports {
        filters {
            excludes {
                classes("*ComposableSingletons*")
                annotatedBy("androidx.compose.ui.tooling.preview.Preview")
            }
        }
    }
}
```

`annotatedBy` works because `@Preview` has `BINARY` retention, and Kover filters annotations with `BINARY` or `RUNTIME` retention. Kover's docs note that `annotatedBy` and `inheritedFrom` do not work when Kover is switched to the JaCoCo engine (`useJacoco()`).

AGP's `createDebugUnitTestCoverageReport` has no filter DSL. To exclude classes from a JaCoCo report, register your own `JacocoReport` task over the `.exec` file with filtered class directories, or move to Kover.

## Coverage in CI

Run coverage in its own job (or only on `main`) and upload the reports:

```yaml
  coverage:
    runs-on: ubuntu-latest
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
      - run: ./gradlew :app:koverXmlReportDebug :app:koverHtmlReportDebug :app:koverVerifyDebug
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with:
          name: coverage
          path: app/build/reports/kover/
```

Coverage services and PR-comment actions read the XML (Kover's is JaCoCo-compatible). With JaCoCo through AGP, upload `app/build/reports/coverage/` instead. The general workflow, caching, and sharding are in [ci.md](ci.md).

Coverage from sharded jobs is per shard. To get one number, keep coverage in an unsharded job, or merge the JaCoCo `.exec` files from every shard in a final job.

## Keeping Coverage Off the Fast Path

Instrumentation slows tests. Applying Kover instruments every test task in the module, even when you only run `testDebugUnitTest`. JaCoCo through AGP instruments only while `enableUnitTestCoverage` is true. Tie both to a Gradle property so local and PR runs stay fast:

```kts
android {
    buildTypes {
        debug {
            enableUnitTestCoverage = providers.gradleProperty("coverage").isPresent
        }
    }
}

kover {
    currentProject {
        instrumentation {
            disabledForAll = !providers.gradleProperty("coverage").isPresent
        }
    }
}
```

Then `./gradlew :app:koverXmlReportDebug -Pcoverage` measures, and plain `testDebugUnitTest` does not instrument. Note the property name: Kover's 0.9.11 docs show `disableForAll`, but the DSL property is `disabledForAll`; the documented spelling fails with `Unresolved reference 'disableForAll'`.

## Using Coverage Well

- **Coverage says what ran, not what was checked.** A Compose test that calls `setContent` and asserts nothing still executes the whole screen. Review assertions, not percentages ([assertions.md](../core/assertions.md)).
- **Count logic, not layout.** Branches in state holders and ViewModels matter more than the lines of a `Column`. Plain JVM tests often cover that logic more cheaply than Robolectric UI tests ([test-architecture.md](../architecture/test-architecture.md)).
- **Ratchet, don't jump.** Set `minBound` near the current value and raise it as tests improve, instead of picking a round target the suite cannot meet.
- **Robolectric and instrumented coverage are separate.** AGP's unit test report covers JVM tests only; device tests have their own coverage tasks. Merging them is a reporting step, not a reason to duplicate tests on both.

## Anti-Patterns

| Anti-Pattern | Problem | Instead |
| --- | --- | --- |
| JaCoCo without `isIncludeNoLocationClasses = true` | Code exercised under Robolectric shows 0% | Set it on the test tasks |
| `configure<JacocoTaskExtension>` outside `plugins.withId("jacoco")` on AGP 9.5 | `Extension of type 'JacocoTaskExtension' does not exist` | Wrap in `plugins.withId("jacoco")` |
| Kover applied with no way to turn it off | Every local test run is instrumented | `disabledForAll` tied to a property |
| `--tests` on the coverage report task | `Unknown command-line option '--tests'` | Put `--tests` on `testDebugUnitTest` in the same command |
| Counting `ComposableSingletons` and previews | Inflates or deflates the number with generated code | Kover `excludes` filters |
| A high global threshold on day one | Builds fail; people add assertion-free tests to hit it | Ratchet from the current value |
| Treating coverage as test quality | Assertion-free tests cover a lot | Review what tests assert |

## Troubleshooting

### JaCoCo reports 0% for code the tests clearly run

Robolectric-loaded classes are skipped. Add `isIncludeNoLocationClasses = true` (see [above](#the-robolectric-fix-includenolocationclasses)) and check the test JVM's `-javaagent:` argument shows `inclnolocationclasses=true`.

### `createDebugUnitTestCoverageReport` does not exist

`enableUnitTestCoverage` is not on for that build type. The task only exists for build types that enable it.

### The report includes classes you never wrote

Compose-generated `ComposableSingletons*` classes and other generated code. Filter them with Kover `excludes`.

### Coverage numbers differ between JaCoCo and Kover

They use different engines and counters (our composable showed 94% of instructions under JaCoCo and 96% under Kover). Pick one tool for thresholds and do not compare numbers across them.

## Related References

- **CI workflow, caching, sharding**: [ci.md](ci.md)
- **Why instrumentation slows tests**: [performance.md](performance.md#coverage-instrumentation)
- **Gradle and Robolectric setup**: [setup-configuration.md](../core/setup-configuration.md)
- **What to assert**: [assertions.md](../core/assertions.md)
- **Which tests belong on the JVM**: [test-architecture.md](../architecture/test-architecture.md)
