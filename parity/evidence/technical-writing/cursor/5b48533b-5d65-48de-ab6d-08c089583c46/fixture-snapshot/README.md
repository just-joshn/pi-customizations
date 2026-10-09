# greet

Print a greeting from the command line.

## Run a default greeting

1. Open a terminal in this directory.
2. Run:

	```bash
	npm start
	```

3. Confirm the terminal prints:

	```text
	hello, world
	```

## Greet someone by name

1. Pass the name as the first argument after the script:

	```bash
	node src/greet.js Ada
	```

2. Confirm the terminal prints:

	```text
	hello, Ada
	```

If you omit the name, `greet` uses `world`.

## Look up the argv contract

For the exact `process.argv` shape, defaults, and output form, see [greet CLI argv reference](docs/reference.md).
