FROM python:3.12-slim

WORKDIR /app

COPY workspace/ /app/

RUN chmod +x /app/next_stage /app/submit_state /app/submit_service && mkdir -p /app/outputs/submissions
