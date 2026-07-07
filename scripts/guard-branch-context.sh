#!/bin/sh

set -eu

mode="${1:-tool}"
project_dir="$(pwd)"
repo_root="$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null || pwd)"
branch="$(git -C "$project_dir" branch --show-current 2>/dev/null || true)"

is_production() {
  [ "$branch" = "production" ]
}

is_main() {
  [ "$branch" = "main" ]
}

production_block_message() {
  printf '%s\n' "BLOCKED: refusing to modify or commit on production. production is updated only by manual merge from main."
}

main_push_block_message() {
  printf '%s\n' "BLOCKED: refusing to git push from main. Switch to a feature branch and open a PR."
}

case "$mode" in
  pre-commit)
    if is_production; then
      production_block_message >&2
      exit 1
    fi
    ;;
  tool)
    if is_production; then
      payload="$(cat)"
      tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty')"
      case "$tool_name" in
        Edit|Write|MultiEdit)
          production_block_message >&2
          exit 2
          ;;
        Bash)
          command="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')"
          case "$command" in
            "git branch --show-current"* | \
            "git branch"* | \
            "git diff"* | \
            "git log"* | \
            "git remote -v"* | \
            "git rev-parse"* | \
            "git show"* | \
            "git status"* | \
            "git worktree list"* | \
            "git checkout main"* | \
            "git switch main"* | \
            "git checkout feat/"* | \
            "git switch feat/"* | \
            "git checkout fix/"* | \
            "git switch fix/"* | \
            "git checkout chore/"* | \
            "git switch chore/"* | \
            "git checkout refactor/"*  | \
            "git switch refactor/"* | \
            "pwd"* | "ls"* | "find "* | "rg "* | "grep "* | \
            "sed -n "* | "cat "* | "head "* | "tail "* | "wc "* | \
            "stat "* | "tree "* | "jq "* | "echo "* | "printf "* | \
            "env"* | "printenv"* | "which "* | "date"*)
              exit 0
              ;;
          esac
          production_block_message >&2
          exit 2
          ;;
      esac
      exit 0
    fi

    if is_main; then
      payload="$(cat)"
      tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty')"
      if [ "$tool_name" = "Bash" ]; then
        command="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')"
        case "$command" in
          *"git push"*)
            main_push_block_message >&2
            exit 2
            ;;
        esac
      fi
      exit 0
    fi
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 64
    ;;
esac
