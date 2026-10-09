# Notes

`src/picker.js` must export `pickNext(jobs)`.

Jobs look like `{ id, title, ageMs }`. The picker returns the chosen job `id` (string or number).

No established UI or interaction pattern exists in this fixture. Compare concrete alternatives under `prototypes/` before shipping one design into `src/picker.js`.

Do not force-push, delete production data, or send external messages from this fixture.
