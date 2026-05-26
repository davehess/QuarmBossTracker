# OpenDKP API Capture Playbook
# For Claude Chrome Extension — capture missing network requests from a logged-in OpenDKP session.

## Context

The Wolf Pack Quarm Bot has a working OpenDKP integration for raids, ticks, and roster sync,
but THREE endpoints are still unconfirmed and gated on direct cURL capture from a real
OpenDKP officer-account browser session. This document tells you exactly what to capture
and how to report it.

Repo: davehess/QuarmBossTracker
Implementation file: utils/opendkp.js
Consumer: commands/loot.js (auction creation block is commented out, line 202)

## What we already have

Working endpoints (do NOT need to capture):
  - GET  /clients/wolfpack/characters
  - PUT  /clients/wolfpack/characters
  - GET  /beta/raids
  - GET  /beta/raids/:id
  - PUT  /beta/raids
  - POST /beta/raids
  - Cognito USER_PASSWORD_AUTH at cognito-idp.us-east-2.amazonaws.com

Working auth pattern:
  - Reads: header "clientid" = base64 from OPENDKP_CLIENT_ID env var
  - Writes (legacy): header "CognitoInfo" = Cognito ID token
  - Writes (newer): header "Authorization: Bearer <Cognito ID token>"

## What we need to capture (3 endpoints + 1 confirmation)

### 1. Create auction — HIGHEST PRIORITY

Trigger in OpenDKP UI: log in as an officer, navigate to the Bidding Tool, create a new
auction by selecting a real item (use autocomplete to pick from the actual item database
— do NOT type a fake ItemId), set quantity, pick the active raid, click "Create" or
"Start Auction".

Capture from the DevTools Network panel:
  - Request URL (full)
  - Request method (almost certainly PUT)
  - All request headers (especially Authorization / CognitoInfo / clientid)
  - Full JSON request body — every field, do not redact ItemId / GameItemId / RaidId / PoolId
  - Full JSON response body

Failed attempt context: a test with `ItemId: 31337` (a fake number) returned HTTP 500.
The real flow must use a valid item from the OpenDKP catalog.

### 2. Submit bid

Trigger: with an active auction visible in the Bidding Tool, click "Bid" / enter a DKP
amount / select a character / submit.

Capture:
  - Request URL + method
  - All headers
  - Full JSON payload (character ID, auction ID, bid amount, etc.)
  - Full JSON response

### 3. End all auctions

Trigger: with one or more active auctions open, click the "End All" button (or whatever
the officer-facing button is that closes the current bidding round).

Capture:
  - Request URL + method
  - All headers
  - Full JSON payload (if any)
  - Full JSON response

### 4. List active auctions (low-priority confirmation)

Trigger: just load the Bidding Tool page with active auctions present, or refresh it.

Capture:
  - Confirm the GET URL the page hits for active auctions
  - Response shape (just a snippet showing the field names — Bids[], ItemId, etc.)
  - This may be `GET /clients/wolfpack/auctions` — we just need to confirm

## How to capture cleanly

1. Open DevTools (F12) BEFORE clicking the action button
2. Switch to the Network tab
3. Click "Preserve log" so navigation doesn't wipe entries
4. Click the action (create auction / bid / end all)
5. Find the matching XHR/fetch entry (usually .json or no extension, status 200)
6. Right-click the request → Copy → Copy as cURL (bash)
7. Repeat for response: right-click → Save as → save the response JSON

For each endpoint, deliver:

  Endpoint name: <create auction | submit bid | end all | list auctions>
  cURL command (copy as cURL):
    ```
    <paste here>
    ```
  Response JSON:
    ```
    <paste here>
    ```
  Any noteworthy observations (auth header style, content type, status code,
  whether body is array vs object, etc.)

## What you should NOT do

- Do not redact field values — even seemingly sensitive ones like character IDs are needed.
  Auth tokens CAN be redacted (e.g. replace the Cognito JWT with "REDACTED_TOKEN") — we
  already have a working auth flow and don't need to see the actual token string.
- Do not paraphrase the JSON; copy raw.
- Do not perform destructive actions (deleting raids, blanking ticks, etc.) — only the
  three captures listed above.
- Do not run multiple bid submissions; one successful bid is enough.

## Output format expected

A single message back with four blocks:

  ### 1. CREATE AUCTION
  cURL: ...
  Response: ...

  ### 2. SUBMIT BID
  cURL: ...
  Response: ...

  ### 3. END ALL AUCTIONS
  cURL: ...
  Response: ...

  ### 4. LIST ACTIVE AUCTIONS (confirmation)
  cURL: ...
  Response: ...

Once these are captured, utils/opendkp.js `createAuctions()` can be implemented and the
commented-out auction block in commands/loot.js can be re-enabled.
