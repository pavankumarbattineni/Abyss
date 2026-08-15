from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.oauth import (
    ForgotPasswordRequest,
    MessageResponse,
    RefreshRequest,
    ResetPasswordRequest,
    SigninRequest,
    SignupRequest,
    TokenPairResponse,
    UpdateSettingsRequest,
    UserResponse,
)
from services.oauth_service import OAuthService
from utils.auth import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])
oauth_service = OAuthService()


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    request: SignupRequest,
    session: AsyncSession = Depends(get_async_session),
):
    """Register a new user account.

    Args:
        request: Signup request containing an optional username, email, and password.
        session: Async database session for database operations.

    Returns:
        UserResponse: The newly created user's details.

    Raises:
        HTTPException: 400 if the email already exists or validation fails.
    """
    return await oauth_service.signup(session, request)


@router.post("/signin", response_model=TokenPairResponse)
async def signin(
    request: SigninRequest,
    session: AsyncSession = Depends(get_async_session),
):
    """Authenticate a user and return an access + refresh token pair.

    Args:
        request: Signin request containing email and password.
        session: Async database session for database operations.

    Returns:
        TokenPairResponse: The JWT access token and refresh token.

    Raises:
        HTTPException: 401 if credentials are invalid.
    """
    return await oauth_service.signin(session, request)


@router.get("/me", response_model=UserResponse)
async def me(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Return the currently authenticated user's details.

    Args:
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session for database operations.

    Returns:
        UserResponse: The authenticated user's details.

    Raises:
        HTTPException: 401 if the token is missing or invalid.
    """
    return await oauth_service.me(session, user_id)


@router.patch("/settings", response_model=UserResponse)
async def update_settings(
    request: UpdateSettingsRequest,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Update the authenticated user's account-level settings.

    Currently only covers `thinking_enabled` — the global toggle for whether
    agent responses include a visible reasoning trace. Applies to every
    agent the user talks to, including scheduler-triggered runs.

    Args:
        request: Body containing the settings to update.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session for database operations.

    Returns:
        UserResponse: The user's details after the update.

    Raises:
        HTTPException: 401 if the token is missing or invalid.
    """
    return await oauth_service.update_settings(session, user_id, request)


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh(
    request: RefreshRequest,
    session: AsyncSession = Depends(get_async_session),
):
    """Exchange a valid refresh token for a new access + refresh token pair.

    Args:
        request: Body containing the refresh token.
        session: Async database session for database operations.

    Returns:
        TokenPairResponse: A freshly issued access and refresh token.

    Raises:
        HTTPException: 401 if the refresh token is invalid or expired.
    """
    return await oauth_service.refresh(session, request.refresh_token)


@router.post("/signout", response_model=MessageResponse)
async def signout(
    user_id: str = Depends(get_current_user),
):
    """Sign out the current session.

    Authentication is via the Bearer access token alone. Tokens are stateless,
    so the client is responsible for discarding them after this call.

    Args:
        user_id: JWT-authenticated user ID (injected by dependency).

    Returns:
        MessageResponse: Confirmation message.

    Raises:
        HTTPException: 401 if the access token is missing or invalid.
    """
    return MessageResponse(message="Signed out successfully")


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    request: ForgotPasswordRequest,
    session: AsyncSession = Depends(get_async_session),
):
    """Reset a user's password in a single step, keyed on their email.

    No proof-of-ownership step is required — providing a registered email and a
    new password sets the password directly.

    Args:
        request: Body containing the account email and the new password.
        session: Async database session for database operations.

    Returns:
        MessageResponse: Confirmation message.

    Raises:
        HTTPException: 422 if no active user exists for the given email.
    """
    await oauth_service.forgot_password(session, request.email, request.new_password)
    return MessageResponse(message="Password reset successfully")


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    request: ResetPasswordRequest,
    session: AsyncSession = Depends(get_async_session),
):
    """Change a password after verifying the current (old) password.

    Args:
        request: Body containing the email, current password, and new password.
        session: Async database session for database operations.

    Returns:
        MessageResponse: Confirmation message.

    Raises:
        HTTPException: 401 if the email/old password combination is invalid.
    """
    await oauth_service.reset_password(
        session, request.email, request.old_password, request.new_password
    )
    return MessageResponse(message="Password reset successfully")
