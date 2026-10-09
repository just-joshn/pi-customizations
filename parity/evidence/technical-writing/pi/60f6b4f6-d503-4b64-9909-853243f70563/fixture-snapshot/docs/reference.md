# greet argv reference

`src/greet.js` reads `process.argv` and writes one line to standard output.

## Synopsis

```sh
node src/greet.js [name]
```

## Arguments

| Position | Name | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `process.argv[2]` | `name` | No | `world` | The text to greet. |

## Behavior

- The command prints `hello, ` followed by `name`, then a newline.
- If `process.argv[2]` is `undefined`, `name` is `world`.
- If `process.argv[2]` is an empty string, `name` is the empty string and the output is `hello, `.
- The command ignores every argument after `process.argv[2]`.
- The command has no flags. A value that starts with `-`, such as `--help`, is used as `name`.

## Output

| Input | Standard output |
| --- | --- |
| (no arguments) | `hello, world` |
| `Ada` | `hello, Ada` |
| `"Ada Lovelace"` | `hello, Ada Lovelace` |
| `Ada Lovelace` (unquoted) | `hello, Ada` |

## Exit status

The command always exits with status `0`. It does not validate `name`.
