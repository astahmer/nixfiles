---
name: browser-debugging
description: Debugs frontend behavior from the running browser using snapshots, screenshots, console, network, DOM, and computed-style evidence. Use when investigating UI bugs, failed browser tests, layout issues, hydration problems, or frontend/backend interaction.
---

# Browser Debugging

Inspect the live browser state before proposing a static-code explanation.
Use the available DevTools, Playwright, or computer-use adapter.

## Workflow

1. Start or identify the correct local application and exact route.
2. Reproduce the smallest failing interaction with the same viewport,
   account, feature flags, and data state.
3. Capture a structured page snapshot, then a screenshot when visual evidence
   matters.
4. Inspect console errors and warnings, failed requests, response status, and
   request payloads. Correlate browser failures with server logs when needed.
5. Inspect the relevant DOM, attributes, accessibility state, and computed
   styles. Check the actual rendered state rather than only component source.
6. Form a root-cause hypothesis, make the smallest change, and repeat the
   same reproduction.
7. Add or update a regression test with stable semantic selectors and no
   arbitrary waits.

## Evidence

Report the route, reproduction, relevant console/network evidence, observed
DOM or style state, and the validation result. Keep screenshots and logs
focused; do not include credentials, tokens, or unnecessary user data.
