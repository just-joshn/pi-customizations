# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.
# budget: custom (per-role picks: Opus 5.5 / Sonnet 5.5 medium; GPT-6.1 Sol/Terra low; DeepSeek Flash and GLM-5.3-Flash max)
feature, refactoring: openai/gpt-6.1-sol:low
bug-fix: openai/gpt-6.1-sol:low
perf-issue: openai/gpt-6.1-terra:low
hillclimb: openai/gpt-6.1-sol:low
judgment and prose: claude-subscription/claude-opus-5-5:medium
hardest tasks: openai/gpt-6.1-terra:low
how explorer: deepseek/deepseek-flash:max
how explainer: claude-subscription/claude-opus-5-5:medium
why investigators: deepseek/deepseek-flash:max
why synthesizer: openai/gpt-6.1-terra:low
reflect tooling: claude-subscription/claude-sonnet-5-5:medium
reflect judgment, divergent, synthesizer: claude-subscription/claude-opus-5-5:medium
arena runners: openai/gpt-6.1-sol:low, claude-subscription/claude-opus-5-5:medium
arena cross-judge pool: openai/gpt-6.1-terra:low, claude-subscription/claude-opus-5-5:medium, zai/glm-5.3-flash:max
swarm workers: deepseek/deepseek-flash:max
architect runners: openai/gpt-6.1-terra:low, claude-subscription/claude-opus-5-5:medium
interrogate reviewers: openai/gpt-6.1-terra:low, claude-subscription/claude-opus-5-5:medium, zai/glm-5.3-flash:max
