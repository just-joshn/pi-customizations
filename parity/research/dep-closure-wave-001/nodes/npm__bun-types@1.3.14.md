# npm:bun-types@1.3.14

Previously incomplete: True

## Disposition

Lock entry, registry metadata, tarball, package.json, and file inventory completed for this types package.

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
- `parity/research/dep-closure-wave-001/npm/bun-types@1.3.14/registry.json` sha256=`3baf9d74262e53e49e44ce17be2a6dd38ae8d56fb5725fc249abdd93dd53d4a6` bytes=1570
  - dist.integrity + name/version:
```
{
  "name": "bun-types",
  "version": "1.3.14",
  "integrity": "sha512-4N0ig0fEomHt5R0KCFWjovxow98rIoRwKolrYdCcknNwMekCXRnWEUvgu5soYV8QXtVsrUD8B95MBOZGPvr6KQ==",
  "tarball": "https://registry.npmjs.org/bun-types/-/bun-types-1.3.14.tgz"
}
```
- `parity/research/dep-closure-wave-001/npm/bun-types@1.3.14/unpacked/package/package.json` sha256=`01e8dc24f53869ebf700a038510de8061a8325d10a85406711184e4b9fc76f43` bytes=808
  - name/version/optionalDependencies|dependencies:
```
{
  "name": "bun-types",
  "version": "1.3.14",
  "dependencies": {
    "@types/node": "*"
  },
  "optionalDependencies": null,
  "os": null,
  "cpu": null
}
```
