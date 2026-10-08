# Acceptance repair parent audit

This is implementation-owner inspection and reproduction, not independent review or acceptance authorization.

The original definitions remain SHA-256 `e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4`. The configurations remain `3755a29140cdbf700f01eadd5e268b3abc459152c619bd0037bfe70cc355a80f`. Both match the earlier independently authored draft bytes.

The repaired 255-line verifier was read in full. It rejects unsupported review/freeze claims, compares existing record/metadata hashes before adding entries, and distinguishes structural success from authorization. It still follows filesystem symlinks through statSync and has no comprehensive malformed-input/error boundary. It must remain draft supporting tooling, not the final gate.

The owner's selftest exited 0 when rerun by the parent. Output is `../evidence/acceptance-repair-selftest.txt`.

The first reproduction against a disposable copy of the original forged fixture exited 1 because that older fixture lacks governance.json. This was an input-error reproduction, not proof of the freeze guard. Its stack trace remains in `../evidence/acceptance-repair-forged-write.txt` and the paired verify output.

A second disposable copy received the repaired draft governance.json, without changing its forged definitions or old ledgers. Both rehash and verify exited 1. Rehash output contains 43 explicit unauthenticated-promotion findings and 43 unauthenticated-reference-run findings. The manifest and record-hash ledger stayed byte-identical before/after. Evidence is `../evidence/acceptance-repair-governance-{write,verify,before,after}.txt`.

The unmodified repaired owner directory passed its structural check against manifest digest `bfad0bc07db47217dc543841a0d6d069673df6af761a3984a6b9f58a01f25ef2`. `../evidence/acceptance-repair-structural.json` explicitly reports authorization NONE. The digest is a locally checked pin, not external custody.

The parent's counterfeit-freeze regression is now rejected for the intended reasons. External custody, authenticated transitions, complete denominator, working reference journeys, independent repair review, and the full completion gate remain open. No definitions are imported as frozen and no parity status changes.
