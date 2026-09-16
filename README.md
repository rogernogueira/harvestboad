# HarvestBoard

Painel de acompanhamento de repositórios e coletas do Harvester do IBICT.

Gestores consultam apenas os repositórios associados à sua conta, acompanham as
coletas, examinam diagnósticos de validação, analisam registros individuais,
consultam o XML transformado e exportam relatórios.

## Arquitetura

```
React (Vite)  ──HTTPS + JWT──▶  Django REST Framework
                                 ├── PostgreSQL: usuários, permissões e vínculos
                                 └── Harvester (IBICT): repositórios, coletas e diagnósticos
```

O PostgreSQL guarda apenas o que é nosso — contas, perfis e o vínculo
usuário↔repositório. Todo o dado de coleta vem do Harvester em tempo de
requisição, com cache.

## Requisitos

- [uv](https://docs.astral.sh/uv/) (Python 3.14)
- Node.js 22+
- Docker com Compose

## Como rodar

```bash
cp .env.example .env     # preencha as credenciais do Harvester
docker compose up -d     # PostgreSQL em localhost:5433

cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver 8002

cd ../frontend
npm install
npm run dev              # http://localhost:5173
```

### Portas

Nesta máquina de desenvolvimento, 5432 (PostgreSQL do sistema) e 8000/8001
(outros serviços) já estavam ocupadas. Por isso o projeto usa **5433** para o
banco e **8002** para a API. Ambas são configuráveis no `.env`; ao mudar a
porta da API, ajuste também o proxy em `frontend/vite.config.ts`.

## Deploy

Em produção o nginx serve o SPA já compilado **e** faz proxy de `/api/` para o
gunicorn. É o mesmo desenho do `vite.config.ts` em desenvolvimento, e tem a
mesma consequência: o navegador só conhece uma origem, então não há requisição
cross-origin e o CORS não entra em jogo. A lista `CORS_ALLOWED_ORIGINS` fica
vazia em produção de propósito.

```
proxy reverso (192.168.105.5)        hb.comais.uft.edu.br, o TLS termina aqui
        │ HTTP
        ▼
host:8085 ──▶ web (nginx)
                 ├── /             SPA (build do Vite)
                 ├── /static/      estáticos do admin e do Swagger
                 └── /api/ /admin/ ──▶ api (gunicorn) ──▶ postgres, redis
```

Só o container `web` publica porta no host. O gunicorn, o PostgreSQL e o Redis
conversam pela rede interna do compose.

```bash
cp .env.example .env     # ajuste DJANGO_SECRET_KEY e DJANGO_ALLOWED_HOSTS
docker compose build
docker compose up -d
```

O `docker-entrypoint.sh` do backend aplica as migrações e roda o
`collectstatic` a cada subida, então não há passo manual entre o build e o ar.

### O que o proxy reverso precisa saber

| Item | Valor |
|------|-------|
| Destino | `192.168.105.5:8085` (ajustável em `WEB_PORT`) |
| Protocolo interno | HTTP — o TLS termina no proxy |
| Cabeçalhos | `Host`, `X-Forwarded-For` e `X-Forwarded-Proto: https` |

O `X-Forwarded-Proto` não é opcional: sem ele o Django trata a requisição como
HTTP e recusa os POSTs do admin por origem inválida. O domínio precisa estar em
`DJANGO_ALLOWED_HOSTS` e em `DJANGO_CSRF_TRUSTED_ORIGINS` — neste **com o
esquema** (`https://hb.comais.uft.edu.br`).

## Estrutura

```
backend/apps/
├── accounts       # usuário customizado, perfis ADMIN/GESTOR, JWT
├── repositories   # vínculos usuário↔repositório e permissões
├── harvests       # coletas, diagnósticos, regras e registros
├── reports        # exportações
├── integrations   # cliente HTTP do Harvester
└── audit          # trilha de auditoria

frontend/src/
├── auth           # contexto de sessão e rotas protegidas
├── lib            # cliente HTTP, queries e vocabulário de filtros
├── pages          # login, repositórios, coleta, registros, XML
└── components     # peças compartilhadas
```

## API

Toda a API vive sob `/api/v1/`. A documentação interativa fica em
`/api/v1/docs/` (Swagger) e `/api/v1/redoc/`.

Os filtros de registros (`valid`, `transformed`, `validRule`, `invalidRule`)
usam o mesmo vocabulário no diagnóstico, na listagem e na exportação — é o que
permite navegar entre as telas preservando o recorte.

## Testes

```bash
cd backend && uv run python manage.py test apps
cd frontend && npx tsc -b && npm run lint
```

A suíte do backend nunca toca o Harvester real: todas as chamadas externas são
dubladas. Para comprovar, rode com a origem apontada para um endereço morto:

```bash
HARVESTER_BASE_URL="http://127.0.0.1:9" uv run python manage.py test apps
```

## Operação

O Harvester é instável — cerca de metade das conexões falha com
"No route to host". O cliente repete falhas de transporte (não respostas HTTP
de erro) e as respostas ficam em cache. Sem `REDIS_URL`, o cache é por processo;
em produção com múltiplos workers, aponte-o para um Redis.

A sigla do repositório é servida ao vivo pela origem, com a coluna local como
reserva. Para ressincronizar os valores gravados:

```bash
uv run python manage.py sync_repository_acronyms --dry-run
```
