# Chewgether backend — Fly.io production image (#320)
# Multi-stage: build TypeScript with dev deps, ship only prod deps + dist.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Run as the non-root user the node image provides
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
