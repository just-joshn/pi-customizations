---
name: compose-robolectric-best-practices
description: Use when writing or reviewing Jetpack Compose UI tests that run on the JVM with Robolectric, fixing flaky or slow Compose tests, debugging test failures, structuring suites, choosing finders and semantics matchers (onNodeWithText, onNodeWithTag, hasX, useUnmergedTree), assertions, actions and gestures (performClick, performTextInput, performTouchInput, performScrollTo), synchronization (waitForIdle, waitUntil, mainClock, the v2 StandardTestDispatcher test APIs), JUnit rules and fixtures, screen robots, fakes and test data, ViewModel and StateFlow screens, navigation (Navigation Compose, Navigation 3), lists and scrolling, text fields and forms, dialogs and popups, animations and the test clock, configuration changes (qualifiers, dark mode, locale, RTL, font scale, state restoration), View interop, activities, intents, permissions and back press, screenshot tests with Roborazzi, accessibility checks, Robolectric configuration (@Config, sdk, qualifiers, looper and graphics modes), CI, performance, coverage, or migrating from the v1 Compose test APIs. Targets Compose BOM 2026.09 (ui-test 1.12) and Robolectric 4.17.
license: MIT
metadata:
  version: "1.0"
  compose-bom: "2026.09.00"
  robolectric: "4.17"
---

# Jetpack Compose + Robolectric Testing Best Practices

Guidance for writing, debugging, and maintaining Jetpack Compose UI tests that run as local JVM tests under Robolectric. Written against **Compose BOM 2026.09.00** (`ui-test` 1.12.1), **Robolectric 4.17**, **AGP 9.5**, and **Kotlin 2.4**. Every Kotlin example compiles against those versions and every example test passes under Robolectric. Statements marked "with the pinned stack" describe behavior measured against exactly these versions; re-check them on other versions.

Check the project's versions first (the Compose BOM and `org.robolectric:robolectric` in the Gradle build or version catalog). Compose 1.11 added `v2` versions of `createComposeRule`, `createAndroidComposeRule`, and `runComposeUiTest`, which run compositions on a `StandardTestDispatcher`, and the v1 versions are deprecated. Use the `v2` imports in new tests, and see [migration.md](architecture/migration.md) when a project is still on the v1 APIs.

## Activity-Based Reference Guide

### Writing New Tests

| Activity | Reference Files |
| --- | --- |
| **Setting up Compose tests under Robolectric** | [setup-configuration.md](core/setup-configuration.md) |
| **Writing a Compose UI test** | [test-structure.md](core/test-structure.md), [finders-semantics.md](core/finders-semantics.md), [assertions.md](core/assertions.md) |
| **Finding nodes (text, tag, description, matchers)** | [finders-semantics.md](core/finders-semantics.md) |
| **Asserting on nodes** | [assertions.md](core/assertions.md) |
| **Clicks, typing, gestures, keys** | [actions-gestures.md](core/actions-gestures.md) |
| **Waiting for async work and recomposition** | [synchronization.md](core/synchronization.md) |
| **Rules, setup, teardown** | [rules-fixtures.md](core/rules-fixtures.md) |
| **Fakes, builders, test data** | [test-data.md](core/test-data.md), [when-to-mock.md](architecture/when-to-mock.md) |
| **Reusable screen robots** | [screen-robots.md](core/screen-robots.md) |
| **Screens backed by a ViewModel or StateFlow** | [viewmodel-state.md](testing-patterns/viewmodel-state.md), [synchronization.md](core/synchronization.md) |
| **Navigation between screens** | [navigation.md](testing-patterns/navigation.md) |
| **Lazy lists and scrolling** | [lists-scrolling.md](testing-patterns/lists-scrolling.md) |
| **Text fields, forms, validation, IME** | [forms-text-input.md](testing-patterns/forms-text-input.md) |
| **Dialogs, bottom sheets, menus, popups** | [dialogs-popups.md](testing-patterns/dialogs-popups.md) |
| **Animations and time** | [animations-clock.md](testing-patterns/animations-clock.md) |
| **Dark mode, locale, RTL, font scale, rotation, state restoration** | [configuration-changes.md](testing-patterns/configuration-changes.md) |
| **AndroidView, ComposeView, Espresso interop** | [interop-views.md](testing-patterns/interop-views.md) |
| **Activities, intents, permissions, back press** | [activities-intents.md](testing-patterns/activities-intents.md) |
| **Screenshot tests** | [screenshot-testing.md](testing-patterns/screenshot-testing.md) |
| **Accessibility** | [accessibility.md](testing-patterns/accessibility.md), [finders-semantics.md](core/finders-semantics.md) |

### Debugging & Troubleshooting

