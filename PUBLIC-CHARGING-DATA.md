# Where the NI public charging prices come from

Short version: **there is no single API that gives you every NI charge point operator's
current price**. But there is a legal right to the data, a standard format it has to come
in, and a handful of commercial aggregators that have already done the joining-up. This
note records what we found, so the next person doesn't have to go looking again.

*Researched 10 September 2026.*

---

## 1. The legal position — this is the useful bit

The **Public Charge Point Regulations 2023** (SI 2023/1168) extend to England and Wales,
Scotland **and Northern Ireland**. So every public charge point in NI is in scope.

Two things in those regulations matter here:

- **Regulation 10 — open data.** A charge point operator must make *reference data* and
  *availability data* available to the public **free of charge, in a machine readable
  format, with no requirement to agree to terms and conditions**. Reference data is the
  static description of a charge point — location, connector types, payment methods and
  **price**. Availability data is whether it's free, in use or broken.
- **The format is OCPI.** The regulations point at the Open Charge Point Interface, and in
  practice **OCPI 2.2.1** is what operators implement. The duty bit from
  **24 November 2024**.

Enforcement sits with the **Office for Product Safety and Standards (OPSS)**.

**What this means for us:** if an operator with NI charge points won't give us a price
feed, they are very likely not compliant, and that's a conversation EVANI is well placed
to have — with the operator first, OPSS after.

### The catch

"Open data" has been interpreted generously by a lot of operators. Common patterns:

- The OCPI `versions` endpoint is public, but every data module behind it needs a
  **credentials token exchanged bilaterally** — which is roaming, not open data.
  Pod Point's CPO endpoint behaves this way.
- **Locations** are published but **Tariffs are not**. The Tariffs module is technically
  optional in OCPI, and locations only carry a `tariff_id` — a pointer to a price you
  can't then look up. This is the single most common gap.
- Prices are published **excluding VAT**, with a `vat` percentage alongside. Public
  charging is **20% VAT**, not the 5% on domestic supply, so the number in the feed is
  not the number on the pump. `tools/refresh_public_charging.mjs` applies the VAT.
