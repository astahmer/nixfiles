# Preserve Child Threads

BB archives a parent's descendants with it. This plugin listens for those
cascade archive events and restores a child when its parent was archived within
one second of it. That leaves descendants available in the sidebar while the
parent remains archived.

Archiving a child separately remains effective because its archive timestamp
does not match an older archived parent.

Use **Link existing thread** in the sidebar footer to organize threads without
starting an agent turn. It updates only the child's BB `parentThreadId`; it
does not send a prompt, call spawn, or affect either AI session. Both threads
must belong to the same project.

Install from the repository root with:

```sh
bb plugin install ./bb-plugin-preserve-child-threads
```
