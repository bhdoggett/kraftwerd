# Two stages: build the SPA with node, serve the static output with nginx.
#
# Coolify's Static build pack is not usable here -- it serves files already
# committed to the repo and runs no build, and dist/ is gitignored. Nixpacks
# can build, but SPA fallback then depends on Coolify's own toggles. A
# Dockerfile pins both the build and the routing behaviour.

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at BUILD time, so these must be build args, not runtime
# env vars. In Coolify, mark them "Build Variable" or they will be empty and
# the app will load with no backend URL.
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
