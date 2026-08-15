.PHONY: dev refresh

# One command: ingest once if the data directory is empty, then start Vite
# on port 8888. Uses `uv run` throughout so it resolves the right venv
# regardless of OS (no hardcoded .venv/bin vs .venv/Scripts path).
dev:
	@if [ ! -f web/public/data/seasons.json ]; then \
		echo "No data yet — running the ingest once..."; \
		cd ingest && uv sync && uv run python build.py; \
	fi
	cd web && pnpm install && pnpm dev

# Re-pull data without restarting Vite (Vite serves web/public/data live,
# so a refresh here is picked up on the next page load/reload).
refresh:
	cd ingest && uv run python build.py

# Note for Windows without `make` installed (this machine, as of writing):
# use the equivalent pnpm scripts instead — `pnpm run dev` / `pnpm run refresh`
# from web/, or see README.md.
