#!/usr/bin/env python3
"""Add re-exports for names a module moved away, where a caller still imports them.

A half-applied refactor moves a helper between modules; the caller (resolved to the other
side of the merge) still imports it from the old module, which no longer has it. TypeScript
then reports `TS2305 Module X has no exported member Y`. Fix it additively: find the module
that does declare Y and re-export it from the module the caller imports.

usage: moved-exports.py <src-root> [--fix]
"""
import pathlib, re, sys

root = pathlib.Path(sys.argv[1]).resolve()
fix = '--fix' in sys.argv
files = {p.resolve(): p.read_text() for p in root.rglob('*.ts')}
files.update({p.resolve(): p.read_text() for p in root.rglob('*.tsx')})

VALUE_DECL = re.compile(r'^export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|enum)\s+([A-Za-z0-9_$]+)', re.M)
TYPE_DECL = re.compile(r'^export\s+(?:interface|type)\s+([A-Za-z0-9_$]+)', re.M)
LOCAL_DECL = re.compile(r'^(?:const|let|var|async function|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)', re.M)


def exported(path, seen=None):
    """(values, types) a module exports, following `export * from`."""
    seen = seen or set()
    if path in seen:
        return set(), set()
    seen.add(path)
    text = files[path]
    values = set(VALUE_DECL.findall(text))
    types = set(TYPE_DECL.findall(text))
    for match in re.finditer(r'^export\s+\{([^}]*)\}', text, re.M | re.S):
        for part in match.group(1).split(','):
            part = part.strip()
            if not part:
                continue
            is_type = part.startswith('type ')
            name = re.sub(r'^type\s+', '', part).split(' as ')[-1].strip()
            (types if is_type else values).add(name)
    for match in re.finditer(r"^export\s+\*\s+from\s+['\"]([^'\"]+)['\"]", text, re.M):
        target = pathlib.Path(str((path.parent / match.group(1)).resolve()).replace('.js', '.ts'))
        for candidate in (target, pathlib.Path(str(target) + 'x'), pathlib.Path(str(target).replace('.ts', '.tsx'))):
            if candidate in files:
                inner_values, inner_types = exported(candidate, seen)
                values |= inner_values
                types |= inner_types
    return values, types


def resolve(from_file, spec):
    base = (from_file.parent / spec).resolve()
    for candidate in (pathlib.Path(str(base).replace('.js', '.ts')), pathlib.Path(str(base).replace('.js', '.tsx')), base / 'index.ts'):
        if candidate in files:
            return candidate
    return None


# index every declaration, exported or not, so a moved name can be located
declared: dict[str, list[pathlib.Path]] = {}
for path, text in files.items():
    for name in LOCAL_DECL.findall(text):
        declared.setdefault(name, []).append(path)

problems = []
for path, text in files.items():
    for match in re.finditer(r"^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['\"]([^'\"]+)['\"]", text, re.M | re.S):
        if not match.group(2).startswith('.'):
            continue
        target = resolve(path, match.group(2))
        if target is None:
            continue
        values, types = exported(target)
        for raw in match.group(1).split(','):
            name = raw.strip().replace('type ', '').strip().split(' as ')[0].strip()
            if not name or name in values or name in types:
                continue
            homes = [home for home in declared.get(name, []) if home != target]
            if len(homes) == 1:
                problems.append((path, target, name, homes[0], 'type' if name in exported(homes[0])[1] else 'value'))
            else:
                problems.append((path, target, name, None, f'{len(homes)} candidates'))

print(f'{len(problems)} moved member(s) referenced but not exported by their module')
grouped: dict[tuple, list] = {}
for path, target, name, home, kind in problems:
    grouped.setdefault((target, home, kind), []).append((name, path))
for (target, home, kind), names in grouped.items():
    where = str(home.relative_to(root)) if home else 'UNRESOLVED'
    print(f'  {target.relative_to(root)} <- {", ".join(sorted(n for n, _ in names))} from {where} ({kind})')

if fix:
    appended = 0
    for (target, home, kind), names in grouped.items():
        if home is None:
            continue
        relative = home.relative_to(target.parent).with_suffix('').as_posix()
        spec = relative if relative.startswith('.') else f'./{relative}'
        spec = f'{spec}.js'
        keyword = 'export type' if kind == 'type' else 'export'
        line = f"{keyword} {{ {', '.join(sorted(n for n, _ in names))} }} from '{spec}'\n"
        text = files[target]
        if line.strip() in text:
            continue
        files[target] = text.rstrip('\n') + '\n' + line
        appended += 1
        print(f'  re-exported into {target.relative_to(root)}: {line.strip()}')
    for path, text in files.items():
        path.write_text(text)
    print(f'{appended} re-export(s) added')
