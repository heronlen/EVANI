For use with the EVANI tarrif calculator
At www.evani.uk
Data from Consumer Council NI

Created by downloading https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/economy-7
and https://www.consumercouncil.org.uk/consumers/help-consumers/electricity-oil-and-gas/switching-electricity-or-gas-supplier/electricity-price-comparison-table
(pdf versions)

Tariff data is maintained to mirror the Consumer Council NI Electricity Price Comparison and Economy 7 tables. Tariffs no longer listed by the Consumer Council are removed and newly listed tariffs are added at each refresh.

Created by Steven Law

---

## Public charging (NI charge point operators)

`EVANIPublicChargingTable.html` is a live table of what the charge point operators
with a presence in Northern Ireland charge per kWh, backed by `public_charging_ni.json`.

Unlike the home tariff data there is no single source for this. `PUBLIC-CHARGING-DATA.md`
sets out the position: the Public Charge Point Regulations 2023 extend to Northern Ireland
and oblige operators to publish price data free of charge in OCPI format, but in practice
coverage is patchy, so the table is a hybrid of live feeds and hand-checked rates.

Every price carries a source, a date and a confidence flag, so it is always clear which
is which.

- `tools/refresh_public_charging.mjs` — pulls prices from any operator OCPI feed on file
- `.github/workflows/refresh-public-charging.yml` — runs the above daily and commits changes
