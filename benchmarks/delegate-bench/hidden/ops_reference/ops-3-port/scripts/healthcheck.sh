#!/bin/sh
# Prints /health; exits non-zero unless the status is ok.
out=$(curl -fsS http://127.0.0.1:8742/health) || exit 1
echo "$out"
echo "$out" | grep -q '"status": "ok"'
