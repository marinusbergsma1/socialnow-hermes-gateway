FROM node:22-alpine

RUN apk add --no-cache git openssh-client tini \
  && mkdir -p /app /data \
  && chown -R node:node /app /data

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src

USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.mjs"]