- Tiered and time-of-day pricing (InstaVolt's 8pm–7am off-peak rate, for instance) comes
  through as multiple tariff elements with restrictions, so "the price" is a range rather
  than one figure.

Some operators do publish properly and document it — **GRIDSERVE** publish a
"PCPR API developer documentation" PDF, and **Go Zero** have a public charge point open
data page. Those are the model to point other operators at.

---

## 2. The operators with NI charge points

| Operator | NI presence | Feed status |
|---|---|---|
| **ESB ecars** | Major — the original NI network, plus Levelling Up Fund high power hubs | No public open data page found; prices published on their price plans page |
| **Weev** | Major — Belfast-based, the biggest home-grown NI network | No public open data page found; tariff page published in GBP for NI, EUR for ROI |
| **InstaVolt** | Present | No public open data page found (`ocpi.instavolt.co.uk` does not resolve) |
| **bp pulse** | Present | Not confirmed |
| **Tesla Supercharger** | Present — not every site is open to other makes | Runs OCPI for roaming partners; open endpoint not confirmed |
| **EasyGo** | Present — all-island | Not confirmed |
| **Applegreen Electric** | Present | Not confirmed |
| **Maxol** | Present | Not confirmed |
| **Circle K** | Present — 100 kW minimum, hubs to 400 kW | Not confirmed |
| **IONITY** | Limited | Not confirmed |

Also worth watching: council-led schemes, Translink sites, and the **Shared Island**
sports club EV charging scheme (up to €21.5m, Weev a delivery partner).

> Endpoint hostnames above were checked by name resolution only — this repo's build
> environment blocks outbound calls to operator domains, so nothing could be probed
> live. Before concluding an operator has no feed, **ask them directly for their PCPR
> open data endpoint.** That's a one-line email and it's the fastest route to a
> genuinely live table.

---

## 3. Aggregators — the shortcut if the feeds don't come

| Source | Covers price? | Terms |
|---|---|---|
| **Zapmap** | Yes | Commercial API. Also DfT's official open data provider — they aggregate all UK public chargepoints and supply DfT, but that's a government feed, not a free public one. Publishes a free UK charging price index. |
| **Chargeprice** | Yes — this is their whole business, tariffs modelled per CPO and per e-mobility provider | Free demo API key on request, data limited, **commercial use prohibited**. `sales@chargeprice.net` for a licence. |
| **Eco-Movement** | Yes | Commercial. Powers charging prices in Google Maps; also sells PCPR compliance services to CPOs. |
| **Open Charge Map** | Weakly — free-text, often stale | Free API, open licence. Good for locations, not for prices. |
| **National Chargepoint Registry (DfT)** | No prices | Free, but long neglected. |

For a volunteer-run site, **Chargeprice's demo tier is the obvious thing to try first**,
with the caveat that EVANI would need to check whether a free association site counts as
commercial use. Zapmap or Eco-Movement would want paying.

---

## 4. What this repo actually does

A hybrid, same shape as the home tariff data:

- **`public_charging_ni.json`** — one row per operator, with a `tariffs` array. Every
  price carries a `source_url`, a `verified_on` date and a `confidence` value:
  - `api` — came straight from an operator's open data feed
  - `verified` — read off the operator's own price page by hand
  - `reported` — from a comparison site or news report, treat as a guide
  - `needs_check` — no price confirmed yet
- **`tools/refresh_public_charging.mjs`** — for any operator with an
  `open_data.ocpi_versions_url` on file, walks versions → endpoints → tariffs, pulls the
  ENERGY price components, applies VAT, converts to pence, and writes them back marked
  `api`. Operators without a feed are untouched, so hand-checked rows survive every run.
  Private feeds needing a token can name an env var in `open_data.token_env`.
- **`.github/workflows/refresh-public-charging.yml`** — runs it daily and commits changes.
- **`EVANIPublicChargingTable.html`** — the live table. Filters by charger speed and
  payment method, sorts by price, shows cost per 100 miles for your car, badges each row
  with how much to trust it, and compares the cheapest public rate against the cheapest
  NI Economy 7 night rate from the home tariff data.

**As it stands the table runs almost entirely on `reported` and `needs_check` rows.**
It becomes a genuinely live table one operator at a time, as each feed URL is added.

### Adding an operator's feed

```jsonc
"open_data": {
  "status": "open",
  "ocpi_versions_url": "https://ocpi.example.co.uk/ocpi/cpo/versions",
  "auth_required": false,
  "token_env": null,
  "notes": "Confirmed by the operator, 2026-09-10"
}
```

Then `node tools/refresh_public_charging.mjs --only=<operator-id>` to test it.

---

## Sources

- [The Public Charge Point Regulations 2023 (SI 2023/1168)](https://www.legislation.gov.uk/uksi/2023/1168/made)
- [A Guide To Public Charge Point Regulations (PCPR) 2023 in the UK — Fuuse](https://fuuse.io/blog/public-charge-point-regulations)
- [UK's Public Charge Point Regulations 2023: What you need to know — Virta](https://www.virta.global/blog/uks-public-charging-point-regulations-what-you-need-to-know)
- [The Public Charge Point Regulations and other examples of open data and standards in UK legislation — Leigh Dodds](https://blog.ldodds.com/2023/07/13/the-public-charge-point-regulations-and-other-examples-of-open-data-and-standards-in-uk-legislation/)
- [OCPI 2.2.1 specification — EV Roaming Foundation](https://evroaming.org/wp-content/uploads/2024/11/OCPI-2.2.1-d2.pdf)
- [The Complete OCPI Guide (2026) — AMPECO](https://www.ampeco.com/guides/the-complete-ocpi-guide/)
- [GRIDSERVE PCPR API developer documentation](https://www.gridserve.com/wp-content/uploads/2024/11/GRIDSERVE-PCPR-API-Developer-Documentation.pdf)
- [Public Charge Point Open Data — Go Zero](https://gozerocharge.com/public-charge-point-open-data/)
- [Chargeprice API documentation](https://chargeprice.github.io/chargeprice-api-docs/)
- [Zapmap — Department for Transport data partnership](https://www.zapmap.com/for-business/work-with-us/government/department-for-transport)
- [DfT appoints Zapmap as chargepoint open data provider — Highways Magazine](https://www.highwaysmagazine.co.uk/DfT-appoints-Zapmap-as-chargepoint-open-data-provider/14834)
- [Eco-Movement CPO compliance services](https://www.eco-movement.com/services/compliance/)
- [UK Rapid EV Charging Prices 2026 — Zapmap](https://www.zapmap.com/ev-stats/rapid-charging-prices)
- [ESB ecars price plans](https://esb.ie/what-we-do/ecars/price-plans)
- [ESB eCars raises charging prices across Ireland and Northern Ireland — electrive](https://www.electrive.com/2026/07/01/esb-ecars-raises-charging-prices-across-ireland-and-northern-ireland/)
- [Weev tariffs](https://weev.ie/our-network/driver-resources/our-tariffs)
- [NI operators selected for €21.5m Shared Island sports club EV charging scheme — News Letter](https://www.newsletter.co.uk/business/northern-ireland-ev-charge-point-operators-selected-as-key-partner-for-eu215m-shared-island-sports-club-ev-charging-scheme-5249983)
