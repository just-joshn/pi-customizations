# Changelog

## 0.1.3

### Changed

- Update `README.md` to include the idle-continuation cap and the interrupt pause in the goal lifecycle.

## 0.1.2

### Changed

- Remove the retired `style-audit` script from `package.json`.

## 0.1.1

### Added

- Add the Pi-native Long-Lived Goals extension (`/goal`) with durable goal state, automatic idle continuation, live 1-second active duration timer, and clean pause on user interrupt.
- Register the `create_goal` and `update_goal` tools, `/goal` commands (`<objective>`, `status`, `pause`, `resume`, `complete`, `clear`), and `--no-goals` / `--goal-max-idle <n>` CLI flags.
- Add user behavior tests covering goal lifecycle transitions, continuation limits, and TUI rendering.
