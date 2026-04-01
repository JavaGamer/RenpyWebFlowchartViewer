label start:
    "This line is intentionally malformed"
    if has_key
        jump fallback

@@@

label fallback:
    "Recovered label still parses"
