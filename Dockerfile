FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000 \
    DATABASE_PATH=/var/data/morning.db

WORKDIR /app
COPY server.py index.html app.js styles.css manifest.json sw.js ./
COPY icons ./icons
EXPOSE 10000
CMD ["python", "server.py"]
