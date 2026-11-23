import logging
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import LlmCredential, Provider, ProviderModel, User
from schemas.llm_credential import (
    CatalogModelEntry,
    LlmCredentialResponse,
    LlmCredentialUpsertRequest,
    ProviderCatalogEntry,
    ProviderInfo,
)
from utils.encryption import decrypt_value, encrypt_value
from utils.llm_providers import get_provider_spec

logger = logging.getLogger(__name__)


def _mask_key(raw_key: str) -> str:
    if len(raw_key) <= 8:
        return "*" * len(raw_key)
    return f"{raw_key[:4]}...{raw_key[-4:]}"


# The platform's own models in the picker: "default" plus "default-1" and
# "default-2" (provider_models.platform_slot), all on the platform's key.
DEFAULT_CHOICES: dict[str, int] = {"default": 0, "default-1": 1, "default-2": 2}


def default_choice_label(slot: int) -> str:
    return "Default" if not slot else f"Default - {slot}"


async def validate_default_slot(session: AsyncSession, slot: int) -> None:
    """A "Default - n" choice must have an active model in that slot."""
    if not slot:
        return
    found = await session.scalar(
        select(ProviderModel.id).where(ProviderModel.platform_slot == slot, ProviderModel.is_active == True)
    )
    if not found:
        raise ValueError(f"{default_choice_label(slot)} isn't available right now")


async def validate_model_selection(
    session: AsyncSession, user_id: str, llm_model_id: Optional[str]
) -> None:
    """Allow a non-Default model only if it is a real, active model whose
    provider the user has added a key for.

    llm_model_id=None means "Default" (platform key) — no checks needed.
    """
    if llm_model_id is None:
        return

    result = await session.execute(
        select(Provider.id, Provider.display_name)
        .join(ProviderModel, ProviderModel.provider_id == Provider.id)
        .where(
            ProviderModel.id == llm_model_id,
            ProviderModel.is_active == True,
            Provider.is_active == True,
        )
    )
    row = result.first()
    if not row:
        raise ValueError(f"Unknown or inactive model: {llm_model_id}")
    provider_id, provider_name = row

    cred_result = await session.execute(
        select(LlmCredential.id).where(
            LlmCredential.user_id == user_id,
            LlmCredential.provider_id == provider_id,
            LlmCredential.is_active == True,
        )
    )
    if not cred_result.scalar_one_or_none():
        raise ValueError(f"Add your {provider_name} API key in Settings before selecting this model")


