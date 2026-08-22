"""Global exception handler middleware for the Abyss backend.

This middleware catches all unhandled exceptions and returns a consistent
error response structure while logging complete exception tracebacks.
"""
import logging

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette import status

from schemas.oauth import ErrorResponse

logger = logging.getLogger(__name__)


class GlobalErrorHandlerMiddleware(BaseHTTPMiddleware):
    """Middleware to handle all unhandled exceptions globally.

    This middleware intercepts all requests and catches any unhandled exceptions.
    All branches return a JSONResponse directly — never re-raise — because
    BaseHTTPMiddleware converts any exception raised from dispatch() into a 500.
    HTTPExceptions are returned with their original status code and detail.
    ValueErrors are returned as 422 with the error message.
    All other exceptions are logged with full tracebacks and returned as 500.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        """Process the request and handle any unhandled exceptions.

        Args:
            request: The incoming HTTP request.
            call_next: The next middleware or route handler in the chain.

        Returns:
            Response: The response from the next handler, or an error response
                     if an unhandled exception occurs.
        """
        try:
            return await call_next(request)

        except HTTPException as http_exc:
            # BaseHTTPMiddleware swallows any exception raised from dispatch,
            # so we must return a response — re-raising would produce a 500.
            error_response = ErrorResponse(
                status_code=http_exc.status_code,
                status=http_exc.__class__.__name__,
                message=str(http_exc.detail)
            )
            return JSONResponse(
                status_code=http_exc.status_code,
                content=error_response.model_dump()
            )

        except ValueError as e:
            # Same reason: return JSONResponse instead of raising HTTPException.
            error_response = ErrorResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                status="UnprocessableContent",
                message=str(e)
            )
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                content=error_response.model_dump()
            )

        except Exception as e:
            # Log full exception traceback with request details
            logger.exception(
                f"Unhandled exception occurred | "
                f"Path: {request.url.path} | "
                f"Method: {request.method} | "
                f"Error: {str(e)}"
            )

            error_response = ErrorResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                status="InternalServerError",
                message="Something went wrong! Try again later..."
            )

            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content=error_response.model_dump()
            )
