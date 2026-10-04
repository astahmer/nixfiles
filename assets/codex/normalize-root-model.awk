BEGIN { inRoot = 1; modelFound = 0 }
{
	if ($0 ~ /^[[:space:]]*\[/) inRoot = 0
	if (inRoot && $0 ~ /^[[:space:]]*model[[:space:]]*=/) {
		modelFound = 1
		sub(/"codex-perso\//, "\"")
	}
	if (inRoot && $0 ~ /^[[:space:]]*model_catalog_json[[:space:]]*=/) next
	lines[NR] = $0
}
END {
	if (!modelFound) print "model = \"gpt-6-luna\""
	for (lineNumber = 1; lineNumber <= NR; lineNumber++) print lines[lineNumber]
}
