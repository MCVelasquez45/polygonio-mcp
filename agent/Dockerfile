FROM python:3.11-slim

WORKDIR /app

# Copy project definition
COPY pyproject.toml .

# Copy source code
# We copy everything so the local packages (core, cli) are present
COPY . .

# Install git for pip dependencies
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install MCP Server for Polygon
RUN pip install "git+https://github.com/polygon-io/mcp_polygon@v0.4.0"

# Install dependencies
# We install directly from . to respect pyproject.toml
RUN pip install --no-cache-dir .

# Expose port
EXPOSE 5001

# Run FastAPI for Agent
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "5001", "--reload"]
