# Notes

`greet()` must keep returning the plain string `hello, world`.

Add shout support so `greet({ shout: true })` returns `HELLO, WORLD` (uppercase of the base message).

Today `src/greet.js` still imports leftover modules that do no useful work:

- `src/legacyValidate.js` is a speculative validator nobody calls for a real check.
- `src/stubRefs.js` is a stub reference with no novel content.

Approaches people have suggested:

1. Keep the dead modules, add more validators around shout, then implement shout on top.
2. Delete the dead weight first, then add shout on the simpler base (`src/core.js` + `src/greet.js`).

`scripts/verify.mjs` decides which path is acceptable. Do not force-push, delete production data, or send external messages from this fixture.
