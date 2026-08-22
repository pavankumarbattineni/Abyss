"""Middleware configuration and setup for the Abyss backend.

This module centralizes all middleware configuration including:
- Global exception handler middleware
- CORS middleware
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from middleware.error_handler import GlobalErrorHandlerMiddleware


def setup_middleware(app: FastAPI):
    """Configure all middleware for the FastAPI application.

    This function sets up:
    - Global exception handler middleware for consistent error responses
    - CORS middleware for cross-origin requests

    Args:
        app: The FastAPI application instance.
    """
    # Add global exception handler middleware
    app.add_middleware(GlobalErrorHandlerMiddleware)

    # Configure CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "*",
        ],
        allow_credentials=True,
        allow_methods=[
            "*",
        ],
        allow_headers=[
            "*",
        ],
    )
