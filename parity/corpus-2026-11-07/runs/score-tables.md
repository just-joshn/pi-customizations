| Scenario | Cursor mandatory | Pi mandatory | Cursor outcome | Pi outcome | Cursor valid runs | Pi valid runs |
| --- | --- | --- | --- | --- | --- | --- |
| PROMPT-IN-YOUR-OWN-WORDS | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-SHARPEN | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-HELP-NO-WORK | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 | 3/3 |
| PROMPT-BRO-FOLLOWUP | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-NONTRIGGER-MENTION | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-POTETO-MODE-ONE-MESSAGE | 2/2 | 2/2 | 2/2 | 1/2 | 2/2 | 2/2 |
| PROMPT-MODE-STICKY | 2/2 | 0/2 | 0/2 | 0/2 | 2/2 | 2/2 |
| PROMPT-HOW-READONLY-EXPLORERS | 0/2 | 2/2 | 0/2 | 2/2 | 0/2 | 2/2 |
| PROMPT-SHELL-STATE | 0/2 | 2/2 | 0/2 | 2/2 | 0/2 | 2/2 |
| PROMPT-SHELL-DEFAULT-BACKGROUND | 0/2 | 1/2 | 0/2 | 1/2 | 0/2 | 2/2 |
| PROMPT-NATURAL-LANGUAGE-ROUTE | 0/2 | 2/2 | 0/2 | 2/2 | 0/2 | 2/2 |

