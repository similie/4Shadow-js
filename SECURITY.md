# Security policy

## Reporting a problem

Please don't open a public issue for a security problem. Write to **sales@4shadow.io** with "Security" in the subject, or use GitHub's private **Report a vulnerability** form on this repository's Security tab where it is enabled.

Tell us what you found, how to reproduce it, and what someone could do with it. We'll confirm we have it within three working days, keep you posted while we fix it, and credit you when the fix is released unless you'd rather we didn't.

This covers the code in this repository: the SDK (`@similie/4shadow`) and the map lab. For a problem with the hosted API at api.4shadow.io or the site at 4shadow.io, write to the same address.

## Supported versions

Fixes go into the latest release of the SDK and the `main` branch of the map lab.

## What the code is built to protect

- **Your API key.** The map lab's server adds it to requests; it is never sent to the browser. In public mode (`MAP_MODE=public`) the server forwards only the read requests the map makes, with checked parameters and rate limits, and early warnings are off.
- **Webhook signatures.** `verifyWebhook()` checks each delivery's HMAC-SHA256 signature with Web Crypto and refuses deliveries more than five minutes old, so a captured one can't be replayed later.
- **The lab's local tools.** Run locally, everything but the webhook receiver answers only this machine, even through a tunnel.

A report that one of these doesn't hold is exactly what we want to hear.
