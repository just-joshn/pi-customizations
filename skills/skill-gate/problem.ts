export type Problem = { kind: 'line'; rel: string; line: number; message: string } | { kind: 'file'; rel: string; message: string } | { kind: 'skill'; message: string };

export function formatProblem(problem: Problem): string {
  switch (problem.kind) {
    case 'line':
      return `${problem.rel}:${problem.line} ${problem.message}`;
    case 'file':
      return `${problem.rel}: ${problem.message}`;
    case 'skill':
      return problem.message;
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
}
