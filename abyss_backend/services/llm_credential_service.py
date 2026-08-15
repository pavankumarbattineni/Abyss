import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, LlmCredential, Provider, ProviderModel
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
        default_entry = ProviderCatalogEntry(
            provider_id="default",
            provider="default",
            display_name="Default",
            models=[CatalogModelEntry(id="default", model_name="default", display_name="Default")],
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

    async def _invalidate_agents_for_provider(
        self, session: AsyncSession, user_id: str, provider_id: str
    ) -> None:
        """Bust the compiled-graph cache for every agent this user has pointed
        at `provider_id`, so an already-cached graph picks up a rotated/removed
        key on the very next message instead of continuing to use the old one.

        Default agents (llm_model_id NULL) are never affected — they're
        isolated from user credentials entirely, so they're excluded by the
        join itself (a NULL llm_model_id has no matching ProviderModel row).
        """
        from utils.graph_builder import invalidate_graph_cache

        result = await session.execute(
            select(Agent.id)
            .join(ProviderModel, ProviderModel.id == Agent.llm_model_id)
            .where(
                Agent.user_id == user_id,
                Agent.is_active == True,
                ProviderModel.provider_id == provider_id,
            )
        )
        for agent_id in result.scalars().all():
            invalidate_graph_cache(agent_id)

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

        await self._invalidate_agents_for_provider(session, user_id, provider_id)

        return LlmCredentialResponse(
            provider_id=provider.id,
            provider=provider.name,
            display_name=provider.display_name,
            masked_key=_mask_key(request.api_key),
            created_at=credential.created_at,
            updated_at=credential.updated_at,
        )

    async def delete_credential(self, session: AsyncSession, user_id: str, provider_id: str) -> None:
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
        await session.commit()

        await self._invalidate_agents_for_provider(session, user_id, provider_id)
