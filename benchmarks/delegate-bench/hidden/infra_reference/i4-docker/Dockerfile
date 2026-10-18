FROM python:3.12 AS build
RUN python -m venv /opt/venv
COPY app/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

FROM python:3.12-slim
RUN useradd --system --no-create-home app
COPY --from=build /opt/venv /opt/venv
COPY app/shop /app/shop
WORKDIR /app
ENV PATH=/opt/venv/bin:$PATH
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/healthz', timeout=2)"]
CMD ["python", "-m", "shop.server"]
