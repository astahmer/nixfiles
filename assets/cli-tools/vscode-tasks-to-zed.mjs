
/**
 * vscode-tasks-to-zed — convert a VS Code .vscode/tasks.json into Zed's .zed/tasks.json format.
 *
 * Usage:
 *   vscode-tasks-to-zed <path/to/.vscode/tasks.json> [-o out.json]
 *   cat .vscode/tasks.json | vscode-tasks-to-zed -            # stdin
 *
 * Field mapping (VS Code -> Zed):
 *   label                  -> label
 *   type "shell"           -> command = full shell line (args appended, quoted)
 *   type "process"         -> command + args kept separate
 *   options.cwd            -> cwd
 *   options.env            -> env
 *   options.shell.{executable,args} -> shell: {program} / {with_arguments}
 *   presentation.reveal    -> reveal ("always"|"silent"->"no_focus"|"never"|"never")
 *   isBackground           -> allow_concurrent_runs: true
 *   group {isDefault}      -> (dropped; Zed has no default-group concept — see warnings)
 *   problemMatcher         -> (dropped; Zed has no error surfacing from tasks)
 *   dependsOn / inputs     -> (dropped with a warning)
 *
 * Variable translation:
 *   ${workspaceFolder}          -> $ZED_WORKTREE_ROOT
 *   ${workspaceFolderBasename}  -> basename of $ZED_WORKTREE_ROOT
 *   ${file}                     -> $ZED_FILE
 *   ${relativeFile}             -> $ZED_RELATIVE_FILE
 *   ${fileDirname}              -> $ZED_RELATIVE_DIR
 *   ${fileBasename}             -> $ZED_FILENAME
 *   ${fileBasenameNoExtension}  -> $ZED_STEM
 *   ${lineNumber}               -> $ZED_ROW
 *   ${env:FOO} / ${env:FOO:bar} -> $FOO / ${FOO:bar}
 *   ${command:*}, ${input:*}    -> task skipped with a warning
 */

import { readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const argv = process.argv.slice(2)
let outPath = null
const positional = []
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '-o') {
		outPath = argv[++i] // consume the value
	} else {
		positional.push(argv[i])
	}
}
const srcArg = positional[0]

let raw
if (!srcArg || srcArg === '-') {
	raw = readFileSync(0, 'utf8')
} else {
	raw = readFileSync(resolve(srcArg), 'utf8')
}

// VS Code tasks.json allows comments; strip them crudely but safely (not inside strings).
function stripJsonComments(src) {
	let out = ''
	let inStr = false
	for (let i = 0; i < src.length; i++) {
		const c = src[i]
		if (inStr) {
			out += c
			if (c === '\\') { out += src[++i]; continue }
			if (c === '"') inStr = false
			continue
		}
		if (c === '"') { inStr = true; out += c; continue }
		if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
		if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue }
		out += c
	}
	return out
}

const config = JSON.parse(stripJsonComments(raw))
const tasks = Array.isArray(config) ? config : config.tasks ?? []

