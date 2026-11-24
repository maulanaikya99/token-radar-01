<p align="center">
  <a href="https://make.fun/c/token-radar-01">
    <img src="https://make.fun/badge/token-radar-01.svg" alt="make.fun token-radar-01" />
  </a>
  <a href="https://make.fun/c/token-radar-01">
    <img src="https://make.fun/badge/token-radar-01/maulanaikya99/token-radar-01/rank.svg" alt="rank" />
  </a>
  <a href="https://make.fun/c/token-radar-01">
    <img src="https://make.fun/badge/token-radar-01/maulanaikya99/token-radar-01/reward.svg" alt="reward" />
  </a>
</p>

# Token Radar

A radar over the 40 pre-token protocols on the `token-radar-01` watchlist: it reads the frozen
DefiLlama snapshot, prices a plausible implied token value for every protocol that has no token
yet, and turns each valuation into a concrete, costed farming plan — then renders it all as one
self-contained dashboard.

## The implied value formula

Every board row is a comparable-based estimate, not a promise of price:

```
implied = TVL x peer(category) x growth x maturity
```

- **TVL** is the protocol's locked value from the snapshot, in whole USD.
- **peer(category)** is the median `market-cap / TVL` multiple of live token-bearing protocols in
  the same category, winsorised to `0.02..4`, shrunk toward the all-live median with strength
  `k = 4`, and clamped to `0.05..2.5`. A protocol with no live peers falls back to the all-live
  median, so nothing is invented out of thin air.
- **growth** is `1 + clamp(change_7d, -40, 80) / 100 x 0.45`, so a protocol whose TVL is up this
  week scores above the flat line and one bleeding TVL scores below it.
- **maturity** is `0.75 + min(age_days, 1460) / 1460 x 0.25`, from `listed_at` (365 days when
  unknown): older, stickier protocols get the edge.

The dashboard shows this breakdown per row, including the peer table it was derived from, so the
model is transparent rather than a black box. The board holds the 40 watchlist protocols plus the
160 pre-token protocols below the floor with the most TVL, sorted by implied value, each with a
6-step farm plan carrying its own cost and time.

## Run it

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json
```

`main.ts` is Node 22, standard library only, no network: it writes `out/board.json`, `out/data.js`,
the `out/dashboard/` page and `out/dossier.json`, and copies the three screenshots in `screenshots/`.

Open `out/dashboard/index.html` in a browser to explore the board — search, category and chain
filters, pre-token vs live tabs, sortable columns and a per-protocol detail panel with the
valuation formula and farm steps.

## Layout

- `main.ts` — entrypoint: builds the board, the data file, the dashboard and the dossier.
- `lib/model.ts` — the comparable valuation model and the 200-row board builder.
- `lib/plans.ts` — the per-protocol farm playbook (venue, risk, setup, qualifying, watch).
- `vendor/makefun-board.ts` — the dossier builder, byte-identical to the scorer's.
- `dashboard/` — the single-page board.
- `screenshots/` — board, detail and filtered views.

## License

MIT — see [LICENSE](LICENSE).
