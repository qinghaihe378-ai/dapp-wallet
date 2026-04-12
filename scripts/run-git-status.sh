#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
git status -sb > scripts/_git_out.txt 2>&1
git add -A >> scripts/_git_out.txt 2>&1
git status -sb >> scripts/_git_out.txt 2>&1
