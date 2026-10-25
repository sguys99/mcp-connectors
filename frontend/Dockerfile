# Next.js 16 standalone 빌드. `next.config.ts` 의 `output: 'standalone'` 가 전제.
# 빌드 산출물의 `.next/standalone/server.js` 로 단일 노드 런타임 실행.
#
# 빌드 컨텍스트는 frontend/ 이고, 저장소 루트 configs/ (레지스트리 yaml, Chat 프롬프트) 는
# 이름 있는 추가 컨텍스트 `configs` 로 받습니다. docker compose 는 자동으로 넘기고,
# 직접 빌드할 때는 저장소 루트에서:
#   docker build --build-context configs=./configs -t mcp-connectors-frontend ./frontend

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build


FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# node 이미지에 있는 비root 사용자 `node` (uid 1000) 로 실행합니다.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# lib/config/paths.ts 가 <cwd>/configs 를 먼저 찾으므로 /app/configs 에 둡니다.
COPY --from=configs --chown=node:node . ./configs

USER node
EXPOSE 3000

# 레지스트리 API 가 200 이면 서버 기동과 configs/mcp_servers.yaml 읽기가 모두 정상입니다.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/registry').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
