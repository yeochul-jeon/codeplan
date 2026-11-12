# Plan file

The plan file is `<home>/plan.json` (by default `docs/codeplan/plan.json`).
People write its names, descriptions, `uses` and scenarios; the tool counts
files and lines for each part from its `paths`.

```json
{
  "format": 1,
  "name": "shop",
  "about": "The web shop. {cart} sends orders to {pay}, which records them in {ledger}.",
  "parts": [
    {
      "id": "cart",
      "name": "Cart",
      "zone": "store",
      "about": "Holds what a customer is about to buy.",
      "start": "src/cart/index.ts",
      "paths": ["src/cart/**"],
      "uses": [
        { "to": "pay", "why": "to charge the order", "evidence": ["src/cart/checkout.ts:12"] }
      ]
    },
    {
      "id": "pay",
      "name": "Payments",
      "zone": "store",
      "about": "Charges cards and writes each charge to {ledger}.",
      "paths": ["src/pay/**"],
      "uses": [{ "to": "ledger" }],
      "note": "Card details never reach this repository."
    }
  ],
  "externals": [
    { "id": "ledger", "name": "Ledger", "about": "The accounting service." }
  ],
  "scenarios": [
    {
      "id": "checkout",
      "name": "One order is paid",
      "steps": [
        { "at": "cart", "does": "Sends the basket total to {pay}." },
        { "at": "pay", "does": "Charges the card." },
        { "at": "ledger", "does": "Keeps the charge." }
      ]
    }
  ]
}
```

## Fields

### Top level

| Field | Required | What to write |
|---|---|---|
| `format` | yes | The number `1`. |
| `name` | yes | The repository's name. May be empty. |
| `about` | yes | What this repository is. May be empty. |
| `parts` | yes | The parts, as an array. May be empty. |
| `externals` | no | Things the code uses that are not in this repository (databases, outside APIs, other repositories). Missing means `[]`. |
| `scenarios` | no | Paths one request takes through parts and externals. Missing means `[]`. |
| `note` | no | A note for people. |

### Part

| Field | Required | What to write |
|---|---|---|
| `id` | yes | A unique id (see below). |
| `name` | yes | The name shown on the page. May be empty; the page then shows the id. |
| `zone` | no | A grouping name. Parts with the same `zone` are drawn in one frame. An empty `zone` is the same as none. |
| `about` | yes | What this part is and why it is separate. May be empty. |
| `start` | no | One file to start reading this part from, as a path from the repository root. It may be outside the watch set (a README, for instance). |
| `paths` | yes | One or more globs: the files this part owns. |
| `planned` | no | `true` for a part whose code is not written yet (see below). `false` is the same as leaving it out. |
| `uses` | no | The parts and externals this part uses. Missing means `[]`. |
| `note` | no | A note for people. |

A planned part lets the plan come before the code. It needs `paths` like
any part, other parts may use it, and scenario steps may be at it. While its
`paths` match no file, `check` does not report `empty-part` for it, and its
`start` may name a file that does not exist yet. As soon as a file matches,
the file is counted in the part and `check` warns with `planned-has-files`:
remove `planned` in the change that adds the code. The tool never changes
`planned` itself, and `draft` does not write it.

### An element of `uses`

| Field | Required | What to write |
|---|---|---|
| `to` | yes | The id of a part or an external. |
| `why` | no | What it is used for. |
| `evidence` | no | An array of strings, usually `file:line` places in the code. |
| `note` | no | A note for people. |

### External

| Field | Required | What to write |
|---|---|---|
| `id` | yes | A unique id. |
| `name` | yes | The name shown on the page. May be empty. |
| `about` | yes | What it is. May be empty. |
| `note` | no | A note for people. |

### Scenario and step

| Field | Required | What to write |
|---|---|---|
| `id` | yes | A unique id (scenario). |
| `name` | yes | What the scenario follows, for example "One order is paid" (scenario). |
| `steps` | yes | The steps, in order (scenario). |
| `at` | yes | The id of the part or external where the step happens (step). |
| `does` | yes | What happens there (step). |
| `note` | no | A note for people (scenario or step). |

## Rules

- An id is not empty, uses only lowercase ASCII letters, digits and
  hyphens, and does not start or end with a hyphen. This applies to the ids
  of parts, externals and scenarios and to `to` and `at`.
- Ids are unique across parts, externals and scenarios together.
- `paths` must hold at least one glob; each must be a non-empty string.
- `start` follows the path form in [config](config.md#path-values). A file
  name with a backslash cannot be written as a `start`.
- Text fields (`name`, `about`, `why`, `does`, `zone`) may be empty.
- An unknown key is an error, except `note`, which any object may have. The
  tool keeps `note` but does not read it.
- There are no fields for position, size, shape or colour. The page works
  them out from the counts and the structure.

## References in text

In `about` (top level, part, external), `why` and `does`, `{id}` names a part
or external. The page shows the name in its place during a walk-through.
Only `{` + an id + `}` is a reference; other braces are plain text. Braces in
`name`, `zone` and `note` are never references.

## When a key appears twice

When an object has the same key twice, the last value is used, at the place
where the key first appears.

The checks that run on this file are listed in [diagnostics](diagnostics.md).
