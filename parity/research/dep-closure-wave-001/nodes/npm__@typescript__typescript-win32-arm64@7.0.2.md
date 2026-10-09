# npm:@typescript/typescript-win32-arm64@7.0.2

Previously incomplete: True

## Disposition

Lock entry, registry metadata, tarball, and package.json read. No further npm dependencies. Platform os/cpu constraints recorded. Native binary contents inventoried at file-hash level where unpacked.

proposeReadingComplete: True
proposeDependenciesEnumerated: True

## Sources

- `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock` sha256=`667d9cf7222e9aae3fa42a4be383e657784216e9df115da02227fbc5ac7bbe46` bytes=6679
  - packages["typescript"]:
```
    "typescript": ["typescript@7.0.2", "", { "optionalDependencies": { "@typescript/typescript-aix-ppc64": "7.0.2", "@typescript/typescript-darwin-arm64": "7.0.2", "@typescript/typescript-darwin-x64": "7.0.2", "@typescript/typescript-freebsd-arm64": "7.0.2", "@typescript/typescript-freebsd-x64": "7.0.2", "@typescript/typescript-linux-arm": "7.0.2", "@typescript/typescript-linux-arm64": "7.0.2", "@typescript/typescript-linux-loong64": "7.0.2", "@typescript/typescript-linux-mips64el": "7.0.2", "@t
```
  - packages["bun-types"]:
```
    "bun-types": ["bun-types@1.3.14", "", { "dependencies": { "@types/node": "*" } }, "sha512-4N0ig0fEomHt5R0KCFWjovxow98rIoRwKolrYdCcknNwMekCXRnWEUvgu5soYV8QXtVsrUD8B95MBOZGPvr6KQ=="],
```
  - packages["@types/node"]:
```
    "@types/node": ["@types/node@26.1.2", "", { "dependencies": { "undici-types": "~8.3.0" } }, "sha512-Vu4a5UFA9rIIFJ7rB/Vaafh9lrCQszopTCx6KjFboXTGQbPNasehVR5TEiithSDGyd1DEiUByggTZsg8jukeIg=="],
```
  - packages["undici-types"]:
```
    "undici-types": ["undici-types@8.3.0", "", {}, "sha512-j375ScV60dom+YkPFIfTLcOiPxkN/buHz5GobjLhixFuANaNs3C9l4GmrWqejgXWJ7BbJcFYpTEUkS1Ge8bpZQ=="],
```
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-win32-arm64@7.0.2/registry.json` sha256=`aefca014db296c2636b8fee27b018ee2d8639abe282ac42d3bc8b222fd8b17d5` bytes=2412
  - dist.integrity + name/version:
```
{
  "name": "@typescript/typescript-win32-arm64",
  "version": "7.0.2",
  "integrity": "sha512-Gyl1Vy6OsWesLzmq+EP0Fb7b4Nid5232AvcA2SFcdYreldpNtYFFofPjnt62y9hQy7VTaZp65ICJjuAQRaVcIQ==",
  "tarball": "https://registry.npmjs.org/@typescript/typescript-win32-arm64/-/typescript-win32-arm64-7.0.2.tgz"
}
```
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-win32-arm64@7.0.2/unpacked/package/package.json` sha256=`227fe5f68cc1c131ef45ee9dbc9509fc5f8b1e895fe9209e66c4d771903950b3` bytes=1046
  - name/version/optionalDependencies|dependencies:
```
{
  "name": "@typescript/typescript-win32-arm64",
  "version": "7.0.2",
  "dependencies": null,
  "optionalDependencies": null,
  "os": [
    "win32"
  ],
  "cpu": [
    "arm64"
  ]
}
```