| Attempt | Host | Check | Class | Status | Detail |
| --- | --- | --- | --- | --- | --- |
| 07-PROMPT-HELP-NO-WORK-r1 | pi | text-presence | outcome | FAIL | {"missing":["https://github.com/"],"final":"Use **`/how`**. It explains a module’s architecture, key concepts, runtime flow, file ownership, and gotchas—without changing code.\n\nExample prompt:\n\n```text\n/how Explain how the authentication module works, inc |
| 08-PROMPT-HELP-NO-WORK-r2 | pi | text-presence | outcome | FAIL | {"missing":["https://github.com/"],"final":"Use **`/how`**. It explains how a module works, including its architecture, runtime flow, key concepts, file locations, and gotchas—without changing code.\n\nExample prompt:\n\n```text\n/how Explain how the authentic |
| 09-PROMPT-HELP-NO-WORK-r3 | pi | text-presence | outcome | FAIL | {"missing":["https://github.com/"],"final":"Use **`/how`**. It explains a module’s architecture, key concepts, runtime flow, file locations, and gotchas—without focusing on the historical reasons behind the design.\n\nSend:\n\n```text\n/how Explain how the <mo |
| 17-PROMPT-POTETO-MODE-ONE-MESSAGE-r2 | pi | reply-names-count-and-author | outcome | FAIL | {"missing":["1","Corpus fixture"],"final":"No follow-up is needed."} |
| 18-PROMPT-MODE-STICKY-r1 | cursor | turn-4-reply-names-file | outcome | FAIL | {"missing":["README.md"],"final":"The repository tracks 1 file. Nothing was changed."} |
| 18-PROMPT-MODE-STICKY-r1 | pi | turn-2-playbook-read | mandatory | FAIL | [] |
| 18-PROMPT-MODE-STICKY-r1 | pi | turn-2-todo-first-item-is-playbook-step-1 | mandatory | FAIL | "no playbook read" |
| 18-PROMPT-MODE-STICKY-r1 | pi | turn-4-reply-names-file | outcome | FAIL | {"missing":["README.md"],"final":"This repository tracks **1 file**. No files were changed."} |
| 19-PROMPT-MODE-STICKY-r2 | cursor | turn-4-reply-names-file | outcome | FAIL | {"missing":["README.md"],"final":"The repository tracks **1 file**. Nothing was changed."} |
| 19-PROMPT-MODE-STICKY-r2 | pi | turn-2-playbook-read | mandatory | FAIL | [] |
| 19-PROMPT-MODE-STICKY-r2 | pi | turn-2-todo-first-item-is-playbook-step-1 | mandatory | FAIL | "no playbook read" |
| 19-PROMPT-MODE-STICKY-r2 | pi | turn-4-reply-names-file | outcome | FAIL | {"missing":["README.md"],"final":"This repository tracks **1 file**. No files were changed."} |
| 20-PROMPT-HOW-READONLY-EXPLORERS-r1 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 20-PROMPT-HOW-READONLY-EXPLORERS-r1 | cursor | every-task-readonly | mandatory | UNVERIFIED | {"reason":"readonly not present in host events","values":[null,null,null,null]} |
| 20-PROMPT-HOW-READONLY-EXPLORERS-r1 | cursor | explainer-sections | outcome | FAIL | {"missing":["Overview","How It Works"],"final":""} |
| 20-PROMPT-HOW-READONLY-EXPLORERS-r1 | cursor | names-git-parts | outcome | FAIL | {"missing":["HEAD","index","blob"],"final":""} |
| 21-PROMPT-HOW-READONLY-EXPLORERS-r2 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 21-PROMPT-HOW-READONLY-EXPLORERS-r2 | cursor | task-delegated | mandatory | FAIL | 0 |
| 21-PROMPT-HOW-READONLY-EXPLORERS-r2 | cursor | every-task-readonly | mandatory | UNVERIFIED | "no Task calls" |
| 21-PROMPT-HOW-READONLY-EXPLORERS-r2 | cursor | every-task-general-purpose | mandatory | UNVERIFIED | "no Task calls" |
| 21-PROMPT-HOW-READONLY-EXPLORERS-r2 | cursor | explorer-path | outcome | FAIL | 0 |
| 21-PROMPT-HOW-READONLY-EXPLORERS-r2 | cursor | explainer-sections | outcome | FAIL | {"missing":["Overview","How It Works"],"final":""} |
| 21-PROMPT-HOW-READONLY-EXPLORERS-r2 | cursor | names-git-parts | outcome | FAIL | {"missing":["HEAD","index","blob"],"final":""} |
| 22-PROMPT-SHELL-STATE-r1 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 22-PROMPT-SHELL-STATE-r1 | cursor | state-persists-across-calls | mandatory | FAIL | {"reason":"no setting call","commands":[]} |
| 22-PROMPT-SHELL-STATE-r1 | cursor | exactly-two-shell-calls | outcome | FAIL | 0 |
| 22-PROMPT-SHELL-STATE-r1 | cursor | reply-reports-state | outcome | FAIL | {"missing":["/usr","probe=42"],"final":""} |
| 23-PROMPT-SHELL-STATE-r2 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 23-PROMPT-SHELL-STATE-r2 | cursor | state-persists-across-calls | mandatory | FAIL | {"reason":"no setting call","commands":[]} |
| 23-PROMPT-SHELL-STATE-r2 | cursor | exactly-two-shell-calls | outcome | FAIL | 0 |
| 23-PROMPT-SHELL-STATE-r2 | cursor | reply-reports-state | outcome | FAIL | {"missing":["/usr","probe=42"],"final":""} |
| 24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1 | cursor | single-loop-call | mandatory | FAIL | 0 |
| 24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1 | cursor | default-background-move | mandatory | FAIL | "no matching shell call" |
| 24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1 | cursor | awaited-after-move | mandatory | FAIL | "no matching shell call" |
| 24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1 | cursor | finished-observed | mandatory | FAIL | "no matching shell call" |
| 24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1 | cursor | reply-reports-finished | outcome | FAIL | {"missing":["FINISHED"],"final":""} |
| 24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1 | pi | reply-reports-finished | outcome | FAIL | {"missing":["FINISHED"],"final":"No follow-up needed."} |
| 25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2 | cursor | single-loop-call | mandatory | FAIL | 0 |
| 25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2 | cursor | default-background-move | mandatory | FAIL | "no matching shell call" |
| 25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2 | cursor | awaited-after-move | mandatory | FAIL | "no matching shell call" |
| 25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2 | cursor | finished-observed | mandatory | FAIL | "no matching shell call" |
| 25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2 | cursor | reply-reports-finished | outcome | FAIL | {"missing":["FINISHED"],"final":""} |
| 25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2 | pi | finished-observed | mandatory | FAIL | "not in any tool result or notification" |
| 26-PROMPT-NATURAL-LANGUAGE-ROUTE-r1 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 26-PROMPT-NATURAL-LANGUAGE-ROUTE-r1 | cursor | setup-pstack-skill-read | mandatory | FAIL | [] |
| 26-PROMPT-NATURAL-LANGUAGE-ROUTE-r1 | cursor | budget-labels | outcome | FAIL | {"missing":["unlimited","large","medium","small"],"final":""} |
| 27-PROMPT-NATURAL-LANGUAGE-ROUTE-r2 | cursor | run-valid | mandatory | FAIL | ["turn 1 exit 1 timedOut false","turn 1 not completed"] |
| 27-PROMPT-NATURAL-LANGUAGE-ROUTE-r2 | cursor | setup-pstack-skill-read | mandatory | FAIL | [] |
| 27-PROMPT-NATURAL-LANGUAGE-ROUTE-r2 | cursor | budget-labels | outcome | FAIL | {"missing":["unlimited","large","medium","small"],"final":""} |
