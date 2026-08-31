"""Central config for the ingest pipeline.

League settings (team count, roster slots, scoring) are read from the ESPN
API at runtime — only identity and paths live here. Cookies are optional and
come from league-hub/.env so a private league works later without refactoring.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent  # league-hub/
load_dotenv(ROOT / ".env")

LEAGUE_ID = int(os.getenv("LEAGUE_ID", "29471"))
SEASON = int(os.getenv("SEASON", "2026"))

# Optional — only needed if the league ever goes private.
ESPN_S2 = os.getenv("ESPN_S2") or None
SWID = os.getenv("SWID") or None

# Optional — only needed for the FantasyPros weekly-projection column on
# the My Team roster (fp_projections.py). Free tier, 50 requests/day.
FANTASYPROS_API_KEY = os.getenv("FANTASYPROS_API_KEY") or None

CACHE_DIR = Path(__file__).resolve().parent / ".cache"
DATA_DIR = ROOT / "web" / "public" / "data"

# Be polite to ESPN.
MIN_SECONDS_BETWEEN_REQUESTS = 1.0

# League rule, not an ESPN setting: nothing after this scoring period counts.
# The championship is week 17; week 18 doesn't exist in ESPN's data for this
# league, so 17 is both the ESPN and league endpoint. Kept as a knob in case
# the format ever changes.
FINAL_COUNTED_WEEK = int(os.getenv("FINAL_WEEK", "17"))
