-- Seed the two target addresses. Jun fills in real lat/lng after Kiyong
-- supplies the addresses from the Develo reference reports.

insert into addresses (address_text, lat, lng, lot_plan) values
  ('Property A — clean baseline (TBD, Brisbane LGA)', -27.47, 153.02, null),
  ('Property B — 2022 flood case (TBD, Brisbane LGA)', -27.47, 153.02, null);
