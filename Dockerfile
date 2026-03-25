FROM node:22-bookworm-slim

# Python + pip for Scrapling
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv git && \
    rm -rf /var/lib/apt/lists/*

# Install Scrapling
RUN pip3 install --break-system-packages scrapling

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy project
COPY . .

# The wizard writes config to ~/.config/inloop — mount or set env vars at runtime
# INLOOP_APP_PASSWORD must be passed as env var

CMD ["npx", "tsx", "src/daemon.ts"]
