FROM node:20-alpine

# Jalankan sebagai user non-root
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY fake_server.js .

RUN mkdir -p /app/logs && chown -R app:app /app/logs

USER app
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=2 CMD wget -qO- http://127.0.0.1:8080/_health || exit 1

CMD ["node", "fake_server.js"]
