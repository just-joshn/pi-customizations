# Clean-room rules

Reimplement the behavior. Do not reimplement the private implementation.

## Permitted evidence

- Public documentation and published interfaces such as CLI help, schemas, manifests, and config references.
- Reference implementations whose license permits inspection.
- Specifications provided by the user.
- Authorized black-box observations of the running source harness.
- Tests you write yourself.

## Forbidden

- Copying proprietary source, private implementation details, protected prose, or non-public assets without explicit authorization.
- Hiding copied code behind renames, mechanical translation, or superficial rewrites.
- Mirroring the source's module layout, types, or control flow because the source has them. Design the target's types, boundaries, state ownership, control flow, and error handling independently.

## Rules

- Preserve the behavior users can observe. Do not preserve accidents of the source implementation unless a compatibility requirement makes the accident part of the contract. When it does, record that requirement.
- Respect licenses, attribution, third-party notices, and usage restrictions. When a prompt or skill text carries a license, either preserve its notice or write the text fresh.
- Record the source of every material requirement in `spec.md`. Label each one as a **documented fact**, **measured observation**, **inference**, or **unknown**.
- If you cannot legally or technically inspect an artifact, say so. Build from the strongest permitted evidence and mark what remains uncertain as INCONCLUSIVE.
- Treat an internal function's behavior as different from the full feature contract. Trace callers and consumers before you generalize from it.
