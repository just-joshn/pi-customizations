# Changelog

## Unreleased

- Fix Cloud Code Assist rejecting every request with `400 Invalid JSON payload`. Tool schemas with `type` unions or `exclusiveMinimum`/`exclusiveMaximum` are now reduced to the OpenAPI subset the API accepts.

## [0.1.2]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
