---
description: Replay compact-tools TUI density (read-only)
---
Visual check of compact-tools. Do not explain. Do not edit or write files. Do not spawn subagents.

Call these in one turn, in parallel. Use these exact paths.

1. `ls` `/home/tsb/.pi/agent/extensions/compact-tools`
2. `find` `/home/tsb/.pi/agent/extensions/compact-tools` pattern `*.ts`
3. `grep` `renderShell` in `/home/tsb/.pi/agent/extensions/compact-tools/index.ts`
4. `bash` `node --test /home/tsb/.pi/agent/extensions/compact-tools/paths.test.ts`
5. `read` `/home/tsb/.pi/agent/extensions/compact-tools/paths.ts` limit 20
6. `module_report` `/home/tsb/.pi/agent/extensions/compact-tools/index.ts` view compact

Then stop. Reply with one line: `tools-look done`.
