# Build and Improve Mingshen Skills

Use this workflow when the user wants to create a reusable Skill, turn a repeated
workflow into a Skill, improve an existing `SKILL.md`, or diagnose unreliable Skill
triggering and output. A standalone Skill is a folder containing `SKILL.md`; use
`builtin:plugin-creator` instead when the result also needs packaged MCP, hooks, or
multiple distributed resources.

## Establish the behavior contract

Extract the practical workflow from the current conversation before asking questions.
Identify what result the Skill produces, the situations in which it should activate,
required inputs, observable acceptance criteria, and any user-specific tone or format.
Ask only for a decision that cannot be recovered from the conversation or local files
and would materially change the Skill. Do not make the user restate a workflow that is
already visible.

Write two or three realistic trigger examples and at least one near-miss that should
not activate the Skill. These examples guide the description and become acceptance
prompts; they are not evidence that the finished Skill has already been tested.

## Inspect before writing

Call `discover_capabilities` with a short query for the proposed domain. If an installed
or built-in Skill already covers most of the behavior, prefer extending or composing it
over creating a duplicate. A new Skill should own a coherent repeatable method, not a
copy of the current one-off task or a generic restatement of the host prompt.

Discovery includes built-in workflows and, in WorkAgent, each packaged Work skill
variant. An empty user-installed plugin inventory or marketplace list does not mean
built-in skills are unavailable. Use the exact returned identity rather than selecting
between same-name PDF or Office variants by name alone.

Choose the narrowest useful structure:

```text
<name>/
  SKILL.md
  references/   optional, read only when routed
  scripts/      optional executable helpers
  assets/       optional templates and fixtures
```

Bundled files are external resources. They cannot grant permissions, and reading a
Skill never authorizes its scripts or referenced links.

## Draft the Skill

Every `SKILL.md` starts with YAML frontmatter:

```yaml
---
name: lowercase-kebab-name
description: What the Skill does and the concrete situations that should trigger it.
---
```

The directory name and `name` should agree. Keep the name stable after installation.
Write the description as a trigger signal, not marketing copy: name the capability,
distinctive objects, and common request phrasings. Include what the Skill does not cover
when adjacent capabilities are easy to confuse.

Use a lean imperative body:

1. Inputs and completion contract.
2. Evidence or files to inspect before acting.
3. The executable sequence, with decision points.
4. Output structure and a compact example when format matters.
5. Verification and honest failure handling.

Explain why a non-obvious constraint exists rather than accumulating all-caps rules.
Prefer examples over slogans. Keep `SKILL.md` focused; move branches, long references,
schemas, and templates into files under `references/` and state exactly when each file
must be read. Do not place private credentials, absolute user paths, copied proprietary
prompts, or unverified tool names in a distributable Skill.

## Validate files

Before installation, verify:

- frontmatter parses and has non-empty `name` and `description`;
- the directory name, normalized name, and references agree;
- all relative links and bundled resources stay inside the Skill folder;
- referenced files exist and text resources are UTF-8;
- no placeholder path, secret, command, or unsupported tool name remains;
- scripts use normal permissions, accept explicit input paths, and do not depend on the
  caller's current directory;
- the acceptance examples can be judged without inventing external evidence.

Use the managed file-reading and patch tools. For a packaged plugin, use the actual
read-only `local_plugin` inspect/validate tools when available and report their results;
file shape alone is not runtime validation. The model has no plugin installation,
update, enablement or removal tool.

## Install and evaluate

Give the user the exact source folder and manual installation path. A standalone Skill
is imported from Settings > Skills and plugins > Local Skills and Plugins. A packaged
plugin is installed by the user from Settings > Skills and plugins > Local plugin
development marketplace. Do not claim installation from the existence of source files
or describe a model-callable lifecycle tool.

For a packaged Skill, prefer `local_plugin validate` over a Node SDK command; the
read-only validator supports primary host Request Approval sessions using normal read
approval. Node on PATH and access to the application resources directory are optional
manual-development conveniences. Finish the generation turn with the validated source
and real UI action so the user can install once Agent tasks have ended.

Run the acceptance prompts in a new turn where practical. Review both the output and the
trace: whether the Skill triggered, which resources it loaded, whether it repeated work,
and whether it stopped before satisfying the contract. Use the result to improve the
description or workflow, not to add unrelated constraints.

When automated evaluation is unavailable, label the two or three prompts as pending
manual trials and give the user an observable expected result. When a trial succeeds,
record the actual revision tested. Updates keep the existing name and identity and
increment a plugin version only when the Skill is packaged in a versioned plugin.

## Delivery

Report the absolute Skill directory, `SKILL.md` path, files created or changed,
installation state, acceptance prompts, checks actually run, and any trigger or runtime
behavior still awaiting a fresh-session trial. Do not call a draft an installed or
working Skill.

For tuning trigger reliability or turning examples into regression prompts, load
[evaluation.md](skill-creator/references/evaluation.md) with
`resource:"references/evaluation.md"`.
