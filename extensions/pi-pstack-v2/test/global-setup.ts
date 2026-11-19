import { detectRuntime, ensureImage } from '../src/container.ts';

/** Builds the job image once before any test file runs, since the first launch of a cold image takes longer than a test may. */
export default function setup(): void {
  try {
    ensureImage(detectRuntime());
  } catch {
    // Without a runtime the live tests skip themselves, and a failed build surfaces in the first test that starts a job.
  }
}
