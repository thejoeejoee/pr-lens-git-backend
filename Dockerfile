# syntax=docker/dockerfile:1

# Built rather than run from source, so the runtime image needs no TypeScript
# and no experimental flags.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts because `prepare` builds, and src is not here yet. The
# explicit build below is the one that counts.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts again: this stage has no TypeScript and needs no build, it
# only needs the production dependencies.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8787

# Liveness only: readiness would spend a GitLab API call every interval.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
