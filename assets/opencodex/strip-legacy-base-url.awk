/^[[:space:]]*\[/ {
	inside_table = 1
}
{
	is_legacy_proxy = $0 ~ /^[[:space:]]*openai_base_url[[:space:]]*=[[:space:]]*"http:\/\/127\.0\.0\.1:10100\/v1"[[:space:]]*$/
	is_opencodex_marker = previous_line ~ /^[[:space:]]*# Auto-injected by opencodex[[:space:]]*$/
	if (!inside_table && is_legacy_proxy && !is_opencodex_marker) {
		previous_line = ""
		next
	}
	print
	previous_line = $0
}
