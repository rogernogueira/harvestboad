"""
Django settings for config project.

Valores sensíveis vêm do .env na raiz do repositório (ver .env.example).
"""

import os
import sys
from datetime import timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv

# backend/config/settings.py -> backend/ -> raiz do repositório
BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

load_dotenv(REPO_ROOT / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-apenas-para-desenvolvimento")

DEBUG = env_bool("DJANGO_DEBUG", True)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "drf_spectacular",
    "apps.accounts",
    "apps.repositories",
    "apps.harvests",
    "apps.reports",
    "apps.integrations",
    "apps.audit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database — lê a DATABASE_URL do .env (Postgres do docker compose)

_db_url = urlparse(os.getenv("DATABASE_URL", ""))

if _db_url.scheme.startswith("postgres"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _db_url.path.lstrip("/"),
            "USER": unquote(_db_url.username or ""),
            "PASSWORD": unquote(_db_url.password or ""),
            "HOST": _db_url.hostname or "localhost",
            "PORT": str(_db_url.port or 5432),
            "CONN_MAX_AGE": 60,
        }
    }
else:
    raise RuntimeError(
        "DATABASE_URL ausente ou inválida. Copie .env.example para .env na raiz do repositório."
    )


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# Autenticação

AUTH_USER_MODEL = "accounts.User"


# Internationalization

LANGUAGE_CODE = "pt-br"

TIME_ZONE = "America/Sao_Paulo"

USE_I18N = True

USE_TZ = True


# Static files

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Email

MAILERS = {
    "default": {
        "BACKEND": "django.core.mail.backends.console.EmailBackend",
    },
}


# Django REST Framework

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        # Sessão apenas para a Browsable API e o Django Admin em desenvolvimento.
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}


# CORS — o dev server do Vite roda em outra origem

CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)


# JWT

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_MINUTES", "15"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_DAYS", "7"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}


# OpenAPI

SPECTACULAR_SETTINGS = {
    "TITLE": "HarvestBoard API",
    "DESCRIPTION": "API de monitoramento de repositórios e coletas do Harvester.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}


# Harvester

HARVESTER = {
    "BASE_URL": os.getenv("HARVESTER_BASE_URL", ""),
    # TTLs do cache das coletas, em segundos. O Harvester é lento e instável,
    # e seus dados são de coletas já concluídas — daí janelas generosas.
    # NETWORK é o mais longo: o repositório dono de um snapshot nunca muda.
    # Uma coleta concluída não muda: diagnóstico, regras, registros e XML dela
    # são imutáveis, e prazos curtos só geravam ida à origem sem ganho. O que
    # ainda muda é o estado do snapshot (uma coleta em andamento vira VALID) e
    # o cadastro do repositório — esses ficam com prazo menor.
    "CACHE_TTL_NETWORK": int(os.getenv("HARVESTER_CACHE_TTL_NETWORK", str(24 * 60 * 60))),
    "CACHE_TTL_SNAPSHOT": int(os.getenv("HARVESTER_CACHE_TTL_SNAPSHOT", str(30 * 60))),
    "CACHE_TTL_DIAGNOSE": int(os.getenv("HARVESTER_CACHE_TTL_DIAGNOSE", str(12 * 60 * 60))),
    "CACHE_TTL_RECORDS": int(os.getenv("HARVESTER_CACHE_TTL_RECORDS", str(6 * 60 * 60))),
    "CACHE_TTL_XML": int(os.getenv("HARVESTER_CACHE_TTL_XML", str(24 * 60 * 60))),
    # Índice completo dos repositórios: ~40 s e 2,9 MB por busca. TTL longo
    # porque o cadastro muda pouco e o custo de refazer é alto.
    "CACHE_TTL_INDEX": int(os.getenv("HARVESTER_CACHE_TTL_INDEX", str(12 * 60 * 60))),
    "USER": os.getenv("HARVESTER_USER", ""),
    "PASSWORD": os.getenv("HARVESTER_PASSWORD", ""),
    "TIMEOUT": float(os.getenv("HARVESTER_TIMEOUT", "10")),
    # A rede até o Harvester perde metade das conexões; sem repetição, qualquer
    # operação que toque vários repositórios raramente termina.
    "RETRIES": int(os.getenv("HARVESTER_RETRIES", "3")),
    "RETRY_BACKOFF": float(os.getenv("HARVESTER_RETRY_BACKOFF", "0.5")),
    # O formato do id de registro varia entre coletas, então a busca individual
    # pode cair numa varredura. Estes valores limitam o custo dela.
    "RECORD_SCAN_PAGE_SIZE": int(os.getenv("HARVESTER_SCAN_PAGE_SIZE", "100")),
    "RECORD_SCAN_MAX_PAGES": int(os.getenv("HARVESTER_SCAN_MAX_PAGES", "20")),
}


# OAI-PMH das origens
#
# A resolução do link público de um registro fala com o repositório do cliente,
# não com o Harvester: outra rede, outro dono, outros prazos. Timeout curto
# porque a chamada acontece com a tela do registro aberta, esperando; sem
# repetição porque, ao contrário do Harvester, a falha aqui tem resposta útil
# (o identificador pode já conter o DOI).
#
# MAX_BYTES limita o que se lê da origem: o `baseURL` chega do cliente e pode
# apontar para qualquer coisa. TTL longo porque o endereço de um registro
# publicado não muda.
OAI = {
    "TIMEOUT": float(os.getenv("OAI_TIMEOUT", "5")),
    "MAX_BYTES": int(os.getenv("OAI_MAX_BYTES", str(2 * 1024 * 1024))),
    "CACHE_TTL_LINK": int(os.getenv("OAI_CACHE_TTL_LINK", str(24 * 60 * 60))),
}


# Cache
#
# Guarda as respostas do Harvester, que é lento e perde metade das conexões.
# É **Redis**, não memória do processo: o cache precisa sobreviver a reinício e
# ser compartilhado entre workers — com vários processos de Gunicorn, um cache
# local daria a cada um a sua própria cópia fria, e a taxa de acerto cairia na
# proporção do número de processos.
#
# A suíte usa memória do processo, detectada por `sys.argv`: testes não podem
# depender de um serviço externo nem compartilhar estado entre execuções.
# `CACHE_BACKEND=locmem` força o mesmo comportamento fora dos testes.

_redis_url = os.getenv("REDIS_URL", "")
_cache_backend = os.getenv("CACHE_BACKEND", "").strip().lower()
_rodando_testes = "test" in sys.argv

if _rodando_testes or _cache_backend == "locmem" or not _redis_url:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "monitor-integra",
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _redis_url,
        }
    }

# Nota: o backend nativo do Django **não** tem `IGNORE_EXCEPTIONS` (isso é do
# pacote django-redis). Um Redis fora do ar levantaria exceção em toda leitura,
# então a tolerância é tratada em `apps.integrations.cache`, que já é o ponto
# único de acesso ao cache.
