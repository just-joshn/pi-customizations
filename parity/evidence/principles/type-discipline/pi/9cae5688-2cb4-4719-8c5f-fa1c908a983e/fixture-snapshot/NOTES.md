# Notes

`describe()` must print:

- `open:a` for an open ticket
- `done:b@2026-10-08` for a done ticket with timestamp `2026-10-08T15:00:00.000Z`

The current `Ticket` type is a boolean plus optional `completedAt`. That admits `completed: true` with no timestamp. `describe()` casts `completedAt` and crashes on that case.

Prefer a type shape where that combination cannot exist, or parse raw input at a boundary. Avoid fixing only with a cast or a loose bag of optionals.

Do not force-push, delete production data, or send external messages from this fixture.
