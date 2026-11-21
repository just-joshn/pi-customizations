# Security

## Mandatory Security Checks

Before any commit:
- [ ] No hardcoded secrets (API keys, OAuth tokens, passwords, credentials)
- [ ] All external inputs validated at boundaries
- [ ] File paths and subprocess arguments sanitized (no command injection or path traversal)
- [ ] Error messages and logs do not leak tokens or sensitive data
- [ ] Network egress and sandbox boundaries enforced where applicable

## Secret Management

```ts
// NEVER: Hardcoded secrets
const apiKey = 'sk-proj-xxxxx';

// ALWAYS: Environment variables or secure secret store
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('API_KEY not configured');
```

## Security Response Protocol

If a security issue is found:
1. STOP immediately
2. Use `security-reviewer` agent (`~/.agents/agents/security-reviewer.md`)
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review the codebase for similar issues
