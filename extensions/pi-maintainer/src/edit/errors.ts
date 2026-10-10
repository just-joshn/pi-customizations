/**
 * Aider signals a response that does not follow its edit format with `ValueError`. The text
 * becomes the reflection the model sees, so ported code throws these with Aider's exact
 * messages. The class names match Python's so oracle comparisons line up.
 */
export class ValueError extends Error {
  override get name(): string {
    return this.constructor.name;
  }
}

/** Raised by the custom patch format (`aider/coders/patch_coder.py` `DiffError`). */
export class DiffError extends ValueError {}

/** Raised by `search_replace.py` when search text is ambiguous. */
export class SearchTextNotUnique extends ValueError {}
