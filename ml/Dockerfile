# ODLAR analytics service (FastAPI). Serves a pre-built store; the heavy pipeline
# runs elsewhere and ships artifacts into /app/artifacts (a mounted volume; not in the image).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    ODLAR_ARTIFACTS_DIR=/app/artifacts
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY pyproject.toml .
COPY odlar ./odlar
COPY data/boundaries ./data/boundaries
# batch catalogue; world boundaries are not shipped (the refresh reads each batch's state)
COPY data/world.json ./data/world.json
RUN pip install --no-deps -e . && useradd -r -u 10001 odlar && chown -R odlar /app
USER odlar
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fsS http://127.0.0.1:8001/health || exit 1
CMD ["uvicorn", "odlar.api.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--proxy-headers"]
