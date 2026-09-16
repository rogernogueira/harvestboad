# --- build do SPA -----------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_API_BASE fica sem valor de propósito: o padrão do api.ts é /api/v1, um
# caminho relativo que o nginx resolve na mesma origem. Sem origem cruzada, sem
# CORS.
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html

# A configuração vem montada do host (docker/nginx/default.conf), para que um
# ajuste de proxy não exija reconstruir a imagem.
EXPOSE 80
