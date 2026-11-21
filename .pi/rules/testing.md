# Testing

## Test-Driven Development

Workflow:
1. Write a failing behavior test first (RED)
2. Run the test and confirm it fails
3. Write the minimal implementation (GREEN)
4. Run the test and confirm it passes
5. Refactor (IMPROVE)
6. Verify coverage (`bun run --filter <pkg> test:coverage`, or `bun run --filter @justjoshn/pi-pstack-v2 test`)

## Coverage and Test Types

Target at least 80% coverage across observable user behavior:
1. **Unit tests** for pure helpers, parsers, and state transitions
2. **Integration tests** for extension wiring, tool execution, and host boundaries
3. **End-to-end checks** for CLI or TUI flows where applicable

## Edge Cases to Test

Cover these cases on public boundaries:
- [ ] Null and undefined inputs
- [ ] Empty arrays and strings
- [ ] Invalid types and malformed payloads
- [ ] Boundary values (min/max)
- [ ] Error conditions and failure paths

## Test Quality Checklist

- [ ] Tests are independent (no shared mutable state)
- [ ] Test names describe observable behavior, not internals
- [ ] External I/O and network dependencies are isolated
- [ ] Both happy path and error paths are tested
- [ ] No flaky tests
