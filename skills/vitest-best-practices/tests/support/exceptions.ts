/** A known, explained type error in one block. `checkFile` reports the exception if the error stops occurring. */
export interface TypecheckException {
  file: string;
  blockContains: string;
  codes: number[];
  reason: string;
}

const ANY_SUBJECT = 'type assertions on a subject imported from a file the example does not include, so it is `any`';
const UNUSED_EXPECT_ERROR = 2578;
const NOT_CALLABLE = 2349;
const WRONG_ARG_COUNT = 2554;

export const exceptions: TypecheckException[] = [
  { file: 'architecture/test-architecture.md', blockContains: "import { mount } from './mount'", codes: [NOT_CALLABLE, UNUSED_EXPECT_ERROR], reason: ANY_SUBJECT },
  { file: 'testing-patterns/type-testing.md', blockContains: "import { pick } from './pick'", codes: [UNUSED_EXPECT_ERROR], reason: ANY_SUBJECT },
  { file: 'testing-patterns/type-testing.md', blockContains: "import { createStore, isUser, parse } from './lib'", codes: [NOT_CALLABLE], reason: ANY_SUBJECT },
  { file: 'testing-patterns/type-testing.md', blockContains: 'assertType(getUser({ id: 42 }))', codes: [WRONG_ARG_COUNT], reason: ANY_SUBJECT },
];
