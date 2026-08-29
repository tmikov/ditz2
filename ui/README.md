# ditz2-ui

A full-screen terminal UI for [ditz2](../README.md), built on Ink.

Neither package is published yet, so install from a clone:

```
sl clone <this repo> && cd ditz2
npm install                     # links ditz2 into ui/ as a workspace
npm run build                   # the ditz2 CLI
npx tsc -p ui/tsconfig.json && chmod +x ui/dist/main.js
node ui/dist/main.js
```

The UI build avoids `npm run build --workspace ditz2-ui` deliberately. The npm
this project's toolchain resolves to is 8.19.4, which discards the exit code of
any script run in a workspace member — so a failed build reports success and
the next line fails with `ERR_MODULE_NOT_FOUND` instead. See `CLAUDE.md`.

Once both are on a registry this becomes:

```
npm i -g ditz2-ui
dz ui          # or: dzui
```

It is a separate package on purpose. Ink and React are 38 packages and about
23 MB, and someone who wants a command-line issue tracker should not have to
install a React reconciler to get one. `ditz2` does not depend on this package;
`dz ui` finds it with a dynamic import and prints an install hint if it is not
there.

## What it does

Browse, filter and read. Everything it shows, `dz list`, `dz show` and `dz grep`
already show — it talks to the same `ditz2` public API the CLI does, so there is
no second implementation to drift. Creating, editing and closing issues from the
UI is plan 2b; for now use `dz`.

## Keys

| | |
| --- | --- |
| `up`/`down`, `j`/`k` | move |
| `Home`/`End`, `g`/`G` | first / last |
| `PgUp`/`PgDn`, `^U`/`^D` | page |
| `/` | filter — `enter` keeps it, `esc` clears it |
| `r` | reload from disk |
| `?` | every binding |
| `q` | quit |

The filter field takes bare words as a regex over titles, bodies and log
entries, and `status:`, `type:`, `component:`, `assignee:` and `all:` as
filters. `assignee:me` resolves to your configured identity. Arrow keys keep
working while the field is open, so you can type and walk the matches at once.

## What it does not do

It does not watch the filesystem. The screen is a snapshot taken at startup and
replaced by `r`, so an agent closing an issue you are looking at will not update
the display. This is deliberate: a list that reorders under a moving cursor is
worse than one that is briefly stale, and correctness does not depend on
freshness — every write re-reads and re-validates under the project lock, so a
stale view produces a refused write and never a silent overwrite.
