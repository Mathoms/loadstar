FROM node:20-alpine
WORKDIR /app
COPY api/package.json ./api/
RUN cd api && npm install --omit=dev
COPY api ./api
COPY web ./web
EXPOSE 8080
CMD ["node", "api/src/server.js"]
