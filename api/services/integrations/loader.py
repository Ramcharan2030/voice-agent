from __future__ import annotations

import importlib
import pkgutil

from loguru import logger

_INTERNAL_MODULES = {"base", "loader", "registry"}
_OPTIONAL_MODULES = {"tuner"}
_loaded = False


def ensure_integrations_loaded() -> None:
    global _loaded
    if _loaded:
        return

    package = importlib.import_module("api.services.integrations")
    for module_info in pkgutil.iter_modules(package.__path__):
        if module_info.name in _INTERNAL_MODULES:
            continue
        try:
            importlib.import_module(f"{package.__name__}.{module_info.name}")
        except ModuleNotFoundError:
            if module_info.name in _OPTIONAL_MODULES:
                logger.debug(
                    f"Skipping optional integration {module_info.name!r}; "
                    "required package is unavailable"
                )
                continue
            raise

    _loaded = True
