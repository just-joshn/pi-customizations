# npm:@typescript/typescript-darwin-x64@7.0.2

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
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-darwin-x64@7.0.2/registry.json` sha256=`83967f3eb050df05f614960d2094e9b7e9c7eca7d3ddef88e2bd29fff9803651` bytes=2403
  - dist.integrity + name/version:
```
{
  "name": "@typescript/typescript-darwin-x64",
  "version": "7.0.2",
  "integrity": "sha512-SZ9xZInqApNlNGc9s0W1VSsktYSOe9cFqNOIqmN1Gs8SmkjKZYFt017G4VwPxASInODuAdbTW7sXiFUf893RgA==",
  "tarball": "https://registry.npmjs.org/@typescript/typescript-darwin-x64/-/typescript-darwin-x64-7.0.2.tgz"
}
```
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-darwin-x64@7.0.2/unpacked/package/package.json` sha256=`fb2abc0b67bb0f4e51867175eda95e87cdc464b253d405e2be55bc92a100a35d` bytes=1044
  - name/version/optionalDependencies|dependencies:
```
{
  "name": "@typescript/typescript-darwin-x64",
  "version": "7.0.2",
  "dependencies": null,
  "optionalDependencies": null,
  "os": [
    "darwin"
  ],
  "cpu": [
    "x64"
  ]
}
```
