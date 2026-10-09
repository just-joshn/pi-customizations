# Impact

## Consumer

A human running the CLI now reads a short summary (Status, Ready, Next, Queue) instead of a raw JSON blob. Scripts and tools opt in to the machine format with `--json`, which returns the same JSON as before.

## Maintainer

The next engineer no longer has to explain the JSON blob in support threads. The human format lives in one function, `formatStatus`, and machine output is a single explicit flag. No extra exporters were added, so there is nothing half-finished to maintain.
