# Phase 9: hand-off

## 1. Report: `report/index.html`

One self-contained HTML page (inline CSS, images next to it in `report/`), readable on a phone. Sections:

1. **Summary**: what was built, test URL, direct paywall link (`?go=paywall`), provider and mode (test/live).
2. **Reference**: name and URL of the cloned funnel, date captured, number of steps; what was deliberately
   changed (rebrand, skipped or added steps, replaced claims).
3. **Side by side**: for every step a row with the reference screenshot and the clone screenshot at the same size,
   step number and slug. Group long funnels into sections (quiz, interstitials, loader, email, paywall, checkout).
   Also produce one contact-sheet image per variant (`report/<variant>-screens.jpg`) for chat previews.
4. **Plans and payments**: plan table (today, renewal, period, provider ids), how intro offers work, test cards.
5. **Tracking**: events and where they fire, screenshot of Test events (emails cropped).
6. **App integration**: link to `docs/developer-spec.md`, what the developer still has to do.
7. **Open items**: everything waiting on someone, with who.

Run `scripts/check_secrets.sh <funnel>` on the report folder before sharing. If the platform can publish pages,
publish the report and give the link; keep the files in `report/` either way.

## 2. Domain instructions: `report/domain-<domain>.html`

Fill `templates/domain-instructions.md` for the client's domain and registrar and render it to HTML. It is written
for a non-technical person who will forward it or follow it alone:
- what the funnel address will be and that the main site and email are not affected;
- where to open DNS settings at their registrar (give the menu path for the registrar if known);
- the records to add, each in a table row with a copy button;
- what to send back ("done"), and what happens after (mapping, certificate, payment domain registration, test
  payment);
- how to check it worked and what is normal (certificate warning for up to a few hours);
- FAQ.

How mapping works, for you:
- Cloud Run domain mappings (`gcloud beta run domain-mappings create --service <svc> --domain <domain>
  --region <region>`) work in a subset of regions, including `us-central1`. Elsewhere use a global external
  Application Load Balancer with a serverless NEG, or Firebase Hosting rewrites.
- The domain must be verified in Google Search Console by the account that creates the mapping. If you deploy
  with a service account, the user verifies the domain with their Google account and adds the service account's
  email as an **owner** of the property. The TXT record for verification is the first record in the instructions.
- A subdomain (`quiz.example.com`) needs one `CNAME → ghs.googlehosted.com.`. An apex domain needs the A and AAAA
  records that `gcloud beta run domain-mappings describe` prints.
- After the certificate is issued: register the domain for Apple Pay / Google Pay (Stripe) or submit it for
  approval (Paddle), recreate the payment webhook on the new domain, update `BASE_URL` in env and the developer
  spec, and run one test payment on the domain.

## 3. Message to the user

Three to five lines: test URL, report link, domain instructions link, developer spec link, what is needed from
them or their client. Then update `funnel.config.json → status`.

## Final checklist

- [ ] Funnel in its own folder; `funnel.config.json`, `.env.example`, `docs/` filled; no secrets in git
- [ ] Every reference step reproduced; side-by-side screenshots in the report
- [ ] Payments: test purchase, 3-D Secure, webhook received, metadata correct
- [ ] Pixel + CAPI: `CompleteRegistration` and `Purchase` deduplicated in Test events
- [ ] Subscription API: `has_access: true` for the test buyer; developer spec sent
- [ ] Test deploy on Cloud Run passed the smoke test
- [ ] Domain instructions delivered
- [ ] Open items listed with owners
