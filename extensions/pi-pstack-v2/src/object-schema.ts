import { z } from 'zod';

/**
 * A schema for data the original code read as given, with a type but no check. It accepts any object and returns that
 * same object, so key order, extra keys, missing keys, and values of any type pass through exactly as they did. z.object
 * would strip extra keys, reorder known ones first, and reject a missing or null optional field.
 */
export const passthroughObject = <T extends object>() => z.custom<T>((value) => typeof value === 'object' && value !== null);
