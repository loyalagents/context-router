FROM python:3.12-slim

WORKDIR /app

COPY server.py .

RUN mkdir -p /data

EXPOSE 8765

CMD ["python", "server.py"]
