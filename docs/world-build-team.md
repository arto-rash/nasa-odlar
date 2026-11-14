# Building the world, together

ODLAR is being extended from the pilot (South Caucasus, Turkey, Iran) to every
country: 191 more countries in 45 batches (`ml/data/world.json`). Each batch is
built on a laptop, then uploaded to the server, where it goes live on
odlar.vercel.app by itself. Builds take hours of computing, so we split the
batches between four machines.

**The rules**

- Build only the batches of your group (below). One build at a time per machine.
- Do **not** deploy and do not run `deploy/deploy.sh`. Ərtoğrul uploads every batch.
- Never commit keys or `.env` files. Your FIRMS key stays in your shell.
- Code changes go through pull requests to `master`. Built data does not go
  into git (it is ignored); you hand it over as described in step 6.

## 1. What you need

- macOS or Linux, **16 GB RAM**, ~40 GB free disk, a steady connection.
- Python 3.12 or newer, git.
- A free NASA FIRMS key: https://firms.modaps.eosdis.nasa.gov/api/map_key/
  (each person needs their own; limits are per key).
- The laptop must stay on, awake and plugged in while building.
  On macOS: `sudo pmset -a disablesleep 1` (undo with `0` when done), and don't
  put it in a bag while it works.

## 2. Set up

```bash
git clone https://github.com/arto-rash/odlar.git
cd odlar/ml
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/pip install -e .
.venv/bin/python -m pytest -q        # should pass
export FIRMS_MAP_KEY=your_key_here   # every new terminal
```

## 3. Your batches

Copy your group's line into a variable, e.g.

```bash
export MY_BATCHES="democratic_republic_of_the_congo,south_sudan,..."
```

### Group B

`democratic_republic_of_the_congo,south_sudan,south_eastern_asia_1,western_africa_3,central_america_1,middle_africa,south_america_3,congo_brazzaville,caribbean,northern_europe`

Countries: Antigua and Barbuda, Bahamas, Barbados, Belize, Brunei, Cameroon, Chad, Colombia, Congo-Brazzaville, Costa Rica, Cuba, Democratic Republic of the Congo, Denmark, Dominica, Dominican Republic, East Timor, El Salvador, Equatorial Guinea, Estonia, Finland, Gabon, Ghana, Grenada, Guatemala, Guyana, Haiti, Iceland, Ireland, Jamaica, Laos, Latvia, Lithuania, Mali, Mexico, Myanmar, Norway, Panama, Peru, Saint Kitts and Nevis, Saint Lucia, Saint Vincent and the Grenadines, Senegal, Singapore, South Sudan, Sweden, São Tomé and Príncipe, Trinidad and Tobago, United Kingdom.

### Group C

`angola,zambia,central_african_republic,western_africa_2,south_america_1,south_eastern_asia_2,northern_africa,ethiopia,southern_europe,western_europe`

Countries: Albania, Algeria, Andorra, Angola, Austria, Belgium, Benin, Bosnia and Herzegovina, Cambodia, Central African Republic, Croatia, Ecuador, Egypt, Ethiopia, France, Germany, Greece, Guinea, Indonesia, Italy, Ivory Coast, Libya, Liechtenstein, Luxembourg, Malaysia, Malta, Mauritania, Monaco, Montenegro, Morocco, Netherlands, North Macedonia, Philippines, Portugal, San Marino, Serbia, Slovenia, Spain, Sudan, Suriname, Switzerland, Thailand, Tunisia, Uruguay, Venezuela, Vietnam, Zambia.

### Group D

`russia,bolivia,mozambique,china,western_africa_1,eastern_africa_1,southern_asia,western_africa_4,central_america_2,central_asia,melanesia`

Countries: Afghanistan, Bangladesh, Bhutan, Bolivia, Burkina Faso, Burundi, Cape Verde, China, Comoros, Djibouti, Eritrea, Fiji, Guinea-Bissau, Honduras, India, Kazakhstan, Kenya, Kyrgyzstan, Liberia, Maldives, Mauritius, Mozambique, Nepal, Nicaragua, Niger, Nigeria, Pakistan, Papua New Guinea, Russia, Rwanda, Seychelles, Sierra Leone, Solomon Islands, Somalia, Sri Lanka, Tajikistan, Tanzania, The Gambia, Togo, Turkmenistan, Uganda, Uzbekistan, Vanuatu.

### Group A (Ərtoğrul, also uploads everything)

`brazil,canada,united_states,south_america_2,eastern_africa_2,southern_africa,western_asia,eastern_europe,eastern_asia,new_zealand`

Countries: Argentina, Bahrain, Belarus, Botswana, Brazil, Bulgaria, Canada, Chile, Cyprus, Czechia, Eswatini, Hungary, Iraq, Israel, Japan, Jordan, Kuwait, Lebanon, Lesotho, Madagascar, Malawi, Moldova, Mongolia, Namibia, New Zealand, North Korea, Oman, Paraguay, Poland, Qatar, Romania, Saudi Arabia, Slovakia, South Africa, South Korea, Syria, Taiwan, Ukraine, United Arab Emirates, United States, Yemen, Zimbabwe.


## 4. Province borders (about 1-3 hours, network-bound)

Two workers in parallel, in two terminals:

```bash
.venv/bin/python -u -m odlar.grid.osm_boundaries --world --batches "$MY_BATCHES" --shard 0/2
.venv/bin/python -u -m odlar.grid.osm_boundaries --world --batches "$MY_BATCHES" --shard 1/2
```

Files land in `ml/data/boundaries/world/`. Safe to stop and restart: finished
countries are skipped, downloads are cached. Each line reports the source
(`osm level N` or `geoboundaries`).

## 5. Build (about 5 hours of computing; starts as soon as borders are ready)

In a third terminal, at the same time as the borders:

```bash
caffeinate -dimsu .venv/bin/python -u -m odlar.world_build --only "$MY_BATCHES" --no-ship
# Linux: drop "caffeinate -dimsu"
```

It builds your batches one by one as their borders arrive. Progress:
`ml/data/world_build.log`, per batch `ml/data/world_logs/<batch>.log`, summary
`ml/data/world_status.json`. Restarting is safe: built batches are skipped.

Heavy countries (Congo, Russia, China, Brazil, ...) are ingested year by year
and can take 1-2 hours each. FIRMS sometimes makes the build wait 2 minutes
("transaction limit reached"); that is normal.

## 6. Hand a batch over (as each one finishes)

```bash
cd ml/artifacts
tar czf <batch>.tar.gz <batch>/
```

Upload the `.tar.gz` to our shared drive folder and post in the chat:
batch name, the "LOYO skill" and "CV harmonized" lines from its log.

Ərtoğrul then unpacks it into his `ml/artifacts/` and runs
`python -m odlar.world_build --only <batch> --ship-only`, which uploads it
and brings it live.

## 7. If something fails

The runner moves on to the next batch. Send the end of
`ml/data/world_logs/<batch>.log` to the chat. Common causes: a country with no
FIRMS files (tiny islands: skip), an Overpass timeout (just rerun step 4), the
laptop slept (rerun step 5).
