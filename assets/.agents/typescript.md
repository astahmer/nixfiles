---
applyTo: '**/*.ts|**/*.tsx'
alwaysApply: true
description: Instructions
---

## Typescript

- MUST: Use arrow functions over function declarations
- MUST: Default to NO comments. Only add a comment when the user explicitly asks, or when the "why" is truly non-obvious - browser quirks, platform bugs, performance tradeoffs, fragile internal patching, or counter-intuitive design decisions. Never add comments that restate what the code does or what a well-named function/variable already conveys. When in doubt, leave the comment out.
  - Do not delete descriptive comments >3 lines without confirming with the user
- MUST: Use kebab-case for files
- MUST: Use descriptive names for variables (avoid shorthands, or 1-2 character names).
  - Example: for .map(), you can use `innerX` instead of `x`
  - Example: instead of `moved` use `didPositionChange`
- MUST: Frequently re-evaluate and refactor variable names to be more accurate and descriptive.
- MUST: Do not type cast ("as") unless absolutely necessary
- MUST: Remove unused code and don't repeat yourself.
- MUST: Always search the codebase, think of many solutions, then implement the most _elegant_ solution.
- MUST: Use Boolean over !!.
- MUST: Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- MUST: Do not extract single-use variables preemptively. Inline the value at the call site unless the variable is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- MUST: Avoid `try`/`catch` where possible
- MUST: Avoid using the `any` type
- MUST: Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- MUST: Avoid unnecessary abstraction. Do not create a function or module until you have many use cases for it. Most often inlining is sufficient and much easier to maintain.
- MUST: Avoid multiple arguments in favor of a single object.
- MUST: Avoid exporting stuff that is not intended to be used outside the file.
- MUST: Avoid small functions when they're not going to be reused. They add unnecessary indirection and make the code harder to read.
- MUST: Avoid `constants.ts` files (and similar stuff); instead define constants in the file where they're used.
- MUST: Validate using standard schema (Effect Schema if available or zod otherwise) rather than manual checks. (avoid `=== undefined` etc)

## Testing

- MUST: Avoid mocks as much as possible
- MUST: Test actual implementation, do not duplicate logic into tests
- MUST: Always debug by running a single file, not the whole suite.
- MUST: Always use full path and `--run` flag to stop after completion
- MUST: When only one test is failing in a file with many tests -> add `.only` to isolate the test

Run checks always before committing with:

```bash
pnpm test # runs tests
pnpm lint
pnpm typecheck # runs type checking
pnpm fmt
```

- if Effect is available, see [Effect](./effect.md) for more.
- if there are no memory tools available, see [Memory](./memory.md) for more.
