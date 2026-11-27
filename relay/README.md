# NOTAM relay

A small Cloudflare Worker that lets the planner show NOTAMs. The planner is a
static web page and no NOTAM source lets such a page read it directly, so this
sits in between: it logs in to **autorouter** (which imports NOTAMs from
Eurocontrol's EAD, the official European source), asks for the NOTAMs of the
aerodromes the planner names, and passes the answer back. It stores nothing;
every Fetch in the planner is a live request.

It is an unofficial copy, not a briefing. Check ippc.no before flight.

## One-time setup

1. **autorouter account** - create a free account at autorouter.aero with a
   password used nowhere else. Then **ask autorouter to enable API access** for
   the account through their support ticket function: their documentation
   requires this before the API can be used. Until they have, the relay's login
   is refused and the planner says so.
2. **Cloudflare account** - free. Note the **Account ID** on the dashboard, and
   create an **API token** from the "Edit Cloudflare Workers" template.
3. **Five repository secrets** (GitHub: Settings -> Secrets and variables ->
   Actions -> New repository secret):

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 2 |
   | `CLOUDFLARE_ACCOUNT_ID` | the account ID from step 2 |
   | `AUTOROUTER_USER` | the autorouter account's email |
   | `AUTOROUTER_PASS` | its password |
   | `NOTAM_RELAY_KEY` | any long random string |

4. **Deploy** - merging a change under `relay/` to `main` deploys it. To deploy
   by hand: GitHub -> Actions -> "Deploy NOTAM relay" -> Run workflow. The log
   ends with the relay's address, `https://c182-notam-relay.<something>.workers.dev`.
5. **Tell the planner** - Settings -> NOTAM relay: paste that address and the
   `NOTAM_RELAY_KEY` value. They are kept in that browser only, so do this once
   per device.

After that it needs nothing. It runs only when Fetch is pressed, renews its own
login, and redeploys itself when its code changes.

## When it needs you again

- **You change the autorouter password** - update `AUTOROUTER_PASS` and run the
  workflow.
- **You want a new relay key** - update `NOTAM_RELAY_KEY`, run the workflow,
  and paste the new key into the planner's Settings.
- **The planner is served from a new address** - add it to `ALLOWED_ORIGINS`
  in `wrangler.toml`.
- **autorouter changes or withdraws its API** - the planner's NOTAM card shows
  "Could not fetch NOTAMs" with the reason, and shows no list.

## What the planner shows when something is wrong

| Message | Meaning |
|---|---|
| `wrong or missing relay key` | the key in Settings is not `NOTAM_RELAY_KEY` |
| `autorouter: login refused (HTTP ...)` | wrong email/password, or API access not enabled yet |
| `autorouter: NOTAM request refused (HTTP ...)` | autorouter refused the query |
| `no answer in 30 s` / `network error` | the relay address is wrong, or it is not deployed |
| `The list is INCOMPLETE` | more NOTAMs exist than the relay returns in one go (a FIR) |

## Status

Built to autorouter's published API documentation
(https://www.autorouter.aero/wiki/api/) and tested against the shapes it
documents, including in a real browser across origins with a stand-in for
autorouter. **It had not been run against the live autorouter service when it
was written** - that needs the owner's account. The first real Fetch is the
real test; if autorouter's answer differs from its documentation, the planner
reports a failed fetch rather than a wrong list.
