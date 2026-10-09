VERIFIED

Claim: probe.txt contains exact line VALUE=7.

Evidence: baseline=`VALUE=7$` (grep -nx match at line 1), treatment (unedited file) identical, delta=none, threshold=exact line match.

Reasoning: The file is 8 bytes, a single line `VALUE=7` plus newline; no confounds.
