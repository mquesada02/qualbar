# qualbar

qualbar is a fast, strict quality gate for TypeScript and JavaScript repos, built for coding agents.

## Language

### Rules and results

**Category**:
A named group of rules, such as `function`, `types`, `crap`, `architecture`, `cohesion`, `dry-yagni` or `mutation`. `--only` selects categories.
_Avoid_: module (that word means a file, see **Module**), analysis, suite

**Rule**:
One check with an id of the form `<category>/<rule>` (for example `function/cyclomatic`) and a threshold (for example `<= 10`).

**Measurement**:
A raw value that an analyzer reports for a location, or a `{count, total}` pair for a ratio rule.
_Avoid_: metric value

**Gate**:
The part that compares measurements with rule thresholds and produces findings.

**Finding**:
A measurement that breaks its rule, with a severity (error or warning), a message and a fix hint.

**Principle**:
A design principle that a rule supports (for example DRY, SRP, YAGNI), carried as a label on rules and findings. `principle/ocp` and `principle/lsp` are explain-only entries: they are never scored.

### Scores over time

**Aggregate**:
A package-level ratio score, such as duplication %, type coverage % or mutation score.

**Ratchet**:
The file `qualbar.ratchet.json` (written by `qualbar ratchet`) that stores aggregates. A later run may not make an aggregate worse. The ratchet never exempts a finding.
_Avoid_: baseline (in other tools a baseline ignores old findings, which qualbar never does)

### Code scopes

**Module**:
One JS or TS file, as a node of the module graph.

**Unit**:
A piece of code that the function rules measure: a function, method, arrow function or class static block. The spec defines the exact list.

**Component**:
A named set of paths in the architecture config. Martin metrics and layer rules apply per component.

**Package**:
A workspace package in a monorepo (npm, pnpm or yarn workspaces). Aggregates and ratchet entries are per package.

### Runs and output

**Report**:
The output of one `check` run: the status, the result per category, the findings and a summary (new, worsened, improved).

**Partial report**:
A report from a run limited by `--only`, `--package`, `--changed` or `--shard`. A partial report never updates the ratchet.

**Changed-only mode**:
A run limited to changed files and their dependents, which runs only the affected tests. The agent's fast loop. It gives a partial report.

**Fingerprint**:
A stable id for a finding that links the same finding across runs and line moves.

## Relationships

- A **Category** has one or more **Rules**; a **Rule** belongs to exactly one **Category** and has zero or more **Principles**.
- The **Gate** turns **Measurements** into **Findings**; each **Finding** has one **Fingerprint**.
- A **Package** contains **Modules**; a **Component** groups **Modules** by path; a **Module** contains **Units**.
- The **Ratchet** stores one set of **Aggregates** per **Package**; only a full (non-partial) **Report** may update it.

## Flagged ambiguities

- "module" meant a group of rules in quality-ts; in qualbar it means a file. The group is a **Category**.
- "baseline" in quality-ts stored only aggregates; qualbar calls this the **Ratchet** to avoid the "ignored findings" meaning.
