# Worker needs Java (JMeter), k6, and Node 20 (orchestration code).
FROM eclipse-temurin:17-jre-jammy
ENV JMETER_VERSION=5.6.3
# Node 20 via NodeSource — Ubuntu jammy's default nodejs is v12, far too old.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz \
    | tar -xz -C /opt \
 && ln -s /opt/apache-jmeter-${JMETER_VERSION}/bin/jmeter /usr/local/bin/jmeter
# k6 — the second load engine
ENV K6_VERSION=0.53.0
RUN curl -fsSL https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-amd64.tar.gz \
    | tar -xz -C /tmp \
 && mv /tmp/k6-v${K6_VERSION}-linux-amd64/k6 /usr/local/bin/k6
WORKDIR /app
COPY package.json ./
COPY api/package.json ./api/
RUN cd api && npm install --omit=dev \
 && ln -s /app/api/node_modules /app/node_modules
COPY api ./api
COPY worker ./worker
CMD ["node", "--max-old-space-size=768", "worker/worker.js"]
