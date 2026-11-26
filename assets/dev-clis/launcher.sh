# Runs the live source entry of a local checkout: no build step, any cwd,
# arguments, stdin, exit code and signals pass through `exec`. Extra settings:
# entry, update_env.

script="$checkout/$entry"

if [ ! -f "$script" ]; then
  echo "$name: no $entry in $checkout" >&2
  echo "hint: run \`$name-update\` to create or refresh it, or point $checkout_env at another checkout" >&2
  exit 127
fi
if [ ! -d "$checkout/node_modules" ]; then
  echo "$name: dependencies are not installed in $checkout" >&2
  echo "hint: run \`$name-update\` (or pnpm install in $checkout)" >&2
  exit 1
fi
if [ "$checkout/pnpm-lock.yaml" -nt "$checkout/node_modules/.modules.yaml" ]; then
  echo "$name: pnpm-lock.yaml changed since the last install in $checkout; run \`$name-update\` if it fails" >&2
fi

resolve_node

# The entry's own `#!/usr/bin/env -S node <flags>` shebang keeps its Node flags.
runtime_args=()
IFS= read -r shebang <"$script" || true
case "$shebang" in
  "#!/usr/bin/env -S node "*) read -r -a runtime_args <<<"${shebang#"#!/usr/bin/env -S node "}" ;;
esac

export "${update_env}=$name-update"
exec "$node" "${runtime_args[@]}" "$script" "$@"
