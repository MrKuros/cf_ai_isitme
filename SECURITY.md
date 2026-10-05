# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/MrKuros/isitme/security/advisories/new) rather than a public issue. Expect a reply within a few days.

## What this app does with network requests

IsItMe fetches URLs that strangers supply, so request forgery is the risk that matters most. The guard in `src/lib/guard.ts` is the control:

- `http` and `https` only, ports 80, 443, 8080 and 8443 only.
- Private, loopback, link-local, carrier-NAT, multicast and cloud-metadata addresses are refused, in IPv4, IPv6, IPv4-mapped and encoded forms.
- Hostnames are resolved first and the resolved addresses are checked, so a name pointing at `127.0.0.1` is refused too.
- Every redirect hop is re-checked.
- The DNS step fails closed: no addresses, no probe.

Anything that bypasses those rules is a vulnerability, and `test/guard.test.ts` is where a fix should leave its proof.

## Other boundaries

- Page content is never shown to the model, so a hostile page cannot issue instructions through an explanation.
- Alert webhook URLs are re-validated through the same guard before every send.
- Visitor-supplied check data is validated and size-capped before storage.
- Rate limits apply per visitor and per IP across chat, the API and the share links.

## Running your own copy

Keep `.dev.vars` and any API token out of version control. The optional Radar token only needs **Account → Radar → Read**; the deploy token only needs **Workers Scripts → Edit**.
