# Refero design directions for subtitle review

Bounded visual review of [Refero Styles](https://styles.refero.design/). These are inspiration directions, not a claim that every Refero style reflects the user's taste.

## Observed references

- **Linear** — [style page](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1), [captured screen](https://images.refero.design/styles/refero.design/image/57b6eb09-7dae-4a01-9684-5d126b717b56.jpg). The supplied screen is a dark, near-black product surface with a compact left rail, dense issue-detail workspace, hairline separation, restrained gray type, and a small bright status/action accent. The style notes specify Inter Variable, 16px body text with 1.5 line-height, 0.5px borders, and semantic acid-lime action use. **Application:** a calm request list/detail split; use the accent only for the current step or explicit approval, while evidence remains neutral. **Trade-off:** dark dense review screens can reduce subtitle legibility, Arabic rendering confidence, and error discoverability; require generous cue text, contrast checks, visible focus, and a light-theme option or carefully tested dark theme.

- **Dub** — [style page](https://styles.refero.design/style/b0d80806-b724-4ed1-a1d1-074edd3c9bc9), [captured screen](https://images.refero.design/styles/refero.design/image/a7696ebe-1836-4fb9-8eaa-7bf616cce18e.jpg). The screen shows a light, spacious admin shell: persistent navigation, a prominent summary strip, a bordered table, compact status pills, and a dark contextual information bar. **Application:** strongest fit for returning-user request triage: active/deferred/finished filters, candidate comparison rows, provenance/status chips, and a clearly separated “Approve and publish” action. **Trade-off:** pills and color-coded statuses must not be the only state signal; table density needs responsive behavior and readable Arabic/English columns.

- **Dashboard UI Design Examples** — [Refero guidance](https://styles.refero.design/examples/dashboard-ui-design). The page explicitly emphasizes scanning, comparison, predictable filters/tabs, and loading/empty/error/selected states rather than decorative cards. **Application:** use this as the interaction vocabulary for staged preview, evidence sections, blocked publication, and recovery—not as a visual template.

## Recommendation

Combine **Dub’s light evidence-first table structure** with **Linear’s disciplined restraint**: a light neutral canvas, thin borders, one semantic accent, and a focused review detail pane. It best supports occasional use without making uncertainty or approval look like routine completion. Treat motion as feedback only (selection, progress, publication result); no selected screenshot provided reliable motion evidence.

**Taste question:** for the actual review screen, do you prefer a bright “paper/workbench” surface (Dub) or a dark “instrument panel” surface (Linear)?
