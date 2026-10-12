# MIRAGE-NODE GATEWAY IMAGE (Cloud Run / GCE)
FROM node:20-alpine

WORKDIR /app

# Dependensi dulu agar layer ter-cache
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Kode aplikasi
COPY src ./src

# v5.1: dua direktori ini sebelumnya TERLUPA di-copy -> dashboard 500 di image
# dan Architect tak bisa build decoy saat berjalan di host ber-Docker (GCE/VM).
# (.dockerignore tetap memblokir tests/, devpost_*.html, dan semua rahasia.)
COPY public ./public
COPY honeypot ./honeypot

# Cloud Run menyuntikkan PORT; gateway membaca process.env.PORT
ENV NODE_ENV=production
CMD ["node", "src/gateway/gateway.js"]
