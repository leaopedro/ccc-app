#!/bin/sh

set -eu

project_dir="$(pwd)"
repo_root="$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null || pwd)"

"$repo_root"/scripts/guard-branch-context.sh tool
