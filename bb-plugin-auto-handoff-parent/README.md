# Auto Handoff Parent

BB currently saves a `Continue from @thread:…` handoff as a normal new-thread
start, with the source thread present as a resolved mention but absent from the
thread's `parentThreadId`. This plugin listens for the new thread's first active
or failed event, checks the original start request for that exact handoff
prefix and a resolved mention (or explicit `@thread:…` token) at the matching
position, then assigns that thread as the parent.

The plugin leaves ordinary mentions and other thread starts alone. It also
keeps any parent already chosen by the user and only links threads in the same
project.

Install from the repository root with:

```sh
bb plugin install ./bb-plugin-auto-handoff-parent
```
