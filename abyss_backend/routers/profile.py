"""The signed-in user's profile: view, edit, and delete the account."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.profile import DeleteAccountRequest, ProfileResponse, UpdateProfileRequest
from services.profile_service import ProfileError, ProfileService
from utils.auth import get_current_user

router = APIRouter(prefix="/profile", tags=["profile"])
profile_service = ProfileService()


def _http(exc: ProfileError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("", response_model=ProfileResponse)
async def get_profile(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """The signed-in user's profile, sign-in methods and what the account owns."""
    try:
        return await profile_service.get(session, user_id)
    except ProfileError as exc:
        raise _http(exc) from exc


@router.patch("", response_model=ProfileResponse)
async def update_profile(
    request: UpdateProfileRequest,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Change the display name."""
    try:
        return await profile_service.update(session, user_id, request)
    except ProfileError as exc:
        raise _http(exc) from exc


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    request: DeleteAccountRequest,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Permanently delete the account and everything in it.

    Needs the account's email typed out and a Firebase ID token from a
    sign-in made in the last 5 minutes. 400: email mismatch; 403: that
    sign-in is invalid, too old or another account's; 409: an answer is
    still being generated.
    """
    try:
        await profile_service.delete_account(session, user_id, request)
    except ProfileError as exc:
        raise _http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
