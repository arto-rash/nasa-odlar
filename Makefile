# ODLAR — common tasks
.PHONY: setup pipeline pipeline-quick refresh serve-ml serve-api web test test-ml test-api test-web e2e deploy deploy-artifacts

setup:            ## install everything
	cd ml && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt && .venv/bin/pip install -e .
	cd api && composer install && cp -n .env.example .env && php artisan key:generate
	cd web && pnpm install

pipeline:         ## full build: ingest → harmonize → validate → calendar → models → store (~8 min)
	cd ml && .venv/bin/python -m odlar.pipeline

pipeline-quick:   ## small bootstrap, for CI (~2 min)
	cd ml && .venv/bin/python -m odlar.pipeline --quick

pipeline-firms:   ## real NASA FIRMS archive (needs FIRMS_MAP_KEY)
	cd ml && .venv/bin/python -m odlar.pipeline --source firms

refresh:          ## move the local store forward to yesterday (needs FIRMS_MAP_KEY; no refit)
	cd ml && .venv/bin/python -m odlar.refresh

serve-ml:
	cd ml && .venv/bin/uvicorn odlar.api.main:app --port 8001 --reload --reload-dir odlar

serve-api:
	cd api && php artisan serve --port 8000

web:
	cd web && pnpm dev

test: test-ml test-api test-web

test-ml:
	cd ml && .venv/bin/ruff check odlar tests && .venv/bin/python -m pytest

test-api:
	cd api && ./vendor/bin/pint --test && php artisan test

test-web:
	cd web && pnpm lint && pnpm typecheck && pnpm test

e2e:
	cd web && pnpm e2e

deploy:           ## backend → Hetzner box (frontend deploys via Vercel)
	./deploy/deploy.sh

deploy-artifacts: ## refreshed store/models only
	ARTIFACTS_ONLY=1 ./deploy/deploy.sh
