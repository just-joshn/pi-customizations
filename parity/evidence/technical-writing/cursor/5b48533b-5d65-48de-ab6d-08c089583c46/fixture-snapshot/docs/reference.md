# greet CLI argv reference

`src/greet.js` reads its name from `process.argv`.

## Invocation

| Form | Meaning |
| --- | --- |
| `node src/greet.js` | No name argument. |
| `node src/greet.js <name>` | One name argument. |
| `npm start` | Runs `node src/greet.js` with no name argument. |

## Arguments

| Index | Role | Required | Default |
| --- | --- | --- | --- |
| `process.argv[0]` | Node executable path | Yes, set by the runtime | Runtime value |
| `process.argv[1]` | Script path (`src/greet.js`) | Yes, set by the runtime | Runtime value |
| `process.argv[2]` | Greeting name | No | `world` |

`greet` ignores `process.argv` entries at index 3 and above.

## Output

`greet` writes one line to stdout:

```text
hello, <name>
```

`<name>` is `process.argv[2]` when that value is present. Otherwise `<name>` is `world`.

## Exit behavior

On a normal run, `greet` exits with code `0` after it prints the greeting line.
