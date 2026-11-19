# Data Analysis and Visual Evidence

Begin with a decision question, population, time window, units, data grain and known
limitations. Inventory input files and inspect schemas/samples before scanning full
datasets. Establish keys and join cardinality. Check missing values, duplicates,
outliers, invalid types, date/time zones and inconsistent category labels.

Preserve raw data. Apply explicit transformations with a reproducible record. Reconcile
row counts and sums before and after filters, joins and aggregation. One-to-many joins
must not silently multiply metrics. Distinguish stock versus flow, percentage versus
percentage point, weighted versus unweighted averages and correlation versus causation.

Choose methods proportional to the question. Include a baseline and sensitivity analysis
when assumptions materially affect the recommendation. State sample sizes, exclusions,
measurement uncertainty and unavailable fields. A small or selected sample cannot support
an unqualified population claim. Do not hide contradictory observations.

Choose visuals by task: bars for category comparison, lines for ordered time, scatter for
relationships, histogram for distribution and a concise table for exact lookup. Label
units/periods, use consistent scales, avoid 3D and preserve a zero baseline for magnitude
bars. Annotate the relevant finding rather than decorating every point. Use native Office
charts where supported so the user can edit them.

Deliver the analysis as a usable artifact: sources/input definitions, key findings,
reconciled outputs, relevant charts, limitations and recommended action. Use
work-spreadsheets for a workbook and work-presentations/work-word for a polished report.
Verify important values against the source and clearly identify estimated quantities.
