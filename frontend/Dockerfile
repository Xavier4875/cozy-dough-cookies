# Build stage — compiles the Vite/React app into static assets. Vite only
# exposes import.meta.env values that are actually used at build time, and
# only ones prefixed VITE_ (frontend/.env's VITE_COGNITO_* — the User Pool
# ID/Client ID/region, not secrets) ever end up in the shipped JS; anything
# else in that file is never bundled, so it's safe for this stage to read it
# directly rather than threading values through as build args.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# --legacy-peer-deps: @vitejs/plugin-react's declared peer range doesn't
# officially list vite@8.x yet, even though it works fine in practice —
# `npm install` resolves it locally without complaint, but `npm ci`'s
# stricter check treats it as fatal. Scoped to this build only; doesn't
# touch package.json/package-lock.json.
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# Serve stage — nginx serving the built static files. No Vite dev server
# here to proxy /api the way vite.config.js does locally, so nginx.conf
# does the same job: forwards /api/* to the backend service (Docker
# Compose's internal DNS resolves "backend" to that container).
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
