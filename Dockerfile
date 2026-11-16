# syntax=docker/dockerfile:1.7

FROM node:25-alpine3.22 AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./

RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate

COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

RUN npm ci --omit=dev

# Regenera o Prisma Client na árvore enxuta (npm ci recria node_modules do zero).
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate

FROM node:25-alpine3.22 AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 oficina && adduser -D -u 1001 -G oficina oficina

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY contratos ./contratos
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY tsconfig*.json ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh
RUN chown -R oficina:oficina /app

USER oficina

EXPOSE 3000
CMD ["sh", "./docker-entrypoint.sh"]
