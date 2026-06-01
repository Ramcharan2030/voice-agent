from fastapi import HTTPException

from api.constants import DISABLE_HOSTED_CLOUD


def dograh_cloud_enabled() -> bool:
    return not DISABLE_HOSTED_CLOUD


def require_dograh_cloud(feature: str) -> None:
    if dograh_cloud_enabled():
        return
    raise HTTPException(
        status_code=403,
        detail=(
            f"{feature} is disabled because DISABLE_HOSTED_CLOUD=true. "
            "Configure your own provider or enable the flag explicitly."
        ),
    )


def require_dograh_cloud_runtime(feature: str) -> None:
    if dograh_cloud_enabled():
        return
    raise RuntimeError(
        f"{feature} is disabled because DISABLE_HOSTED_CLOUD=true. "
        "Configure your own provider or enable the flag explicitly."
    )
