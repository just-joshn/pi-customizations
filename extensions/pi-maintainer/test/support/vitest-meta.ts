import 'vitest';

declare module 'vitest' {
  interface TaskMeta {
    /** Aider test functions this test ports, as `<module>/<Class.test_name>` census ids. */
    aider?: string[];
    /** Evidence probe cases this test replays, as census unit ids. */
    evidence?: string[];
  }
}
