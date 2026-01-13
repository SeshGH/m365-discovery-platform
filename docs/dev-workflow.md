# Developer Workflow & Command Hygiene

## Purpose

This document defines **how development work is performed** on the M365 Discovery Platform — not just *what* is built.

Its goals are to:
- Reduce cognitive load and reliance on memory
- Prevent undocumented “magic commands”
- Encourage deliberate, understandable automation
- Reinforce security-by-design and architectural intent
- Ensure future contributors (including future-us) can work effectively

This is a **workflow and philosophy contract**, not a checklist.


---

## Core Principles

### 1. One step at a time
- Changes are made incrementally
- Each step should be:
  - Understandable on its own
  - Testable in isolation
  - Easy to roll back

We explicitly avoid “big bang” changes.

---

### 2. Explicit beats clever
- Commands should be readable and self-explanatory
- Prefer:
  - documented HTTP calls
  - clear scripts
  - obvious inputs and outputs
- Avoid:
  - hidden side effects
  - unexplained automation
  - tribal knowledge

If something is non-obvious, it must be documented.

---

### 3. No reliance on memory
Developers should **not need to remember**:
- exact API endpoints
- request bodies
- environment assumptions
- command syntax

If a command is used more than once, it should exist in:
- documentation
- notes
- or a script

Memory is fallible — documentation is durable.

---

### 4. Documentation before automation
The progression is intentional:

1. **Document the manual command**
2. **Repeat it a few times**
3. **Extract into a script**
4. **Optionally formalise tooling later**

We do **not** start with:
- Makefiles
- task runners
- abstractions

Those come later *only if justified*.

---

### 5. Verify before modifying
Before recommending or applying changes:
- Files must be reviewed in full
- Behaviour must be understood
- Assumptions must be stated explicitly

When changes are required:
- The **entire file** should be replaced
- Partial snippets are avoided for critical files

This prevents drift and accidental inconsistencies.

---

### 6. Version control is part of the workflow
- Commits are made:
  - at logical boundaries
  - after working states
  - before context switching
- Commit messages should explain **intent**, not mechanics

If something is worth doing, it is worth committing.

---

## Command Hygiene

### Canonical commands
Frequently used commands (e.g. triggering a discovery run, querying runs, downloading artefacts) should live in:
- documentation (`docs/`)
- or personal notes (e.g. OneNote)
- and eventually scripts if repetition justifies it

Examples include:
- `Invoke-RestMethod` calls for runs
- job and findings queries
- artefact download flows

These commands are **first-class development artefacts**, not throwaway snippets.

---

### Scripts are allowed — magic is not
Scripts are encouraged when:
- a command is repetitive
- parameters are well understood
- behaviour is stable

Scripts must:
- be readable
- avoid hidden defaults
- document what they do and why

---

## Relationship to Other Docs

This document complements (but does not replace):

- **local-development.md**  
  How to run the platform locally

- **runs-and-jobs.md**  
  Execution and lifecycle model

- **findings-model.md**  
  Risk classification and prioritisation

- **discovery-coverage-roadmap.md**  
  What the platform does today and what is planned

- **security.md**  
  Threat model and design decisions

Together, these form a layered understanding:
- *How we work*
- *How the system works*
- *Why it works this way*

---

## What This Document Is Not

- Not a task runner spec
- Not a Makefile replacement
- Not a shortcut around understanding
- Not a prohibition on tooling

It exists to ensure tooling is **earned**, not accidental.

---

## When to Revisit This

This document should be revisited if:
- commands become error-prone
- onboarding friction increases
- repetition becomes painful
- automation feels overdue

Any evolution should preserve the original intent:
> clarity first, automation second.

---

## Final Note

This workflow is intentional.

It prioritises:
- learning
- correctness
- maintainability
- and long-term velocity over short-term speed

That trade-off is deliberate.


---

## Local-only files

Some local test downloads (e.g. `downloaded-artefact`) are intentionally ignored via `.gitignore`.
