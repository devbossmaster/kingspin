# Provably Fair Randomness

KingSpin commits to a fresh server seed before a round opens, commits to the
final entry ranges when the round locks, and reveals enough data after
completion for anyone to recompute the result.

## Ticket Model

Tickets are 0-based and cover the exact interval:

```text
0..totalEntryAmount-1
```

Entry ranges are contiguous and inclusive. An entry with amount `100` owns
exactly 100 tickets, for example `0..99`.

## Seed Commit And Reveal

Each round receives a fresh 32-byte server seed from
`crypto.randomBytes(32)`. Before entries open, the API stores and exposes:

```text
serverSeedHash = SHA256(serverSeed)
```

The server seed itself remains private in public and admin responses until the
round is completed. Completed result responses include the reveal so the hash
commitment can be checked.

## Final Entry Commitment

When the round locks and ticket ranges have been assigned, entries are sorted
by `ticketStart`, then `ticketEnd`, then `entryId`.

The canonical `KINGSPIN_ENTRIES_V1` JSON payload contains only:

```text
entryId
userId
amount
ticketStart
ticketEnd
roundId
```

BigInt values are encoded as base-10 strings. The commitment is:

```text
entriesHash = SHA256(canonicalEntryPayload)
```

Changing an entry, amount, owner, round, or ticket boundary changes the hash.

## Draw Algorithm

New rounds use:

```text
HMAC_SHA256_REJECTION_SAMPLING_V1
```

The server seed is the HMAC key. The canonical draw material contains the
algorithm version, round ID, round number, total entry amount, entries hash,
and nonce.

For nonce `0`, the backend computes:

```text
digest = HMAC_SHA256(serverSeed, canonicalDrawMaterial)
```

The digest is interpreted as an unsigned 256-bit integer. Values outside the
largest multiple of `totalEntryAmount` that fits in the SHA-256 value space
are rejected, the nonce is incremented, and HMAC is computed again. An
accepted value is mapped to:

```text
winningTicket = digest % totalEntryAmount
```

Because only the equal-sized accepted interval is reduced, this modulo
operation has no modulo bias. All arithmetic is BigInt and the result remains
in `0..totalEntryAmount-1`.

## Verify A Completed Result

The room's collapsible **Provably fair** panel can independently recompute the
completed result in the browser. A verifier should:

1. Confirm `SHA256(serverSeedReveal) === serverSeedHash`.
2. Rebuild the canonical entry payload and confirm `entriesHash`.
3. Recompute HMAC values from nonce `0` until one is accepted.
4. Confirm the stored draw hash, nonce, and winning ticket.
5. Confirm ticket ranges are contiguous and cover the total.
6. Confirm the winning ticket belongs to the recorded winner entry.

The latest-result API and admin round audit expose the same checks. Admin
responses also keep the seed hidden until completion.

## Trust Boundary

Winner selection runs only in the backend game engine. The frontend verifier
audits an already completed result and cannot submit or choose a winner.

`Math.random()` is not suitable for winner selection because it is not a
cryptographically secure random source. The draw path uses a committed
cryptographic seed, HMAC-SHA256, and deterministic rejection sampling.
