#!/usr/bin/env python3
"""Find (and optionally fix) relative imports of names a module declares but does not export.

A partially applied refactor moves helpers between modules; where the caller resolved to the
other side of the merge, the tree keeps callers importing names the target no longer exports.
`tsc` with isolatedModules can miss this and the failure only appears when the emitted ESM
loads, so sweep it explicitly.

usage: import-sweep.py <src-root> [--fix]
"""
import re, sys, pathlib

root = pathlib.Path(sys.argv[1]).resolve()
fix = '--fix' in sys.argv
files = {p.resolve(): p.read_text() for p in root.rglob('*.ts')}
fixed = []


def exports_of(path, seen=None):
    seen = seen or set()
    if path in seen:
        return set()
    seen.add(path)
    text = files[path]
    names = set(re.findall(r'^export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)', text, re.M))
    for match in re.finditer(r'^export\s+(?:type\s+)?\{([^}]*)\}', text, re.M | re.S):
        for part in match.group(1).split(','):
            part = re.sub(r'^type\s+', '', part.strip())
            if part:
                names.add(part.split(' as ')[-1].strip())
    for match in re.finditer(r"^export\s+\*\s+from\s+['\"]([^'\"]+)['\"]", text, re.M):
        target = pathlib.Path(str((path.parent / match.group(1)).resolve()).replace('.js', '.ts'))
        if target in files:
            names |= exports_of(target, seen)
    return names


def declares(text, name):
    return re.search(rf'^(?:const|let|var|async function|function|class|interface|type|enum)\s+{re.escape(name)}\b', text, re.M) is not None


def resolve_module(from_file, spec):
    base = (from_file.parent / spec).resolve()
    for candidate in (pathlib.Path(str(base).replace('.js', '.ts')), base / 'index.ts'):
        if candidate in files:
            return candidate
    return None


problems = []
for path, text in files.items():
    for match in re.finditer(r"^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['\"]([^'\"]+)['\"]", text, re.M | re.S):
        if not match.group(2).startswith('.'):
            continue
        target = resolve_module(path, match.group(2))
        if target is None:
            continue
        available = exports_of(target)
        for raw in match.group(1).split(','):
            name = raw.strip().replace('type ', '').strip().split(' as ')[0].strip()
            if name and name not in available:
                problems.append((path, target, name))

print(f'{len(problems)} import(s) of names their module does not export (root {root.name})')
for path, target, name in problems:
    if not declares(files[target], name):
        print(f'  unresolved  {path.relative_to(root)} <- {name} from {target.relative_to(root)}')
        continue
    print(f'  {"exported" if fix else "declares but does not export"}  {name} in {target.relative_to(root)} (used by {path.relative_to(root)})')
    if fix:
        files[target], count = re.subn(
            rf'^(?:const|let|var|async function|function|class|interface|type|enum)\s+{re.escape(name)}\b',
            lambda m: f'export {m.group(0)}', files[target], count=1, flags=re.M)
        if count:
            fixed.append(f'{target.relative_to(root)}::{name}')
if fix and fixed:
    for path, text in files.items():
        path.write_text(text)
    print(f'exported {len(fixed)} declaration(s)')
