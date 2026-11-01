# Unit report: image generation substitute (gap-list item 2)

**Goal.** Close the silent-fallback gap for ketchup and visual recipes when Pi has no image model. Make the codemode plus image-model gate and the Mermaid or table substitute an explicit, tested package contract.

**Does not claim.** Generated-image artifact parity with hosts that ship an image tool. Full package parity acceptance.

## Contract (already shipped)

`extensions/pi-pstack/src/sections.ts` `hostSection` includes:

```text
Image generation: codemode's models.generateImages() when codemode is on and an image model is configured. Otherwise say no image tool is available and use a mermaid diagram or a table.
```

That matches `parity/pi-pstack-0.15.36/design.md` vocabulary (`image generation tool` → Pi codemode `models.generateImages()` when configured, else Mermaid). Ketchup's Visuals section lists Mermaid, `visualize`, and generated image as visual classes; the host section is what tells the agent when generation is unavailable and what to use instead.

No fake image generator was added. `sections.ts` wording was left unchanged.

## Change this unit

| Path | Action |
| --- | --- |
| `extensions/pi-pstack/test/sections.test.ts` | Added assertion that `hostSection` states the gate and Mermaid/table substitute |
| `parity/evidence/.../image-gen-unit-report.md` | This report |

## User-facing failure mode

When codemode is off or no image model is configured, the agent must say no image tool is available and fall back to a Mermaid diagram or a table. That path is no longer only implied by skill text; the host section states it, and the unit test fails if the line is removed or softened into silence.

## Test

Command (from `extensions/pi-pstack`):

```text
bun run test test/sections.test.ts
```

Result (2026-10-31):

```text
Test Files  1 passed (1)
     Tests  6 passed (6)
```

New assertion: `host section names the codemode and image-model gate and the Mermaid or table substitute`.

## Principles applied

- **Laziness Protocol.** No new generator and no `sections.ts` edit when the line already named the gate and substitute.
- **Prove It Works.** Contract pinned by running `sections.test.ts` against `hostSection` output.
- **Experience First.** The unavailable path must tell the user (via the agent) that images are out and name the substitute, not fail quietly.
