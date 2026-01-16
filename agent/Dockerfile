FROM python:3.11-slim

WORKDIR /app

# Copy project definition
COPY pyproject.toml .

# Copy source code
# We copy everything so the local packages (core, cli) are present
COPY . .

# Install dependencies
# We install directly from . to respect pyproject.toml
RUN pip install --no-cache-dir .

# Expose port
EXPOSE 5001

# Run FastAPI for Agent
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "5001", "--reload"]
