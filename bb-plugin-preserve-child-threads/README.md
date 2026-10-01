# Preserve Child Threads

BB archives a parent's descendants with it. This plugin listens for those
cascade archive events and restores a child when its parent was archived within
one second of it. That leaves descendants available in the sidebar while the
parent remains archived.

Archiving a child separately remains effective because its archive timestamp
does not match an older archived parent.

Install from the repository root with:

```sh
bb plugin install ./bb-plugin-preserve-child-threads
```
