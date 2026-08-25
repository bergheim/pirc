# Agent Operations

Org/denote recipes for this repo. Rules stay in `AGENTS.md`.

Before assuming the helper list is complete:

```bash
emacsclient -e '(apropos-internal "^bergheim/agent-")'
```

## Org Helpers

- `bergheim/agent-org-set-state FILE HEADING-RE NEW-STATE &optional NOTE AGENT SESSION-ID`
- `bergheim/agent-org-set-state-by-id FILE ID NEW-STATE &optional NOTE AGENT SESSION-ID`
- `bergheim/agent-org-ensure-id FILE HEADING-RE`
- `bergheim/agent-org-add-note FILE HEADING-RE NOTE`
- `bergheim/agent-org-add-tag FILE HEADING-RE TAG`
- `bergheim/agent-org-remove-tag FILE HEADING-RE TAG`
- `bergheim/agent-org-add-todo FILE HEADING &optional BODY TAGS STATE`
- `bergheim/agent-org-link-note ORG-FILE LOCATOR NOTE-PATH &optional BY-ID`
- `bergheim/agent-org-list-todos ORG-FILE &optional STATES`
- `bergheim/agent-org-get-entry FILE LOCATOR &optional BY-ID`

```bash
emacsclient -e "(bergheim/agent-org-set-state \"docs/TODO.org\" \"TODO Heading\" \"INPROGRESS\" nil $(agent-meta --elisp))"
emacsclient -e '(bergheim/agent-org-set-state "docs/TODO.org" "TODO Heading" "DONE" "Resolved by commit abc1234.")'
emacsclient -e '(bergheim/agent-org-add-todo "docs/TODO.org" "New task heading" "Body text." (quote ("topic")) "TODO")'
emacsclient -e '(bergheim/agent-org-add-tag "docs/TODO.org" "TODO Heading" "autonomous")'
emacsclient -e '(bergheim/agent-org-link-note "docs/TODO.org" "TODO Heading" "/abs/path/to/note.org")'
emacsclient -e '(bergheim/agent-org-list-todos "docs/TODO.org")'
emacsclient -e '(bergheim/agent-org-get-entry "docs/TODO.org" "TODO Heading")'
```

States: `TODO`, `NEXT`, `INPROGRESS`, `WAITING`, `DONE`, `CANCELLED`.

## Denote Helpers

- `bergheim/agent-denote-create DIR TITLE KEYWORDS &optional BODY`
- `bergheim/agent-denote-find DIR &optional KEYWORDS TITLE-RE`
- `bergheim/agent-denote-read FILEPATH`
- `bergheim/agent-denote-list DIR &optional LIMIT`
- `bergheim/agent-denote-link SOURCE-PATH TARGET-PATHS`
- `bergheim/agent-denote-get-backlinks FILEPATH`

`agent-denote-list` returns only `:id`, `:title`, and `:keywords`. Use `agent-denote-find` when a path is needed.

```bash
emacsclient -e '(bergheim/agent-denote-create "docs/notes" "Title here" (quote ("kind" "topic")) "Body text.")'
emacsclient -e '(bergheim/agent-denote-find "/workspaces/stash/notes" (quote ("pi")))'
emacsclient -e '(bergheim/agent-denote-list "/workspaces/stash/notes" 15)'
emacsclient -e '(bergheim/agent-denote-link "/abs/path/to/source.org" (quote ("/abs/path/to/target.org")))'
```
