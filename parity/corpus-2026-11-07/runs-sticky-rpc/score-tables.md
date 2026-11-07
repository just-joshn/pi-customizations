| Scenario | Cursor mandatory | Pi mandatory | Cursor outcome | Pi outcome | Cursor valid runs | Pi valid runs |
| --- | --- | --- | --- | --- | --- | --- |
| PROMPT-IN-YOUR-OWN-WORDS | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-SHARPEN | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-HELP-NO-WORK | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-BRO-FOLLOWUP | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-NONTRIGGER-MENTION | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-POTETO-MODE-ONE-MESSAGE | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-MODE-STICKY | 0/0 | 2/2 | 0/0 | 0/2 | 0/0 | 2/2 |
| PROMPT-HOW-READONLY-EXPLORERS | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-SHELL-STATE | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-SHELL-DEFAULT-BACKGROUND | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| PROMPT-NATURAL-LANGUAGE-ROUTE | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

| Attempt | Host | Check | Class | Status | Detail |
| --- | --- | --- | --- | --- | --- |
| 01-PROMPT-MODE-STICKY-rpc-r1 | cursor | (attempt missing) | | FAIL | |
| 01-PROMPT-MODE-STICKY-rpc-r1 | pi | turn-2-reply-names-author | outcome | FAIL | {"missing":["Corpus fixture"],"final":"The local Git history reports one commit reachable from `HEAD`. I am checking the author identity and command basis before giving the final count."} |
| 01-PROMPT-MODE-STICKY-rpc-r1 | pi | turn-4-reply-names-file | outcome | FAIL | {"missing":["README.md"],"final":"This repository tracks **1 file**.\n\nCommand used:\n\n```bash\ngit ls-files -z \| awk 'BEGIN { RS=\"\\0\" } NF { count++ } END { print count+0 }'\n```\n\nNo files were changed."} |
| 02-PROMPT-MODE-STICKY-rpc-r2 | cursor | (attempt missing) | | FAIL | |
| 02-PROMPT-MODE-STICKY-rpc-r2 | pi | turn-4-no-todo | outcome | FAIL | [{"name":"TodoWrite","args":"{\"todos\":[{\"id\":\"investigation-1\",\"status\":\"cancelled\"},{\"id\":\"investigation-2\",\"status\":\"cancelled\"},{\"id\":\"investigation-3\",\"status\":\"cancelled\"},{\"id\":\"investigation-4\",\"status\":\"cancelled\"}],\" |
| 02-PROMPT-MODE-STICKY-rpc-r2 | pi | turn-2-reply-names-author | outcome | FAIL | {"missing":["Corpus fixture"],"final":"I’m checking the current branch history and all repository refs. No files or Git state will be changed."} |
| 02-PROMPT-MODE-STICKY-rpc-r2 | pi | turn-4-reply-names-file | outcome | FAIL | {"missing":["README.md"],"final":"The repository tracks **1 file**, according to `git ls-files`.\n\nNo files or Git state were changed."} |
