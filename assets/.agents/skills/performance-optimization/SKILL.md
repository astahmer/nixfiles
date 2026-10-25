---
name: performance-optimization
description: Find and improve real performance bottlenecks in code by measuring representative workloads, choosing targeted changes, and proving correctness and before/after impact. Use when a user asks to optimize, speed up, reduce latency or resource use, or review code for performance.
---

# Performance Optimization

Optimize the measured bottleneck, not every imaginable operation. “Fully optimized” means meeting the stated performance goal within correctness, resource, reliability, and maintainability constraints—not applying every technique below.

## Workflow

1. **Set the target.** Identify the user-visible workload, input sizes, environment, performance objective (latency, throughput, memory, CPU, I/O, or cost), and constraints. If unclear, ask; do not invent a target.
2. **Measure first.** Reproduce the workload and capture a baseline with a profiler, trace, query plan, benchmark, or bounded counters. Separate startup/cold-cache from steady-state where relevant; use representative sizes and report variance. Find where time and resources actually go before editing.
3. **Form a hypothesis.** Name the bottleneck, expected benefit, risks, and a falsifiable measurement. Prioritize high-impact work; avoid speculative cleanup and premature micro-optimization.
4. **Inspect the work shape.** Ask:
   - Is work sequential because of a true dependency, or can independent steps overlap safely?
   - Are we under- or over-concurrent? What are the throughput, latency, memory, contention, ordering, and overload trade-offs? Is concurrency bounded and cancellable?
   - How many passes, scans, sorts, conversions, copies, or repeated computations happen? Can a pass be removed or safely fused?
   - How many allocations and how much retained memory occur? Can churn or copying be reduced without creating unsafe pooling or lifetime complexity?
   - Is the algorithm and data structure appropriate for the access pattern, input size, locality, and in-memory representation?
   - How many I/O calls, network round trips, database queries, syscalls, or filesystem operations occur? Can calls be eliminated, combined, or indexed? Check query plans and N+1 patterns where relevant.
   - Is work batched? What batch size balances throughput, memory, fairness, and time-to-first-result? Would streaming reduce latency or peak memory, and can the consumer apply backpressure?
   - While awaiting I/O, is there independent useful work to do? Overlap only safe work; preserve cancellation, error propagation, ordering, and resource ownership.
   - Can validation, traversal, or computation short-circuit or stop early without changing observable semantics?
   - How many threads, tasks, processes, or workers are active? Is that appropriate for CPU-bound versus I/O-bound work, and does scheduling overhead or oversubscription erase gains?
   - Would lazy evaluation, caching, memoization, or precomputation help this workload? Account for invalidation, staleness, memory bounds, cold misses, and added complexity.
   - For large UI lists or trees, is off-screen content needlessly rendered? Consider pagination, incremental loading, or virtualization only when it reduces measured work and preserves accessibility and interaction.
   - Are serialization, parsing, logging, lock contention, garbage collection, or data transfer the real cost instead of the obvious loop?
5. **Change one bottleneck at a time.** Choose the smallest safe change. Do not introduce caching, concurrency, batching, pooling, or virtualization merely because the technique exists.
6. **Prove it.** Re-run the same workload and compare against baseline. Add or run correctness tests for boundary inputs, ordering, cancellation, errors, races, and resource limits as applicable. Check for regressions in other important metrics.
7. **Report honestly.** State the bottleneck, change, workload and environment, before/after numbers, trade-offs, validation, and what remains unmeasured. If a reliable baseline or representative workload is unavailable, explain the limitation instead of claiming the code is optimized.

## Guardrails

- Prefer asymptotic or round-trip reductions before low-level tuning when evidence supports them.
- Use bounded queues and concurrency; consider backpressure, retries, timeouts, fairness, and graceful overload behavior.
- Preserve semantics, consistency, security checks, and data freshness. Never weaken validation or correctness to win a benchmark.
- Keep benchmarks reproducible and compare equivalent builds, data, cache state, and machine conditions. Avoid flaky timing assertions in ordinary tests.
- Treat CPU, memory, allocations, I/O, latency, throughput, energy, and cost as trade-offs; optimize the metric the user values while watching guardrails.
