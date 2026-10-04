export class FreeModelRetryPolicy {
  static readonly maximumAttempts = 5;
  static readonly baseDelayMs = 2_000;
  static readonly maximumDelayMs = 30_000;

  static canSchedule = (attempt: number): boolean =>
    Number.isInteger(attempt) && attempt > 0 && attempt <= FreeModelRetryPolicy.maximumAttempts;

  static delayFor = (attempt: number): number =>
    Math.min(
      FreeModelRetryPolicy.maximumDelayMs,
      FreeModelRetryPolicy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
    );
}
