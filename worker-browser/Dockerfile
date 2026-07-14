# Microsoft's Playwright image ships Node 20 + Chromium/Firefox/WebKit preinstalled.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy
WORKDIR /app
COPY package.json ./
COPY api/package.json ./api/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN cd api && npm install --omit=dev && npm install playwright@1.47.0 --omit=dev \
 && ln -s /app/api/node_modules /app/node_modules
COPY api ./api
COPY worker-browser ./worker-browser
CMD ["node", "worker-browser/browserWorker.js"]