class LlmCredentialService:

    async def _get_active_provider(self, session: AsyncSession, provider_id: str) -> Provider:
        result = await session.execute(
            select(Provider).where(Provider.id == provider_id, Provider.is_active == True)
        )
        provider = result.scalar_one_or_none()
        if not provider:
            raise ValueError(f"Unknown or inactive provider: {provider_id}")
        return provider

    async def list_providers(self, session: AsyncSession) -> list[ProviderInfo]:
        result = await session.execute(
            select(Provider)
            .where(Provider.is_active == True)
            .order_by(Provider.name.asc())
        )
        return [
            ProviderInfo(id=p.id, name=p.name, display_name=p.display_name)
            for p in result.scalars().all()
        ]

    async def list_catalog(self, session: AsyncSession) -> list[ProviderCatalogEntry]:
        result = await session.execute(
            select(Provider, ProviderModel)
            .join(ProviderModel, ProviderModel.provider_id == Provider.id)
            .where(Provider.is_active == True, ProviderModel.is_active == True)
            .order_by(Provider.name.asc(), ProviderModel.display_name.asc())
        )

        models_by_provider: dict[str, ProviderCatalogEntry] = {}
        for provider, model in result.all():
            entry = models_by_provider.get(provider.id)
            if entry is None:
                entry = ProviderCatalogEntry(
                    provider_id=provider.id,
                    provider=provider.name,
                    display_name=provider.display_name,
                    models=[],
                )
                models_by_provider[provider.id] = entry
            entry.models.append(
                CatalogModelEntry(id=model.id, model_name=model.model_name, display_name=model.display_name)
            )

        # Synthetic leading entry — normalizes to the null "Default" sentinel
        # (see schemas.agent._normalize_llm_model_id) rather than being a real
        # provider row, so the frontend can render it as just another catalog
        # item instead of hardcoding it.
        # "Default - 1" / "Default - 2": the platform's extra models, shown only
        # by their slot name (their own names stay in the BYOK list below).
        slots = (
            await session.execute(
                select(ProviderModel.platform_slot)
                .join(Provider, Provider.id == ProviderModel.provider_id)
                .where(ProviderModel.platform_slot.is_not(None), ProviderModel.is_active == True, Provider.is_active == True)
                .order_by(ProviderModel.platform_slot.asc())
            )
        ).scalars().all()
        default_entry = ProviderCatalogEntry(
            provider_id="default",
            provider="default",
            display_name="Default",
            models=[CatalogModelEntry(id="default", model_name="default", display_name="Default")]
            + [
                CatalogModelEntry(id=f"default-{slot}", model_name=f"default-{slot}", display_name=default_choice_label(slot))
                for slot in slots
            ],
        )
        return [default_entry] + list(models_by_provider.values())

    async def list_credentials(
        self, session: AsyncSession, user_id: str
    ) -> list[LlmCredentialResponse]:
        result = await session.execute(
            select(LlmCredential, Provider)
            .join(Provider, Provider.id == LlmCredential.provider_id)
            .where(
                LlmCredential.user_id == user_id,
                LlmCredential.is_active == True,
            )
        )
        return [
            LlmCredentialResponse(
                provider_id=provider.id,
                provider=provider.name,
                display_name=provider.display_name,
                masked_key=_mask_key(decrypt_value(cred.encrypted_api_key, purpose="llm")),
                created_at=cred.created_at,
                updated_at=cred.updated_at,
            )
            for cred, provider in result.all()
        ]

    async def upsert_credential(
        self, session: AsyncSession, user_id: str, provider_id: str, request: LlmCredentialUpsertRequest
    ) -> LlmCredentialResponse:
        provider = await self._get_active_provider(session, provider_id)
        spec = get_provider_spec(provider.name)
        spec.validate(request.api_key)

        result = await session.execute(
            select(LlmCredential).where(
                LlmCredential.user_id == user_id,
                LlmCredential.provider_id == provider_id,
            )
        )
        credential = result.scalar_one_or_none()
        encrypted = encrypt_value(request.api_key, purpose="llm")

        if credential:
            credential.encrypted_api_key = encrypted
            credential.is_active = True
        else:
            credential = LlmCredential(
                user_id=user_id, provider_id=provider_id, encrypted_api_key=encrypted
            )
            session.add(credential)

        await session.commit()
        await session.refresh(credential)


        return LlmCredentialResponse(
            provider_id=provider.id,
            provider=provider.name,
            display_name=provider.display_name,
            masked_key=_mask_key(request.api_key),
            created_at=credential.created_at,
            updated_at=credential.updated_at,
        )

    async def delete_credential(self, session: AsyncSession, user_id: str, provider_id: str) -> bool:
        """Remove the user's key for a provider. If their selected model is one
        of that provider's models, it is reset to Default (NULL) in the same
        transaction -- without the key every chat would fail. Returns whether
        the model was reset.
        """
        provider = await self._get_active_provider(session, provider_id)

        result = await session.execute(
            select(LlmCredential).where(
                LlmCredential.user_id == user_id,
                LlmCredential.provider_id == provider_id,
                LlmCredential.is_active == True,
            )
        )
        credential = result.scalar_one_or_none()
        if not credential:
            raise ValueError(f"No {provider.name} credential found")

        credential.is_active = False
        provider_models = select(ProviderModel.id).where(ProviderModel.provider_id == provider_id)
        # The user's selected model needs this key: fall back to Default.
        reset = await session.execute(
            update(User)
            .where(User.id == user_id, User.llm_model_id.in_(provider_models))
            .values(llm_model_id=None)
        )
        await session.commit()
        if reset.rowcount:
            logger.info("Reset user %s to the default model after removing a %s key", user_id, provider.name)
        return bool(reset.rowcount)

