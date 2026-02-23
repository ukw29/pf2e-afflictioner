# PF2e Afflictioner — Strings Needed for Another Locale Parsing

This file lists every English string the parser matches against item description text.
FoundryVTT enricher syntax (`@Damage[...]`, `@UUID[...]`, `@Check[...]`, `[[/r ...]]`) is
**not** listed — those are engine tokens that stay the same in all locales.

---

## 1. Affliction Trait Names

Used to detect affliction type from item traits.

| English    | Another |
| ---------- | ------- |
| `poison`   | ?       |
| `disease`  | ?       |
| `curse`    | ?       |
| `virulent` | ?       |

---

## 2. Structural Section Headers

These appear as bold labels in item descriptions (often inside `<strong>` tags).

| English                                        | Another |
| ---------------------------------------------- | ------- |
| `Stage` (followed by a number, e.g. "Stage 1") | ?       |
| `Onset`                                        | ?       |
| `Maximum Duration`                             | ?       |

---

## 3. Stage Cross-Reference Phrase

Used when one stage says "same effects as stage N".

| English pattern                  | Another |
| -------------------------------- | ------- |
| `as stage N` (e.g. "as stage 2") | ?       |

---

## 4. Duration Units

Used in `parseDuration`. The parser strips a trailing `s` so both singular and plural are covered.

| English (singular / plural) | Another |
| --------------------------- | ------- |
| `round` / `rounds`          | ?       |
| `minute` / `minutes`        | ?       |
| `hour` / `hours`            | ?       |
| `day` / `days`              | ?       |
| `week` / `weeks`            | ?       |

---

## 5. DC Label

Used when no structured DC data is present and the parser falls back to plain text.

| English                                   | Another |
| ----------------------------------------- | ------- |
| `DC` (followed by a number, e.g. "DC 18") | ?       |

---

## 6. Death-Detection Keywords

Any of these in a stage description marks it as a death stage.

| English         | Another |
| --------------- | ------- |
| `dead`          | ?       |
| `dies`          | ?       |
| `instant death` | ?       |

---

## 7. Manual-Handling Keywords

If a stage contains any of these, it is flagged for GM attention instead of being auto-applied.

| English      | Another |
| ------------ | ------- |
| `secret`     | ?       |
| `gm`         | ?       |
| `special`    | ?       |
| `ability`    | ?       |
| `save again` | ?       |
| `choose`     | ?       |
| `option`     | ?       |
| `or`         | ?       |
| `either`     | ?       |
| `instead`    | ?       |
| `permanent`  | ?       |

---

## 8. Damage Types (plain-text fallback)

Used when no `@Damage[...]` enricher is present. The parser scans for `NdN <type>` patterns.

| English       | Another |
| ------------- | ------- |
| `acid`        | ?       |
| `bludgeoning` | ?       |
| `cold`        | ?       |
| `electricity` | ?       |
| `fire`        | ?       |
| `force`       | ?       |
| `mental`      | ?       |
| `piercing`    | ?       |
| `poison`      | ?       |
| `slashing`    | ?       |
| `sonic`       | ?       |
| `bleed`       | ?       |
| `persistent`  | ?       |

---

## 9. Condition Names

Matched against plain text in stage descriptions. Also used to identify conditions inside
`@UUID[...]{Display Name}` enrichers.

| English             | Another |
| ------------------- | ------- |
| `blinded`           | ?       |
| `broken`            | ?       |
| `clumsy`            | ?       |
| `concealed`         | ?       |
| `confused`          | ?       |
| `controlled`        | ?       |
| `cursebound`        | ?       |
| `dazzled`           | ?       |
| `deafened`          | ?       |
| `doomed`            | ?       |
| `drained`           | ?       |
| `dying`             | ?       |
| `encumbered`        | ?       |
| `enfeebled`         | ?       |
| `fascinated`        | ?       |
| `fatigued`          | ?       |
| `fleeing`           | ?       |
| `frightened`        | ?       |
| `friendly`          | ?       |
| `grabbed`           | ?       |
| `helpful`           | ?       |
| `hidden`            | ?       |
| `hostile`           | ?       |
| `immobilized`       | ?       |
| `indifferent`       | ?       |
| `invisible`         | ?       |
| `malevolence`       | ?       |
| `observed`          | ?       |
| `off-guard`         | ?       |
| `paralyzed`         | ?       |
| `persistent-damage` | ?       |
| `petrified`         | ?       |
| `prone`             | ?       |
| `quickened`         | ?       |
| `restrained`        | ?       |
| `sickened`          | ?       |
| `slowed`            | ?       |
| `stunned`           | ?       |
| `stupefied`         | ?       |
| `unconscious`       | ?       |
| `undetected`        | ?       |
| `unfriendly`        | ?       |
| `unnoticed`         | ?       |
| `wounded`           | ?       |

### Condition Aliases

These display names are remapped internally before matching.

| Display name in text | Maps to condition | Another display name |
| -------------------- | ----------------- | -------------------- |
| `Flat-Footed`        | `off-guard`       | ?                    |

---

## 10. Weakness Patterns

Two plain-text patterns are matched.

| English pattern                                    | Another equivalent |
| -------------------------------------------------- | ------------------ |
| `weakness to <type> N` (e.g. "weakness to fire 5") | ?                  |
| `weakness N to <type>` (e.g. "weakness 5 to fire") | ?                  |

---

## 11. Multiple Exposure Patterns

Two patterns are matched to detect "exposure stacks the affliction".

| English pattern                                                   | Another |
| ----------------------------------------------------------------- | ------- |
| `each time you're/are exposed … increase/advance … stage(s) by N` | ?       |
| `each additional exposure … increase/advance … stage(s) by N`     | ?       |
| `multiple exposures … increase/advance … stage(s) by N`           | ?       |
| `while/at/when (already) at stage N` (minimum stage qualifier)    | ?       |

---

## Notes for the translator

- **All matches are case-insensitive**, so only one form per term is needed.
- **Duration unit matching strips a trailing `s`**, so `round` covers both "round" and "rounds".
- Condition names in `@UUID` enrichers come from the display text inside `{...}`, e.g.
  `@UUID[Compendium.pf2e.conditionitems.Item.xyz]{Clumsy 1}` — the parser reads `Clumsy 1`.
- If the Another system uses different structural keywords (e.g. a different word for "Stage"
  in item HTML), those are the strings that matter — not necessarily a literal translation.
  Check an actual Another-localized affliction item's raw HTML to confirm.
