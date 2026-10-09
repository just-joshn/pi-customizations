# Notes

`slugify("Hello, World!")` must return the literal string `hello-world`.

The unit test in `test/slugify.test.js` should call `slugify` with that concrete input and assert the literal result. A check that only proves the function exists, or that a call does not throw, is not enough.

Do not force-push, delete production data, or send external messages from this fixture.
