"""Registry of oracle operations. Each module registers handlers with @op."""

import importlib
import pkgutil

REGISTRY = {}


def op(name):
    def register(handler):
        REGISTRY[name] = handler
        return handler

    return register


def load_all():
    for module in pkgutil.iter_modules(__path__):
        importlib.import_module(f"{__name__}.{module.name}")
