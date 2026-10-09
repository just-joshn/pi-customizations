# Decision

| id | shape | tradeoff |
|---|---|---|
| sort-oldest | filter, full sort | simple, O(n log n), no tie-break |
| single-pass-reduce | one-pass fold | O(n), no allocation, ties and priority hard-coded |
| rule-table | ordered comparator table | extensible to priority and tie-breaks, slightly heavier |

Jobs are tiny lists, but a picker needs deterministic ties and likely a priority later. Rule table encodes that as data (model-the-domain) without scattering conditionals.

CHOSEN: rule-table
