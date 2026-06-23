FROM python:3.12-slim

WORKDIR /workspace

COPY sdks/python /workspace/sdks/python
COPY examples/fastapi-governed-crud /workspace/example

WORKDIR /workspace/example
ENV PYTHONPATH=/workspace/sdks/python/src:/workspace/example

RUN pip install --no-cache-dir -e .

EXPOSE 8010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
