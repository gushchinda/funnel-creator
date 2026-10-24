# Phase 1: capture the reference funnel

Goal: a complete, checkable record of the reference, so the build can match it step by step and the hand-off can
show reference and clone side by side.

## Output

```
<funnel>/reference/
  steps/NN-<slug>.png        one mobile screenshot per step (375×812, device scale 2)
  steps/NN-<slug>.json       step type, question, options, button labels, inputs, timings
  steps/NN-<slug>.html       outer HTML of the step's main container
  tokens.json                fonts, colours, radii, spacing, button and progress bar styles
  network.txt                third-party requests: pixels, analytics, payment provider, APIs
  paywall.md                 plans, prices, intro terms, timers, guarantees, legal text, payment methods
  flow.md                    the step table below, the single source of truth for the build
```

## How to walk it

1. **Automated pass.** `node scripts/capture_reference.mjs <url> --out <funnel>/reference` opens the funnel in
   headless Chromium at a phone viewport, and at each step saves screenshot, text, HTML and computed styles, then
   answers with the first option, fills inputs with neutral test values (`test+ref@example.com`, name "Alex",
   age 35, height 175 cm, weight 75 kg) and presses the primary button. It stops at the paywall, on a repeated
   screen, or after `--max-steps` (default 80).
2. **Fix what the script missed.** When it gets stuck (custom sliders, drag pickers, cookie walls, captchas),
   rerun with `--actions <file>.json`, giving explicit actions for the stuck step numbers:
   ```json
   { "7": [{"click": "text=Female"}], "19": [{"fill": ["input[type=number]", "70"]}, {"click": "text=Continue"}] }
   ```
3. **Branches.** If an early answer changes later steps (sex, goal, age), walk each branch that the funnel will
   have variants for and save under `reference/branch-<answer>/`.
4. **Paywall.** Screenshot the full paywall (scroll capture), each plan selected, the timer before and after it
   ends, any exit/downsell popup (try the back button and closing the tab), the checkout form, and the
   upsell screens if the reference shows them before payment. Do not pay.
5. **Blocked sites.** Many funnels block datacenter IPs or headless browsers. If the page does not load or looks
   different from what the user sees, switch to the user's real browser (for example a browser extension or
   remote-control tool if available) and capture the same files by hand. Tell the user which route you used.

## What to record per step (in `flow.md`)

| # | Slug | Type | Content | Interaction | Notes |
|---|---|---|---|---|---|
| 1 | intro | landing | headline, sub, hero image, CTA | tap CTA | logo top-left, no progress bar |
| 2 | age | single choice, image tiles | "What's your age?" 4 tiles with photos | auto-advance on tap | progress 1/30 |
| 9 | social-proof | interstitial | stat + chart | Continue | appears 600 ms after load |
| 24 | loader | loader | 3 progress bars, 8 s total, yes/no popups at 40% and 75% | wait | popups block progress |
| 27 | email | input | email field, privacy line under field | Continue disabled until valid | fires CompleteRegistration |
| 30 | paywall | paywall | timer 10:00, 3 plans, most popular = middle, struck prices, guarantee | select plan, Get my plan | see paywall.md |

Types to use: `landing`, `single`, `multi`, `image-single`, `slider`, `picker`, `input`, `interstitial`,
`chart`, `testimonial`, `loader`, `result`, `email`, `paywall`, `checkout`, `upsell`, `thank-you`.

Also note: whether answers auto-advance, back button behaviour, progress bar style and how it counts, animations
between steps, which answers are echoed back later ("Your plan for a 35-year-old…"), and every place the user's
answers personalise copy or charts.

## Design tokens (`tokens.json`)

The script collects computed styles for `body`, headings, option tiles (normal and selected), primary button
(normal and disabled), inputs, progress bar and paywall cards. Fill gaps by eye from screenshots. Record:
font families and weights (find the closest Google Font when the reference uses a commercial one), text sizes,
colour palette with roles (background, surface, text, muted, accent, success, border), radii, shadows, max content
width, side padding, vertical rhythm.

## Done when

- Every step from landing to checkout has a screenshot and a row in `flow.md`.
- `paywall.md` lists every plan with today's price, renewal price and period, and the exact terms text.
- `network.txt` shows which pixel events the reference fires and which payment provider it uses (useful for
  matching the checkout experience).
- The user has seen it: a screen sheet (every step as a thumbnail with number and type; a page if the platform can
  publish one, otherwise attached images) and a 5–8 line summary — number of steps, the blocks in order, the
  paywall model, payment provider, pixel events. This is the first thing the user sees from the skill; ask Block A
  of `references/first-run.md` in the same message.