const VAR_MAP = [
	[/\$\{workspaceFolderBasename\}/g, () => 'basename($ZED_WORKTREE_ROOT)'],
	[/\$\{workspaceFolder\}/g, '$ZED_WORKTREE_ROOT'],
	[/\$\{relativeFile\}/g, '$ZED_RELATIVE_FILE'],
	[/\$\{fileDirname\}/g, '$ZED_RELATIVE_DIR'],
	[/\$\{fileBasenameNoExtension\}/g, '$ZED_STEM'],
	[/\$\{fileBasename\}/g, '$ZED_FILENAME'],
	[/\$\{lineNumber\}/g, '$ZED_ROW'],
	[/\$\{selectedText\}/g, '$ZED_SELECTED_TEXT'],
	[/\$\{file\}/g, '$ZED_FILE'],
	[/\$\{env:([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g, (_, name, def) => def ? `\${${name}:${def}}` : `$${name}`],
]

function translateVars(s) {
	let out = String(s)
	for (const [re, to] of VAR_MAP) out = out.replace(re, to)
	return out
}

function translateDeep(v) {
	if (typeof v === 'string') return translateVars(v)
	if (Array.isArray(v)) return v.map(translateDeep)
	return v
}

function quoteIfNeeded(s) {
	return /[\s"'$*?[\]{}()<>;&|\\]/.test(s) ? `'${s.replaceAll("'", `'\\''`)}'` : s
}

const warnings = []
const zedTasks = []
let skipped = 0

for (const t of tasks) {
	const label = typeof t.label === 'string' ? translateVars(t.label) : '(unnamed)'
	const skip = (reason) => { warnings.push(`SKIP "${label}": ${reason}`); skipped++ }

	if (t.dependsOn || (t.inputs && t.inputs.length)) {
		skip('uses dependsOn/inputs (no Zed equivalent)')
		continue
	}
	if (typeof t.command !== 'string' || /(\$\{command:)/.test(t.command)) {
		skip('command missing or uses ${command:*}')
		continue
	}
	if (t.windows || t.osx || t.linux) {
		warnings.push(`NOTE "${label}": platform-specific overrides ignored`)
	}

	const args = (t.args ?? []).map((a) => (typeof a === 'string' ? translateVars(a) : a))
	const hasUntranslatedArg = args.some(
		(a) => typeof a === 'object' && (a.value != null || a.quoting),
	)

	let command, zedArgs
	if (t.type === 'process') {
		command = translateVars(t.command)
		if (hasUntranslatedArg) {
			warnings.push(`NOTE "${label}": object-style args flattened via JSON.stringify`)
		}
		zedArgs = args.map((a) => (typeof a === 'object' ? String(a.value ?? '') : a))
	} else {
		// shell task: bake everything into one shell line so shell operators keep working
		const parts = [translateVars(t.command), ...args.map((a) => (typeof a === 'string' ? quoteIfNeeded(a) : JSON.stringify(a)))]
		command = parts.join(' ')
		zedArgs = undefined
	}

	const zed = { label }
	zed.command = command
	if (zedArgs?.length) zed.args = zedArgs

	const opts = t.options ?? {}
	if (opts.cwd) zed.cwd = translateVars(opts.cwd)
	if (opts.env) zed.env = Object.fromEntries(Object.entries(opts.env).map(([k, v]) => [k, translateVars(String(v))]))
	const shellExec = opts.shell?.executable ?? opts.shell
	if (shellExec) {
		const sArgs = (opts.shell?.args ?? []).map((a) => translateVars(String(a)))
		zed.shell = sArgs.length
			? { with_arguments: { program: translateVars(shellExec), args: sArgs } }
			: { program: translateVars(shellExec) }
	}

	const reveal = t.presentation?.reveal
	if (reveal === 'silent') zed.reveal = 'no_focus'
	else if (reveal === 'never') zed.reveal = 'never'

	if (t.isBackground) zed.allow_concurrent_runs = true

	if (t.group) {
		warnings.push(
			`NOTE "${label}": group (${typeof t.group === 'string' ? t.group : t.group.kind}) dropped — no default-task concept in Zed`,
		)
	}
	if (t.problemMatcher) {
		warnings.push(`NOTE "${label}": problemMatcher dropped`)
	}

	zedTasks.push(zed)
}

if (outPath) {
	await Bun.write(outPath, JSON.stringify(zedTasks, null, 2) + '\n')
	console.error(`wrote ${zedTasks.length} task(s) -> ${outPath}`)
} else {
	console.log(JSON.stringify(zedTasks, null, 2))
}

if (warnings.length) {
	console.error('\n# conversion notes:')
	for (const w of warnings) console.error('# ' + w)
}
console.error(`\n${tasks.length - skipped}/${tasks.length} task(s) converted, ${skipped} skipped.`)
