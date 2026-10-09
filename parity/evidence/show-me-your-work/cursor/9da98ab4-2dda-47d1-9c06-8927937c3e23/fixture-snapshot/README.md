# greet fixture

Tiny held-out two-phase task for `/show-me-your-work`.

- `src/greet.js` exports `greet()` returning `hi`.
- Phase 1 makes it return `hello`.
- Phase 2 adds `farewell()` returning `bye`.

Run: `node -e "import('./src/greet.js').then(m => console.log(m.greet()))"`
