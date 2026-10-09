# Notes

Tickets today use two booleans (`isDraft`, `isOpen`). Labels are DRAFT, OPEN, or CLOSED.

Product needs a hold path. A held ticket must label as HELD. Closing a held ticket must fail until it is released back to open.

Adding another boolean that must stay in sync with `isDraft` and `isOpen` is easy to get wrong. Prefer a shape that makes illegal combinations hard to represent.

Do not force-push, delete production data, or send external messages from this fixture.
