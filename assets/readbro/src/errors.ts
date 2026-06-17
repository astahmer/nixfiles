import * as Schema from "effect/Schema";

export class CompostoSpawnError extends Schema.TaggedError<CompostoSpawnError>()(
  "CompostoSpawnError",
  {
    command: Schema.String,
    cwd: Schema.String,
    cause: Schema.Any,
  },
) {
  get message(): string {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `failed to run ${this.command} in ${this.cwd}: ${detail}`;
  }
}

export class CompostoCommandError extends Schema.TaggedError<CompostoCommandError>()(
  "CompostoCommandError",
  {
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.String,
    exitCode: Schema.NullOr(Schema.Number),
    output: Schema.String,
  },
) {
  get message(): string {
    return this.output || `${this.command} exited ${this.exitCode ?? "unknown"}`;
  }
}

export class ReadbroUnknownError extends Schema.TaggedError<ReadbroUnknownError>()(
  "ReadbroUnknownError",
  {
    cause: Schema.Any,
  },
) {
  get message(): string {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

export type ReadbroError = CompostoSpawnError | CompostoCommandError | ReadbroUnknownError;

export const toReadbroError = (error: unknown): ReadbroError => {
  if (error instanceof CompostoSpawnError) return error;
  if (error instanceof CompostoCommandError) return error;
  if (error instanceof ReadbroUnknownError) return error;
  return new ReadbroUnknownError({ cause: error });
};
