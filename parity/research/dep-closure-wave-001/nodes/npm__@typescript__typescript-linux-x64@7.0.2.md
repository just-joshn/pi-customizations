# npm:@typescript/typescript-linux-x64@7.0.2

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
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-linux-x64@7.0.2/registry.json` sha256=`754a96664c15d55e0c7ccba0d9fbe811311a4cb1c0235ae9b6aab062a281a788` bytes=2397
  - dist.integrity + name/version:
```
{
  "name": "@typescript/typescript-linux-x64",
  "version": "7.0.2",
  "integrity": "sha512-EYdf2cNg7rgCWJnxCdJ+F3V39O8ihb37eHAu1LK8oAFizgTQbPOK7zHHXbPt8rX24COqODXeI3sIf0fCXG7H/A==",
  "tarball": "https://registry.npmjs.org/@typescript/typescript-linux-x64/-/typescript-linux-x64-7.0.2.tgz"
}
```
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-linux-x64@7.0.2/unpacked/package/package.json` sha256=`d229521d1ab1d09e60eeb887c8be8e9454a1ea184fe801dcbfa276da3c569cf7` bytes=1042
  - name/version/optionalDependencies|dependencies:
```
{
  "name": "@typescript/typescript-linux-x64",
  "version": "7.0.2",
  "dependencies": null,
  "optionalDependencies": null,
  "os": [
    "linux"
  ],
  "cpu": [
    "x64"
  ]
}
```
