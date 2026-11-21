# syntax=docker/dockerfile:1

# ---------- Stage 1: build the static site ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite inlines this at BUILD time, so it must be a build arg.
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ---------- Stage 2: nginx serving the build ----------
FROM nginx:1.27-alpine AS runtime
# The official image runs envsubst on /etc/nginx/templates/*.template at start-up,
# so ${PORT} below is resolved from the container environment.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=3000
EXPOSE 3000
