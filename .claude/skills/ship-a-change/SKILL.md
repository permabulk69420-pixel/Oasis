---
name: ship-a-change
description: Use when a change is ready to commit: opening the PR without gh pr create, squash merging, confirming the Pages deploy, tidying the branch, and what to do about stop-hook "unpushed commit" nags.
---

# Shipping a change

Moved out of CLAUDE.md so it only loads when needed. Kane's standing rules are still in CLAUDE.md.

- `gh pr create` fails here (GraphQL is blocked). Use the REST API:
  `gh api repos/permabulk69420-pixel/oasis/pulls -X POST -f title=... -f head=BRANCH -f base=main -F body=@file`
  then `gh api repos/permabulk69420-pixel/oasis/pulls/N/merge -X PUT -f merge_method=squash`.
- Stop the dev server with `fuser -k 4173/tcp`. `pkill -f vite` or `pgrep -f` matches its own shell and kills the command.
- After a squash merge, `git checkout -B main origin/main` and `git branch -D` the feature branch. The stop hook counts
  the unsquashed local commit as unpushed and nags, even though the work is already on `main`.
- **Stop-hook "N unpushed commits and no remote branch" is usually this clone's fault, not a real problem.** The hook
  (`~/.claude/stop-hook-git-check.sh`) looks for a local `origin/<branch>` ref and, if there is none, counts every commit that is not on
  `origin/HEAD` as unpushed. This clone's fetch rule only covers `main` (`remote.origin.fetch = +refs/heads/main:refs/remotes/origin/main`), so
  a pushed feature branch never gets that ref and always looks unpushed. At the start of a session run
  `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git fetch origin`; after that a push updates the ref and the hook
  stays quiet. If it still fires, compare `git ls-remote --heads origin BRANCH` with `git rev-parse HEAD`: if they match, nothing is unpushed.
  Never re-push or re-do work because of it, and it is not Kane asking for anything.

Verified means `npm test` passes, `npx vite build` works, and for visual changes you looked at screenshots. Then: branch, commit, push,
open the PR with the REST call above, squash merge, wait for the Pages workflow on the merge sha (`gh api "repos/permabulk69420-pixel/oasis/actions/runs?head_sha=<sha>"`),
`git checkout -B main origin/main`, delete the branch. New hand-built models are the exception: send the .glb and renders and leave the PR open
unless Kane has handed over the keys for that session.
