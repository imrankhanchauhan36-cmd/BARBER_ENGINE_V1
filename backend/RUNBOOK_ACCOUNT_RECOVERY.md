# Admin Account Recovery — Manual Runbook

## Why this exists

This replaces two retired ad-hoc scripts (`reset_pass.mjs`, `reset_admin.mjs`) that
previously lived in this directory. They connected directly to whatever
`MONGODB_URI` happened to be configured and wrote a hardcoded password hash to a
hardcoded account identifier, with no target verification and no check of the
actual write result. They have been deleted. There is currently **no automated
replacement** — account recovery is a deliberate, manual procedure, performed by
a human, every time. Do not recreate a script that hardcodes an account
identifier or password material.

This document never names a real database, cluster, hostname, account email, or
any other identifier — those are looked up fresh, each time, in the systems
referenced below, by the person performing the recovery.

## Before you start

- You need your own individually-issued, approved recovery credentials, retrieved
  from the organization's secrets manager. Never reuse a credential embedded in a
  script or committed to any repository.
- You need read access to the MongoDB Atlas dashboard for the project this
  recovery concerns.
- You need the change/incident ticket authorizing this specific recovery.
- `mongosh` or MongoDB Compass, installed locally.

## Step 1 — Independently verify the Atlas target

Log into the Atlas dashboard yourself. Navigate to the specific project and
cluster named in the change ticket for this recovery. Confirm the cluster you are
looking at is the one the ticket actually describes — do not infer it from a
script, an `.env` file, or a value someone else reports in chat. If anything
about the ticket and what you see in Atlas doesn't line up, stop and escalate
before proceeding.

## Step 2 — Independently verify the account identity

Using Atlas's own Data Explorer (a read-only lookup), find the account **by its
current email address**, as stated in the ticket — never by a remembered or
previously-used internal ID. Confirm the account's role/admin-level and other
visible metadata match what the ticket describes. Do this *before* connecting
with any tool that can write.

**If the account's current email, role, admin-level metadata, or any other
identifying detail does not match the intended account, stop immediately and
escalate.** No database write may proceed until the identity discrepancy is
resolved and the account is independently re-verified from Step 2 onward.

## Step 3 — Connect with your own approved credentials

Open `mongosh` (or Compass) and connect using your own individually-issued
recovery credentials — never a shared, hardcoded, or script-embedded credential.

## Step 4 — Generate the new password hash interactively

Generate a fresh bcrypt hash of the new temporary password **interactively, in
your own terminal, at the time of the recovery** — never from a value stored in
a file, a script, or a chat message. Do not write the plaintext password or the
resulting hash to any file, log, ticket, or chat. Hand the temporary password to
the account owner through your organization's approved secure channel, not
through this procedure's own logging (Step 6).

## Step 5 — Apply the update, scoped to the verified account only

In `mongosh`, run a single, manually-typed update against the account you
verified in Step 2 — matched by its current email, not by a hardcoded ID — that
sets only:
- the new password hash, and
- a flag requiring the account to set its own real password at next login
  (e.g. a `mustChangePassword`-style field, if the application schema has one).

Do not touch any other field, and do not run this against more than one document.

> **Important — do not assume this flag alone fixes anything.** Setting a
> "must change password on next login" field only has effect if the
> application's own login/auth code actually reads and enforces that field, and
> if a working password-change (or forced-change) flow exists for the account to
> complete. **Do not assume either is true.** Before relying on this step,
> separately verify in the current backend source whether that field is checked
> at login and whether a real, working change-password path exists for this
> account type. If it is not enforced, or no such flow exists, the account owner
> will need an alternative, equally verified way to actually set their own
> password — do not consider the recovery complete just because this field was
> set.

## Step 6 — Verify the actual result before declaring success

Read `mongosh`'s own reported result for the update (matched/modified count).
If it shows that no document was matched or modified, **stop** — do not report
success. Re-verify Step 1 and Step 2; you may be connected to the wrong
database, or looking up the wrong account. Only proceed to Step 7 once the
result confirms exactly one document was matched and modified.

## Step 7 — Log the action safely

Record, in the team's incident/change log:
- timestamp,
- operator name,
- the ticket reference,
- the outcome ("account recovered" / "no match found, escalated"),
- the result counts from Step 6.

**Never record**: the password, the hash, any connection string, or the raw
account identifier. Reference the ticket number instead of repeating identifying
details.

## Step 8 — Close the loop

Notify the account owner through an approved channel to log in and set their own
permanent password. Confirm they were actually able to do so — see the warning
in Step 5. If no working self-service path exists for them to complete this,
that gap should be raised as its own follow-up item, separate from this
recovery.

## Explicitly out of scope for this runbook

- **Credential rotation for any account referenced by the retired scripts'
  historical hardcoded values.** That hardcoded material remains in this
  repository's Git history (and on its remote) even after the scripts'
  deletion. Rotating the real password for whatever account it referenced is a
  separate, necessary follow-up — not performed by, or a prerequisite of, this
  runbook.
- **Rewriting Git history** to remove the old hardcoded values from past
  commits. A separate, explicitly-authorized task, given the coordination cost
  (force-push, re-clones) involved.
- **Building a self-service password-change or forgot-password API.** This
  runbook is a manual stopgap, not a substitute for that feature; Step 5's
  warning exists precisely because that feature may not exist yet.
