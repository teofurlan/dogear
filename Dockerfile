# Night job image: Tesseract (Spanish) + Ollama with the Gemma weights baked in + dogear.
# It runs on a plain CPU; Render cron jobs have no GPU.
#
#   docker build -t dogear-night .
#   docker run --rm --memory 8g --cpus 4 dogear-night          # the baked sample page
#   docker run --rm --memory 8g --cpus 4 -v "$PWD/photos:/data" dogear-night night-job /data/page.jpg

ARG OLLAMA_VERSION=0.30.10
ARG MODEL=gemma4:e4b

FROM ollama/ollama:${OLLAMA_VERSION} AS ollama

FROM python:3.13-slim
ARG MODEL
ENV DOGEAR_MODEL=${MODEL} \
    OLLAMA_MODELS=/models \
    OLLAMA_FLASH_ATTENTION=0 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-spa ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama

# Bake the model into the image so each nightly run does not download several GB.
RUN ollama serve >/tmp/ollama.log 2>&1 & pid=$!; \
    for i in $(seq 1 30); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1; done; \
    ollama pull "${MODEL}" && kill "$pid"

COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev && rm -rf /root/.cache/uv

# A synthetic photo of a highlighted Don Quijote page (public domain), so a cron run can
# be smoke-tested before photos come from the API: `night-job /app/sample/page.jpg`.
COPY docker/sample-page.jpg /app/sample/page.jpg
COPY docker/memory-sampler.sh /usr/local/bin/memory-sampler
COPY docker/night-job.sh /usr/local/bin/night-job
RUN chmod +x /usr/local/bin/memory-sampler /usr/local/bin/night-job
# CMD, not ENTRYPOINT: a Render cron job with no Docker Command runs exactly this.
CMD ["night-job", "/app/sample/page.jpg"]
