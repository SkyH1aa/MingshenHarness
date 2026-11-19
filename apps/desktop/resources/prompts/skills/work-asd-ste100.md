# Controlled English for WorkAgent Output

Use this WorkAgent skill when English must be unambiguous for an agent, tool consumer,
translator, non-native reader, or maintenance workflow. Typical targets are prompts,
tool descriptions, error messages, status reports, operating procedures, release notes,
and inter-agent instructions. Do not apply its deliberately flat style to creative or
persuasive copy unless the user explicitly asks for it.

The packaged source entry is `resource:"references/source/SKILL.md"`. The full rule
summary, examples, linter source, README, and MIT license are under
`references/source/`. Load only the relevant source resource for the current task.

## Boundary

This is a practical controlled-language workflow inspired by ASD-STE100 Issue 9. It is
not an official ASD product and does not include the official approved-word dictionary.
Do not claim certified aerospace or defense compliance, official dictionary validation,
or authorization to redistribute the ASD standard. When exact approved-word compliance
matters, state that the official dictionary must be checked separately.

The source scripts are reference material. Do not automatically execute the bundled
linter or install anything. A deterministic lint can run only from a workspace copy
created within the current user-authorized task under the normal file, workspace,
approval, and isolation rules, and only when its environment is already available.
Do not modify the packaged host source in place. A linter pass does not prove that a
rewrite preserved meaning.

## Choose the mode

Use strict mode for procedures, error messages, tool descriptions, inter-agent
instructions, safety text, and any place where a wrong reading changes an action. Apply
the complete structural checklist and use plain-word consistency as a stated direction
of travel rather than pretending to have the official dictionary.

Use STE-flavored mode for READMEs, explanatory prose, pull-request descriptions, and
changelogs. Keep the structural discipline but allow natural vocabulary where the
fixed-word restriction would remove useful nuance. Do not use either mode for slogans,
brand voice, fiction, or persuasive copy.

## Rewrite procedure

1. Read the full source text before changing it.
2. Identify the reader, the required action, and every fact, number, condition, hedge,
   scope qualifier, exception, and safety statement.
3. Prefer active voice when the actor is known. Keep passive voice when the actor is
   unknown or irrelevant.
4. Use one instruction per sentence. Split compound instructions and semicolon joins.
5. Keep instruction sentences at or below 20 words and descriptive sentences at or
   below 25 words. Preserve clarity when a required condition needs more space.
6. Replace soft phrasal verbs and nominalized actions with direct verbs. Remove stacked
   hedges and unsupported marketing adjectives.
7. Use one name for one thing within the document. Reuse one verb for one action.
8. Keep necessary domain terms, but define a term once when an unfamiliar reader needs
   it. Avoid noun clusters longer than three words.
9. Preserve modality. "May have failed" must not become "failed." "Could be caused by"
   must not become "is caused by."
10. Check every rewritten sentence against the original before returning it.

For the complete rule summary, load
`resource:"references/source/references/writing-rules.md"`. For worked examples, load
`resource:"references/source/examples/before-after.md"`. For edge cases, load
`resource:"references/source/examples/linter-edge-cases.md"`.

## Output

By default, return only the rewritten text. Do not add a mode announcement, marketing
summary, violation count, or closing offer. If a longer phrasing was retained to
preserve a safety condition, scope, number, or hedge, add one line:

`Kept as-is: <phrase>; <information that would be lost>.`

When the user asks for the reasoning, show a compact table with the violated rule, the
original text, and the simplified text. Name any deliberate exception and its reason.
If the source already complies, say so instead of forcing cosmetic edits.

## Acceptance

Verify that the rewrite adds no cause, certainty, frequency, approval, or mechanism that
the source did not contain. Verify that no required condition or exception disappeared.
Keep exact identifiers, commands, field names, units, and enum values. Report separately
when the official word list was not checked or the optional linter was not run.
