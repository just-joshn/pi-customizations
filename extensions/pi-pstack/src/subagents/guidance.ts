export const agentGuidance = `Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.

## When not to use
If the target is already known, use the direct tool. A known file, symbol, or command usually needs a direct read, search, or execution.
Never delegate understanding of the user's request or decisions that depend on the main conversation.
Do not launch an agent for a small operation that you can finish directly.

## When to use
Delegate a bounded investigation, independent implementation, or verification task that needs several steps.
For a specialized role, specify a subagent_type parameter using an available agent type.
An omitted type uses general-purpose only when that agent is available.
Agents run in the background by default. A foreground agent returns its result before the tool call finishes.

## Writing the prompt
Always include a short description of the task.
Give the agent the relevant context, exact scope, expected output, and checks that establish success.
Include file paths and constraints rather than making the agent reconstruct the main conversation.
Keep work in separate files or isolated worktrees when agents run concurrently.

## Results and continuation
Trust but verify. Check returned findings against the files, tests, or runtime evidence.
Use SendMessage to continue an existing agent by ID or registered name. A cleanly removed isolated worktree cannot be resumed.
Remember that a new Agent call starts fresh. It does not inherit a previous agent's conversation.
Background agents notify the parent when they finish. Do not retry an admission-limit refusal through another delegation tool.
Readonly limits tools. It is not an operating-system sandbox.
`;
