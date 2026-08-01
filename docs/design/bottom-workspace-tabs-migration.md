# Bottom Workspace → Tabs: Architecture & Safe Migration Path

**Status: prototype / not implemented.** This is the Phase 2E deliverable — an
architecture note and the safest migration path for converting the trading
view's lower workspace from a vertical stack into a tabbed workspace. No tab code
ships in Phase 2 because the naive implementation regresses live data (see
*Risk* below). The full switch is deferred to the V3 Contract Workspace effort.

## Current state

In `client/src/App.tsx` the `tradingView` center column stacks, top to bottom:

| Order | Panel | Element | Disclosure today |
| --- | --- | --- | --- |
| 1 | Chart | `chartPanelEl` | always visible |
| 2 | Options Matrix | `chainPanelEl` | always visible (bounded `h-[32rem]`) |
| 3 | AI / Desk Insight | `deskInsightPanel` | always visible |
| 4 | Greeks & Contract Analysis | `GreeksPanel` in `CollapsibleSection` | collapsed by default |
| 5 | Scanner | `scannerPanelEl` in `CollapsibleSection` | collapsed by default |

The operator scrolls `<main>` to move between AI → Greeks → Scanner. Chart and
Matrix are the anchors; everything below is progressive-disclosure today.

**Target:** replace items 3–5 (and future Automation / Journal / Analytics) with
a single tabbed workspace — one pane visible at a time, selected by a tab bar —
so the operator *changes workspaces* instead of scrolling.

```
┌ AI · Greeks · Scanner · Automation · Journal · Analytics ┐
│                                                          │
│                 (one pane, bounded height,               │
│                  its own internal scroll)                │
└──────────────────────────────────────────────────────────┘
```

## Risk: why conditional mounting is unsafe

`GreeksPanel` and `OptionsScanner` acquire live-quote subscriptions / fire REST
fetches on mount. The obvious tab implementation —

```tsx
{tab === 'greeks' ? <GreeksPanel/> : tab === 'scanner' ? <Scanner/> : <AI/>}
```

— **unmounts the inactive panes**, which tears down their subscriptions and
refetches on every tab switch. Consequences:

- Live option/Greeks subscriptions drop and re-`live:subscribe` on each switch —
  extra socket churn and a visible re-warm flicker.
- Scanner re-runs its fetch; scroll position, expanded rows, and in-flight AI
  requests are lost.
- Increased backend/provider load from repeated (re)subscription.

That violates the Phase 2 boundary ("no websocket logic changes, no data
regressions") in spirit even though no data *code* changed.

## Safe pattern: mount-all, toggle visibility

Keep every pane **mounted**; hide inactive panes with CSS (`hidden` /
`display:none`) rather than unmounting them.

```tsx
<div role="tablist" aria-label="Workspace">
  {TABS.map(t => (
    <button role="tab" aria-selected={t.id === active} aria-controls={`pane-${t.id}`}
      id={`tab-${t.id}`} onClick={() => setActive(t.id)} /* + arrow-key roving */>
      {t.label}
    </button>
  ))}
</div>
{TABS.map(t => (
  <div key={t.id} role="tabpanel" id={`pane-${t.id}`} aria-labelledby={`tab-${t.id}`}
       hidden={t.id !== active} className="min-h-0 flex-1 overflow-y-auto">
    {t.render()}   {/* the EXISTING deskInsightPanel / GreeksPanel / scannerPanelEl, unchanged */}
  </div>
))}
```

Properties:

- **Subscriptions persist** across switches — inactive panes are merely hidden,
  never unmounted, so no re-`live:subscribe`, no refetch, no flicker.
- **State persists** — scroll position, expanded rows, form drafts survive.
- Each pane keeps its own bounded height + internal scroll (already true today),
  which is what removes the page scroll.
- The panels themselves are reused **verbatim** — zero changes to Greeks, AI, or
  Scanner internals, so the diff is additive and trivially revertible.

For heavy panes that are rarely opened, a *mount-once-on-first-activation* refinement
(lazy mount, then keep mounted) trades a first-open delay for lower idle cost — optional.

## Active-tab state

- Store `active` as local view state in `App.tsx` (`useState`), optionally
  persisted to `localStorage` per operator. This is **view** state, not business
  or market state — it does not touch the market store, order lifecycle, or any
  MongoDB/API contract.
- Sensible default: `AI` when no contract is selected, `Greeks` once a contract
  is armed (mirrors the Select → Analyze → Review workflow).

## Incremental migration steps

1. Add a presentational `WorkspaceTabs` component (tablist + panes, CSS
   visibility toggle, `role=tablist/tab/tabpanel`, roving arrow-key focus). No
   data, no business logic.
2. Wrap the **existing** `deskInsightPanel`, `GreeksPanel`, and `scannerPanelEl`
   as panes — panels unchanged.
3. Default active tab per workflow; keep all panes mounted.
4. Verify (screenshots + network/socket trace) that switching tabs does **not**
   re-subscribe or refetch, and that Greeks/Scanner keep streaming.
5. Only then retire the `CollapsibleSection` wrappers for these three.
6. Later: add Automation / Journal / Analytics panes as those surfaces land.

## Accessibility

`role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`,
`aria-controls`/`aria-labelledby`, roving `tabindex` with Left/Right (and
Home/End) arrow navigation, and a visible focus ring on the active tab. Hidden
panes use the `hidden` attribute so they are removed from the a11y tree and tab
order while mounted.

## Rollback

Because panes reuse the same components, reverting to the stacked +
`CollapsibleSection` layout is a one-line swap of the container — no data or
component changes to unwind.
