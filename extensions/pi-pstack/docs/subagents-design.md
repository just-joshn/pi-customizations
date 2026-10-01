# Subagent architecture decision

The three sketches were compared on native pi feasibility, source fidelity, preservation of existing behavior, lifecycle ownership, and migration size. Candidate A won with 21 points. Candidate B scored 17 and C scored 15. The configured reviewers inherit the parent model, so this is independent exploration without model diversity.

Keep WorkerRuntime as the sole lifecycle owner. Add focused behavior to its existing session, cancellation, settlement, and generation fences. Borrow execution identity checks from B when current fences are insufficient. Borrow C's native capability probe before exposing forks or remote execution. Avoid a second task registry.

All candidates proposed freezing prior definitions on resume. Source L406629 disproves that premise. Resume resolves the current active definition and rechecks current tool and permission authority. Preserve durable identity, model request, depth, workspace, and provenance instead. Existing definition rediscovery remains.

The first verifiable unit corrects source-proven precedence, model fallback, Unicode diagnostic names, and model transition history. The next protects against silent executable configuration loss and implements the named-agent contract under an explicit pi capability profile. Captured source probes omit name and deprecated fields, while the static parser supports them. Those are distinct source contexts.

Explicit refusals for unsupported behavior count as unresolved parity. Real cloud/session URLs, permission enforcement, observer delivery, and teammate behavior require working implementations and evidence.
