# TicketScan — fully static client-side app served by a tiny Python server.
FROM python:3.12-slim

# No Python dependencies are needed (server.py is stdlib-only).
WORKDIR /app

# Only the server and the static web root are needed at runtime.
COPY server.py /app/server.py
COPY public /app/public

EXPOSE 8000

# Basic healthcheck: the index page must be reachable (honors $PORT).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import os,urllib.request,sys; p=os.environ.get('PORT','8000'); sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{p}/index.html').status==200 else 1)"

# No --port: the server reads $PORT (set by Render/Heroku/etc.) or falls back to 8000.
CMD ["python", "server.py", "--host", "0.0.0.0", "--dir", "/app/public"]
