import os
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

def setup_telemetry(app):
    """
    Configures OpenTelemetry for the FastAPI application.
    Exports traces to an OTLP endpoint (default: localhost:4317).
    """
    # Check if telemetry is enabled via env var (default to true if OTLP_ENDPOINT is set)
    otlp_endpoint = os.getenv("OTLP_ENDPOINT", "http://jaeger:4317")
    service_name = os.getenv("OTEL_SERVICE_NAME", "polygon-agent")

    resource = Resource.create({
        "service.name": service_name,
        "deployment.environment": os.getenv("ENV", "development"),
    })

    provider = TracerProvider(resource=resource)
    
    # Configure OTLP Exporter
    # We use the GRPC exporter by default as it's standard for OTLP
    exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
    
    # Use BatchSpanProcessor for production suitability
    processor = BatchSpanProcessor(exporter)
    provider.add_span_processor(processor)

    # Set as global tracer provider
    trace.set_tracer_provider(provider)

    # Instrument FastAPI
    # excluded_urls filters out health checks from cluttering traces
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider, excluded_urls="/health,/docs,/openapi.json")

    print(f"[OTel] Instrumentation enabled. Exporting to {otlp_endpoint}")