| Activity | Reference Files |
| --- | --- |
| **Debugging a failing test** | [debugging.md](debugging/debugging.md) |
| **Flaky tests, state leaks, test order** | [flaky-tests.md](debugging/flaky-tests.md), [synchronization.md](core/synchronization.md) |
| **Error messages and setup problems** | [common-errors.md](debugging/common-errors.md) |
| **Node not found / more than one node** | [finders-semantics.md](core/finders-semantics.md), [debugging.md](debugging/debugging.md) |
| **Timeouts, idling, infinite animations** | [synchronization.md](core/synchronization.md), [animations-clock.md](testing-patterns/animations-clock.md) |

### Organizing & Running Tests

| Activity | Reference Files |
| --- | --- |
| **@Ignore, assumptions, @Config per test, filtering with --tests** | [annotations-filtering.md](core/annotations-filtering.md) |
| **Robolectric @Config, SDK levels, qualifiers, looper and graphics modes** | [setup-configuration.md](core/setup-configuration.md), [annotations-filtering.md](core/annotations-filtering.md) |

### Architecture Decisions

| Activity | Reference Files |
| --- | --- |
| **Robolectric vs instrumented vs screenshot vs plain unit tests** | [test-architecture.md](architecture/test-architecture.md) |
| **Fake vs mock vs real dependency** | [when-to-mock.md](architecture/when-to-mock.md) |
| **Migrating from the v1 test APIs or older Robolectric** | [migration.md](architecture/migration.md) |

### Infrastructure & CI

| Activity | Reference Files |
| --- | --- |
| **Running in CI, reports, sharding** | [ci.md](infrastructure-ci-cd/ci.md) |
| **Speeding up the suite** | [performance.md](infrastructure-ci-cd/performance.md) |
| **Coverage** | [coverage.md](infrastructure-ci-cd/coverage.md) |

## Quick Decision Tree

```
What are you doing?
│
├─ Writing a new test?
│  ├─ First Compose test in the module → core/setup-configuration.md, core/test-structure.md
│  ├─ Find a node → core/finders-semantics.md
│  ├─ Check what the user sees → core/assertions.md
│  ├─ Click, type, swipe, press keys → core/actions-gestures.md
│  ├─ Content changes after async work → core/synchronization.md
│  ├─ Screen with a ViewModel → testing-patterns/viewmodel-state.md
│  ├─ Moves between screens → testing-patterns/navigation.md
│  ├─ LazyColumn / LazyRow → testing-patterns/lists-scrolling.md
│  ├─ Form or text field → testing-patterns/forms-text-input.md
│  ├─ Dialog, sheet, menu → testing-patterns/dialogs-popups.md
│  ├─ Animation or delay → testing-patterns/animations-clock.md
│  ├─ Theme, locale, size, rotation → testing-patterns/configuration-changes.md
│  ├─ Hosts or is hosted by Views → testing-patterns/interop-views.md
│  ├─ Activity, intent, permission, back → testing-patterns/activities-intents.md
│  ├─ Pixels matter → testing-patterns/screenshot-testing.md
│  └─ Accessibility → testing-patterns/accessibility.md
│
├─ Organizing tests?
│  ├─ Shared setup → core/rules-fixtures.md
│  ├─ Repeated steps across tests → core/screen-robots.md
│  ├─ Test data → core/test-data.md
│  └─ Skip, filter, per-test config → core/annotations-filtering.md
│
├─ Test is failing or flaky?
│  ├─ Need to see the tree → debugging/debugging.md
│  ├─ Passes alone, fails in the suite → debugging/flaky-tests.md
│  ├─ Timeout / never idle → core/synchronization.md, testing-patterns/animations-clock.md
│  └─ Cryptic error → debugging/common-errors.md
│
├─ Deciding what kind of test?
│  ├─ Robolectric, instrumented, or screenshot → architecture/test-architecture.md
│  ├─ Fake or mock → architecture/when-to-mock.md
│  └─ Upgrading test APIs → architecture/migration.md
│
└─ Setting up or tuning?
   ├─ Gradle and Robolectric config → core/setup-configuration.md
   ├─ CI → infrastructure-ci-cd/ci.md
   ├─ Slow suite → infrastructure-ci-cd/performance.md
   └─ Coverage → infrastructure-ci-cd/coverage.md
```

## Test Validation Loop

After writing or modifying tests:

1. **Run the affected tests once**: `./gradlew :app:testDebugUnitTest --tests 'com.example.LoginScreenTest'`.
2. **If a test fails**: read the assertion message and the printed semantics tree, fix, re-run. See [debugging.md](debugging/debugging.md).
3. **Run the module's whole unit test task** to catch state leaking between test classes.
4. **For flaky-prone tests**, repeat them and vary the order. See [flaky-tests.md](debugging/flaky-tests.md).
5. **Remove debugging code** (`printToLog`, `Thread.sleep`, extra logging) before finishing.
