FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONUNBUFFERED=1 DATA_DIR=/data
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY consigna_api ./consigna_api
COPY seed ./seed
COPY wsgi.py .
RUN useradd -r -u 10001 app && mkdir /data && chown app /data
USER app
VOLUME /data
EXPOSE 8000
# One worker: the periodic source sync runs inside the process.
CMD ["gunicorn", "-w", "1", "--threads", "4", "-b", "0.0.0.0:8000", "wsgi:app"]
