// Request validation with zod. Invalid input answers 400 with field paths,
// never with the submitted values.
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      'invalidInput',
      result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
    );
  }
  return result.data;
}
