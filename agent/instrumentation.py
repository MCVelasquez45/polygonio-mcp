import os
import socket
from urllib.parse import urlparse
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

def is_port_open(url: str) -> bool:
    """Check if the OTLP port is actually listening."""
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "localhost"
        port = parsed.port or 4317
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except (ConnectionRefusedError, socket.timeout, socket.gaierror):
        return False
    except Exception:
        return False

def setup_telemetry(app):
    """
    Configures OpenTelemetry for the FastAPI application.
    Exports traces to an OTLP endpoint.
    """
    # Environment variables
    otlp_endpoint = os.getenv("OTLP_ENDPOINT", "http://localhost:4317")
    service_name = os.getenv("OTEL_SERVICE_NAME", "polygon-agent")
    
    # Allow disabling telemetry via environment variable
    enabled = os.getenv("ENABLE_TELEMETRY", "true").lower() == "true"
    
    if not enabled:
        print("[OTel] Instrumentation disabled via ENABLE_TELEMETRY.")
        return

    # Check if we are running in Docker or Local
    if "jaeger" in otlp_endpoint and not os.path.exists("/.dockerenv"):
        otlp_endpoint = otlp_endpoint.replace("jaeger", "localhost")

    try:
        resource = Resource.create({
            "service.name": service_name,
            "deployment.environment": os.getenv("ENV", "development"),
        })

        provider = TracerProvider(resource=resource)
        
        # PROACTIVE CHECK: Only add the exporter if the port is open.
        # This prevents background retry logs from flooding the console.
        if is_port_open(otlp_endpoint):
            exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
            processor = BatchSpanProcessor(exporter)
            provider.add_span_processor(processor)
            print(f"[OTel] Connected to {otlp_endpoint}. Tracing enabled.")
        else:
            print(f"[OTel] Endpoint {otlp_endpoint} unreachable. Tracing disabled to avoid console noise.")

        # Set as global tracer provider
        trace.set_tracer_provider(provider)

        # Instrument FastAPI
        FastAPIInstrumentor.instrument_app(app, tracer_provider=provider, excluded_urls="/health,/docs,/openapi.json")
    except Exception as e:
        print(f"[OTel] Failed to initialize telemetry setup: {e}. Continuing without instrumentation.")
