# funnel-cloner

A Claude skill that rebuilds a web-to-app subscription funnel (quiz → email → paywall → checkout) from a reference
funnel, step by step and design for design, and ships it with payments, ad tracking and an API for the app.

What you get for each funnel:

- **A faithful clone of the reference flow**: same steps, order, question types, interstitials, loaders and paywall
  mechanics, with your brand, your copy and newly generated photos.
- **Payments** with Stripe (on-site Payment Element, Apple Pay / Google Pay) or Paddle Billing (inline checkout).
  Intro prices, trials with a paid first week, webhooks.
- **Meta Pixel + Conversions API**: `CompleteRegistration`, `InitiateCheckout`, `Purchase`, browser and server,
  deduplicated by `event_id`.
- **Subscription status API** (`/v1/subscription`, `/v1/me`, push webhooks) so your iOS / Android app can unlock
  access for web buyers, plus a ready-to-send spec for the app developer.
- **Test deploy to Google Cloud Run**, then step-by-step domain instructions for a non-technical client.
- **A hand-off report** with reference and clone screenshots side by side.

## Install

**Claude apps (claude.ai, desktop, mobile).** On this page press **Code → Download ZIP**. In Claude open
**Settings → Capabilities → Skills**, choose **Upload skill** and select the ZIP. The skill appears as
`funnel-cloner`.

**Claude Code, all projects:**

```bash
git clone https://github.com/gushchinda/funnel-creator ~/.claude/skills/funnel-cloner
```

**Claude Code, one repository** (everyone working in that repo gets the skill):

```bash
git clone https://github.com/gushchinda/funnel-creator .claude/skills/funnel-cloner
rm -rf .claude/skills/funnel-cloner/.git
```

## Use

Ask Claude something like *"I want a funnel like this competitor's for my app"*. The skill then works as a guided
dialogue:

1. It asks for the link to the competitor's funnel — and nothing else.
2. It walks that funnel to the paywall, screenshots every step and shows you a screen sheet with a short summary:
   steps, blocks, paywall, prices, payment provider, pixel events.
3. It asks the rest in small blocks (up to five questions, each with a default you can accept): what to change,
   your product, plans and paywall, Stripe or Paddle, Meta Pixel and CAPI, Google Cloud project, how your app
   identifies buyers.
4. It shows the clone plan step by step and builds after your "go".
5. It deploys a test version to your Cloud Run, then hands over a report and domain instructions for your client.

Keys go into environment variables or a gitignored `.env`, never into chat or the repository.

## Requirements

- Node.js 22+, Python 3.10+ with Pillow, Playwright with Chromium (for capturing the reference)
- `gcloud` CLI with access to a Google Cloud project (Cloud Run, Cloud Build, Artifact Registry)
- A Stripe or Paddle account, a Meta Pixel, optionally a fal.ai key

## Layout

```
SKILL.md          workflow and rules (Claude reads this first)
references/       one file per phase, loaded when needed
templates/        server, payment pages, pixel bridge, developer spec, domain guide, config example
scripts/          reference capture, image generation, Stripe/Paddle setup, deploy, secret check
```

## Notes

- Clone the structure and experience of a reference funnel, not its brand: the skill replaces names, logos,
  photos, testimonials and claims, and rewrites copy.
- Test mode first. The skill switches to live payment keys only when you say so.
