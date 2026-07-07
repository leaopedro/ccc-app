#!/bin/sh

set -eu

pnpm exec simple-git-hooks

pre_push_hook=".git/hooks/pre-push"

if [ -f "$pre_push_hook" ] && grep -Fq "guard-production-branch.sh pre-push" "$pre_push_hook"; then
  rm -f "$pre_push_hook"
fi
