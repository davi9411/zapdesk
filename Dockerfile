# Zapdesk: uma imagem para os dois processos (leitor e agente); o docker-compose escolhe o comando.
# Build sem transcrição (mais rápido/leve): docker build --build-arg WHISPER=0 .
FROM node:24-bookworm-slim

ARG WHISPER=1
ARG CLAUDE_CODE=latest

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv tini tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Transcrição sob demanda (tools/preparar.py) num venv próprio
RUN if [ "$WHISPER" = "1" ]; then \
      python3 -m venv /opt/whisper && /opt/whisper/bin/pip install --no-cache-dir faster-whisper; \
    else mkdir -p /opt/whisper/bin && ln -s /usr/bin/python3 /opt/whisper/bin/python; fi

# Claude Code: o agente chama "claude -p" (login da assinatura fica no volume do HOME)
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE}" && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY tools ./tools

RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    WA_DATA=/data \
    WA_PYTHON=/opt/whisper/bin/python \
    WA_CLAUDE=claude \
    TZ=America/Sao_Paulo

USER node
VOLUME /data
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--no-warnings", "src/listener.mjs"]
