<!--
Template for report/domain-<domain>.html. Fill every {{…}}, delete the registrar blocks that do not apply,
render to a single self-contained HTML page (inline CSS, light and dark theme, a "Copy" button next to every
value in the records table, readable at 375 px). Write in the client's language.
-->

# Connecting {{FUNNEL_DOMAIN}} to your funnel

**About 5 minutes of your time. Then 15 minutes to 24 hours of waiting for the internet to catch up.**

Your funnel already works at a temporary address: {{TEST_URL}}. These steps move it to **{{FUNNEL_DOMAIN}}**.
Your main website {{ROOT_DOMAIN}} and your email keep working exactly as before: we only **add** records, we do not
change or delete anything.

## 1. Open the DNS settings of {{ROOT_DOMAIN}}

Your domain is managed at **{{REGISTRAR}}**.

- **GoDaddy:** My Products → next to {{ROOT_DOMAIN}} click **DNS** → **Add New Record**.
- **Cloudflare:** select {{ROOT_DOMAIN}} → **DNS** → **Records** → **Add record**. Set *Proxy status* to
  **DNS only** (grey cloud) for the records below.
- **Namecheap:** Domain List → **Manage** → **Advanced DNS** → **Add new record**.
- **Google / Squarespace Domains:** Domains → {{ROOT_DOMAIN}} → **DNS** → **Custom records** → **Manage**.
- Not sure where? Search your email for the receipt for {{ROOT_DOMAIN}}; the sender is your registrar.

Do not change or delete existing records.

## 2. Add these records

| # | Type | Name / Host | Value | TTL |
|---|---|---|---|---|
| 1 | TXT | `@` | `{{GOOGLE_SITE_VERIFICATION}}` | default |
| 2 | CNAME | `{{SUBDOMAIN}}` | `ghs.googlehosted.com.` | default |

- Record 1 proves to Google that you own the domain. Keep it after setup; deleting it disconnects the funnel.
- Some registrars want the full name (`{{FUNNEL_DOMAIN}}`) instead of `{{SUBDOMAIN}}`; both are fine.
- If the registrar does not accept the trailing dot in `ghs.googlehosted.com.`, leave it out.
<!-- Apex domain instead of a subdomain: replace row 2 with the four A and four AAAA records from
     `gcloud beta run domain-mappings describe`, Name `@`. -->

## 3. Tell us "done"

Reply "done" to {{CONTACT}}. Then we:
1. connect {{FUNNEL_DOMAIN}} to the funnel in Google Cloud;
2. wait for the security certificate (usually 15–60 minutes);
3. enable Apple Pay and Google Pay on the new address / submit it to {{PROVIDER}} for approval;
4. make a test payment on {{FUNNEL_DOMAIN}} and send you the result.

## 4. How to check it works

- Funnel: https://{{FUNNEL_DOMAIN}}/
- Paywall: https://{{FUNNEL_DOMAIN}}/?go=paywall

A certificate warning or "site can't be reached" during the first hours is normal. The temporary address keeps
working the whole time, so nothing breaks while you wait.

## Questions

**Will my main website change?** No. Only {{FUNNEL_DOMAIN}} points to the funnel.

**Do I need to change links in my ads?** Yes, after we confirm the funnel works on the new address. Until then
the temporary address keeps working.

**Do I need to verify the domain in Meta?** Only if {{ROOT_DOMAIN}} is not verified yet in Meta Business Settings
→ Brand Safety → Domains. Verifying the main domain covers the subdomain.

**Something does not match these steps?** Send us a screenshot of your DNS page and we will tell you exactly what
to click.
