# Third-party notices

## pi-rea

MIT licensed; see the repository [LICENSE](../../LICENSE).

## Interface compatibility

pi-rea implements the published tool interface of REA — Reverse Engineer
Anything (`rea-agents`, MIT, https://github.com/morluto/rea) so a client or
agent written against REA's tool names, parameter names and result shapes can
use this extension.

Only interface facts are transcribed into `schemas/tool-contracts.json`: tool
names, parameter names, parameter types, bounds, required sets, annotation and
effect flags, surfaces, client requirements, mode facts, and observed result
shapes. No REA source code, prose, title, example, default value, per-mode
remediation text or output schema is included, and this extension does not
depend on, install, invoke or contact REA. Descriptions in the contract file are
written by this project.

The REA repository is the source of the compatibility target and is credited
here for that reason. It is not a dependency and is not distributed with this
package.
