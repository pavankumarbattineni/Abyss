from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.auth import FirebaseTokenRequest, RefreshRequest, TokenPairResponse, UpdateSettingsRequest, UserResponse
from services.firebase_auth_service import authenticate_firebase_user
from services.oauth_service import OAuthService
from utils.auth import get_current_user
from utils.firebase import verify_firebase_token
from utils.jwt import create_access_token, create_refresh_token

router = APIRouter(prefix="/auth", tags=["auth"])
oauth_service = OAuthService()


@router.post("/firebase", response_model=TokenPairResponse)
async def exchange_firebase_token(
    request: FirebaseTokenRequest,
    session: AsyncSession = Depends(get_async_session),
):
    """Exchange a verified Firebase ID token for Abyss application tokens.

    Args:
        request: Request containing the Firebase-issued ID token.
        session: Database session used to find or create the application user.

    Returns:
        A signed Abyss access-token and refresh-token pair.

    Raises:
        HTTPException: If Firebase verification or user mapping fails.
    """
    try:
        decoded = await verify_firebase_token(request.id_token)
        user = await authenticate_firebase_user(session, decoded)
        return TokenPairResponse(
            access_token=create_access_token(user.id),
            refresh_token=create_refresh_token(user.id),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firebase authentication failed",
        ) from exc


@router.get("/me", response_model=UserResponse)
async def me(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Return the profile belonging to the authenticated Abyss user.

    Args:
        user_id: User ID extracted from the Abyss access token.
        session: Database session used to load the user profile.

    Returns:
        The public user profile.

    Raises:
        HTTPException: If the access token is missing or invalid.
    """
    return await oauth_service.me(session, user_id)


@router.patch("/setting", response_model=UserResponse)
async def update_setting(
    request: UpdateSettingsRequest,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Update the authenticated user's application settings.

    Args:
        request: Settings values to persist.
        user_id: User ID extracted from the Abyss access token.
        session: Database session used to update the user.

    Returns:
        The updated public user profile.

    Raises:
        HTTPException: If the access token is missing or invalid.
    """
    return await oauth_service.update_settings(session, user_id, request)


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh(
    request: RefreshRequest,
    session: AsyncSession = Depends(get_async_session),
):
    """Exchange a valid Abyss refresh token for a new token pair.

    Args:
        request: Request containing the existing refresh token.
        session: Database session used to verify that the user is active.

    Returns:
        A newly issued access-token and refresh-token pair.

    Raises:
        HTTPException: If the refresh token is invalid, expired, or belongs to
            an inactive user.
    """
    try:
        return await oauth_service.refresh(session, request.refresh_token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        ) from exc
