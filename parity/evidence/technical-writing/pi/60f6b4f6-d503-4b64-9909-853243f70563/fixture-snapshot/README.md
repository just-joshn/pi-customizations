# How to greet someone with greet

`greet` is a Node.js command that prints a greeting. It needs no install step and has no dependencies.

## Greet the world

To print the default greeting, run the start script:

```sh
npm start
```

The command prints:

```
hello, world
```

## Greet a person

To greet a person, pass the name after `--`. The `--` tells npm to give the argument to `greet`.

```sh
npm start -- Ada
```

The command prints:

```
hello, Ada
```

## Greet a person with a name that has spaces

Quote the name so the shell passes it as one argument.

```sh
npm start -- "Ada Lovelace"
```

## Run the file without npm

If you do not use npm, run the file with Node.js:

```sh
node src/greet.js Ada
```

## Look up the argument rules

For the exact handling of arguments, read the [argv reference](docs/reference.md).
