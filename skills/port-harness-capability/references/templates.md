# Templates

## Behavioral specification

`parity/<capability>/spec.md`

```markdown
# <capability> behavioral specification

## Sources
| Ref | Kind (doc / fixture / observation / permitted source) | Location | License or authorization |

## Scope
- In scope: …
- Out of scope (surrounding harness): …
- Source-internal dependencies and their Pi replacements: …

## Requirements
### <ID>: <short title>
- Trigger: <user action or system event>
- Preconditions and config: …
- Input → expected output: …
- State transitions and side effects: …
- Success and failure semantics: …
- Timing and ordering: …
- Platform and mode: <interactive | print/json | rpc | sdk>, <os>
- Evidence: <ref>, **<fact | observation | inference | unknown>**, confidence <high | medium | low>
- Acceptance test: <path::name> (status lives in ledger.json)

## Unknowns
| Question | Why it matters | How it could be resolved |
```

## Design record

`parity/<capability>/decisions.md`

For each material decision, record:

- The options, with at least two structurally different designs.
- How each option compares on coverage, API fit, complexity, security, testability, packaging, and maintenance cost.
- The choice, the rejected alternative, and the evidence: the doc path or `.d.ts` line that backs each API used.
- The domain model: entities, which component owns each piece of state, invariants, lifetimes, concurrency, idempotency, and validation boundaries.

## Final acceptance report

```markdown
## Implementation summary
<the user-visible behavior now supported, and the Pi mechanism used>

## Artifact map
| File | Responsibility |
Package structure. Activation path (exact commands).

## Source-to-Pi mapping
| Source behavior | Pi behavior | Requirement IDs |

## Verification results
Commands actually executed, with their pass/fail counts. CLI scenarios exercised. Packaging checks. Reference comparisons.
Output of `validate-ledger.mjs`.

## Parity status
VERIFIED n · NOT VERIFIED n · INCONCLUSIVE n · NOT APPLICABLE n
Critical gaps: …
Each claim links to a test, fixture, file, or recorded observation.

## Security and maintenance
Risks, dependencies, state ownership, configuration, and maintenance obligations (for example, Pi API drift).

## Remaining gaps
What could not be reproduced or proven, and why.

## Final verdict
**VERIFIED | NOT VERIFIED | INCONCLUSIVE**, the verdict derived by the validator.
```
