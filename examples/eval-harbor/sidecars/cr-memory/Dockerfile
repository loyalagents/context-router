FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir fastmcp

COPY server.py .

RUN mkdir -p /data

EXPOSE 8000

CMD ["python", "server.py"]
