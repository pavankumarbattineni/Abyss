#!/bin/sh

gunicorn main:app \
  -k uvicorn.workers.UvicornWorker \
  -w 1 \
  --bind 0.0.0.0:8000 \
  --timeout 120 \
  --keep-alive 5