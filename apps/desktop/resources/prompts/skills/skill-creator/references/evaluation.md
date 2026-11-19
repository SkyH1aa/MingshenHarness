# Skill Trigger and Trace Evaluation

Evaluate a Skill against realistic, differently worded requests. Keep a compact ledger:

```text
case | user intent | should trigger? | triggered? | loaded resources | observable result | issue
```

Use two or three representative prompts and one adjacent near-miss. Vary wording,
language, file names, and missing details without changing the underlying capability.
Do not tune only to the exact sentence used to create the Skill.

An underspecified prompt tests whether the Skill asks for material information without
stalling on recoverable details. A well-specified prompt tests execution and finishing.
A near-miss tests that the description is not so broad that it captures unrelated work.

Inspect the trace for:

- metadata chosen correctly; the right Skill selected;
- unnecessary reads, scripts, subagents, or tool loops;
- missing inspection before mutation;
- unsupported assumptions or invented facts;
- verification proportional to the risk;
- premature completion, unanswered questions, or a result that cannot be used.

Revise one cause at a time. Strengthen the description when activation is wrong, clarify
routing when the body loads the wrong reference, and simplify the body when behavior is
over-prescribed. Do not fix one weak example by adding a pile of special cases.

Report evaluation as actual, failed, partial, or not run. A model-generated summary of
the intended behavior is not a trial.
