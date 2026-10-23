# Same-version release replacement

Use this only after the user or repository owner explicitly authorizes the
specific reason and scope. The normal release publisher still refuses public
replacement. New versions remain the default release procedure.

## Preconditions

- Merge the changes and this flow through PRs with `frontend` and `macos` passed.
- Keep the original annotated tag and its protected ref unchanged.
- Confirm the existing release is public, stable, and explicitly mutable.
- Record its numeric release ID, tag-object SHA, canonical DMG SHA256, and the
  SHA256 of the checksum file itself. Independently download and verify them.
- Record the exact current `main` SHA. Both required GitHub Actions checks must
  have passed for that SHA, including the checks triggered by the main push.
- Review the replacement reason and scope before production approval.

The replacement build keeps the four version manifests at the existing version.
Its new source SHA is separate from the original tag commit and must be visible
in release notes and the permanent audit. Version-only update detection cannot
detect a same-version replacement; existing users need a manual download.

## Dispatch and production approval

Run `publish.yml` from branch `main` using `workflow_dispatch` with:

| Input | Meaning |
| --- | --- |
| `tag` | Existing stable version, for example `v1.2.0` |
| `replace_published` | Explicitly `true` |
| `source_sha` | Exact reviewed current main SHA to build |
| `expected_tag_oid` | Original annotated tag object's full SHA |
| `expected_release_id` | Original numeric public release ID |
| `expected_dmg_sha256` | Original canonical DMG digest |
| `expected_checksum_sha256` | Original checksum-file digest |
| `reason` | Specific authorized changes and replacement reason |

The read-only validation job rejects stale source, missing required checks,
tag drift, changed canonical assets, and immutable releases before production
credentials are available. Confirm all inputs and the source SHA, then complete
the existing `production-release` approval. Do not weaken the environment or
tag ruleset. The tag-level concurrency lock covers publication and recovery.

The build reuses the complete normal universal App/helper Developer ID signing,
Notary `Accepted`, stapling, and Gatekeeper chain. Failure before publication
cannot change the public canonical download assets.

## Backup, switching, and audit

The replacement publisher verifies the exact local DMG/checksum pair and
downloads the old canonical assets by ID. It checks their actual bytes against
the authorized digests and the original checksum contents.

Before renaming old assets, it publishes and independently downloads a uniquely
named permanent backup archive containing old assets, release metadata, and
initial transaction intent. It also records a local recovery journal before
each mutation. The workflow preserves that journal as a 90-day recovery artifact;
the public backup and audit assets do not depend on artifact retention.

New assets first use unique revision names and are downloaded for digest
verification. Old assets are renamed to unique backup names, preserving their
bytes and IDs, before new assets take the canonical names. Notes and permanent
audit identify the original tag commit, new build commit, old/new hashes,
workflow run, notarization submission, reason, and transaction identity.

GitHub does not offer atomic switching of multiple assets. A short switching
window may expose temporarily missing names or a mismatched pair. Verify the
checksum after download and only declare readiness after the independent
post-publication acceptance below. No script may delete old public assets or
move the tag to hide this distinction.

On API errors, re-read known asset IDs and digests before deciding whether the
mutation failed or its response was lost. Rollback restores only transaction
assets and prior notes. Unexpected assets or third-party changes cause an
explicit failure; they are not removed.

## Interrupted-run recovery

Do not rerun a failed publication blindly. Inspect the archived recovery journal,
permanent backup, canonical names, and release notes first. A matching local
journal can validate a completed result or restore an incomplete transaction.

For recovery in Actions, dispatch `publish.yml` from `main` with the same original
request inputs and set `recovery_run_id` to the interrupted publication run.
The restore job uses the reviewed current main recovery code and checks that
the original source remains in main history with successful checks. The original
source SHA/reason determine the original transaction identity even if main has
advanced. Only a completed `main` publish run in this repository can supply its
exact run-attempt recovery artifact.

If that run was retried, set `recovery_run_attempt` to the attempt that actually
entered replacement; leaving it empty selects the latest attempt. A later
validation failure does not erase an earlier attempt's recovery journal.

The recovery job requires the same production approval. It does not build or
publish another image. Before restoring names and notes it verifies the journal
identity, original asset IDs and byte digests, and permanent backup digest.
If the journal is unavailable, identities conflict, or the release has become
immutable, stop and investigate. Preserve all old bytes and diagnostic records.

## Independent download acceptance

After a successful replacement, perform every download, SHA256, stapler,
Gatekeeper, App/helper signature, Team ID, universal architecture, and version
check from [RELEASE_PROCESS.md](RELEASE_PROCESS.md#10-发布后独立验收).

Additionally verify:

- The canonical asset IDs/digests are the new ones in the permanent audit.
- Backup assets and the backup archive remain downloadable and match old hashes.
- The original tag-object SHA and peeled commit are unchanged.
- Notes and audit refer to the exact newly built `source_sha`, not the old tag.
- The audit records the accepted notarization submission and workflow run.

Record the canonical DMG SHA256, source SHA, original tag SHA, new and old asset
IDs, backup/audit links, and acceptance conclusions before reporting download
readiness. A successful workflow alone does not finish acceptance.
