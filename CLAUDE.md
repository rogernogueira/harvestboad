# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Código, comentários, mensagens de commit e nomes de identificador são **em
português**: `ordenarPorAtencao`, `linhas`, `aberto`, `onFechar`, `_gravar`.
Siga a convenção ao escrever código novo — inglês só onde o framework impõe
(`useState`, `class Meta`, nomes de campo da API).

Os comentários do projeto explicam **por que**, não o que: quase todo bloco
incomum tem a medição ou o incidente que o motivou. Ao alterar um trecho
comentado assim, atualize o porquê junto.

A interface é traduzida em três idiomas (`pt-BR`, `es`, `en`). Todo texto
visível passa por `t()` e tem chave nos três arquivos de
`frontend/src/i18n/locales/`.

## Comandos

As portas fogem do padrão porque 5432, 6379 e 8000/8001 já estavam ocupadas
nesta máquina: PostgreSQL em **5433**, Redis em **6380**, API em **8002**.

```bash
docker compose up -d                          # postgres + redis

cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py runserver 8002

cd frontend
npm install && npm run dev                    # http://localhost:5173
```

Verificação:

```bash
cd backend  && uv run python manage.py test apps
cd frontend && npx tsc -b && npm run lint && npm run format:check
```

Um teste só — a suíte do backend usa o runner nativo do Django, então o alvo é
o caminho pontilhado do módulo:

```bash
uv run python manage.py test apps.repositories.tests.RepositoryAccessAPITests.test_admin_ve_todos_os_vinculos
```

A suíte **nunca** toca o Harvester real; toda chamada externa é dublada. Para
comprovar, rode contra um endereço morto — deve passar igual:

```bash
HARVESTER_BASE_URL="http://127.0.0.1:9" uv run python manage.py test apps
```

Ao mudar a porta da API, ajuste também o proxy em `frontend/vite.config.ts`.

## Arquitetura

### De onde vem cada dado

```
React (Vite) ──JWT──▶ Django REST Framework
                       ├── PostgreSQL  contas, perfis, vínculo usuário↔repositório
                       └── Harvester    repositórios, coletas, diagnósticos, registros
```

O PostgreSQL guarda **apenas o que é nosso**. Todo dado de coleta vem do
Harvester em tempo de requisição, com cache — não há tabela espelho. Ao
precisar de um campo novo de repositório ou coleta, o caminho é
`apps/harvests/services.py` ou `apps/repositories/services.py`, nunca uma
migração.

### Autorização: `None` quer dizer "todos"

`User.accessible_repository_ids()` devolve a lista de IDs do GESTOR e **`None`
para o ADMIN**, no sentido de "sem limite". Tratar `None` como lista vazia
inverte a regra e tranca justamente quem pode tudo:

```python
allowed = user.accessible_repository_ids()
if allowed is None:      # ADMIN — passa direto
    return
```

Coleta não tem dono próprio: o vínculo é indireto (usuário → repositório →
snapshot), e descobrir o repositório de um snapshot exige ir ao Harvester. É o
que `apps/harvests/permissions.assert_can_read_snapshot` faz, apoiado no cache
de `services.snapshot_network`.

O guarda `AdminRoute` no frontend é conveniência de navegação, não segurança —
quem recusa de fato é o backend, com 403.

### Cache das respostas do Harvester

A origem é lenta e perde cerca de metade das conexões. Daí três decisões que
andam juntas:

- **O cache guarda a resposta crua**, não a normalizada. É o que faz
  `diagnosis()` e `rules()` — ambas derivadas de `/public/diagnose/{id}` —
  compartilharem uma única ida à origem. Se você mudar o formato normalizado,
  suba `CACHE_PREFIX` em `apps/harvests/services.py` para invalidar o que ficou
  com a forma antiga.
- **Repetição só em falha de transporte.** Um 404 ou 500 é determinístico e
  propaga na primeira ocorrência (`apps/integrations/harvester.py`).
- **Falha nunca é cacheada**, e cache indisponível degrada para "não tinha"
  em vez de virar 500 (`apps/integrations/cache.py`) — o backend Redis nativo
  do Django não tem `IGNORE_EXCEPTIONS`.

Os TTLs em `config/settings.py` são longos de propósito: uma coleta concluída é
imutável. O que ainda muda — estado do snapshot, cadastro do repositório — tem
prazo menor.

### Vocabulário de filtros compartilhado

`valid`, `transformed`, `validRule` e `invalidRule` significam a mesma coisa no
diagnóstico, na listagem e na exportação, e vivem **na URL**, não em estado de
componente. É isso que permite clicar na contagem de uma regra no diagnóstico e
cair nos registros já filtrados, com o recorte sobrevivendo ao botão voltar.

O vocabulário tem duas metades que precisam andar juntas:
`backend/apps/harvests/filters.py` e `frontend/src/lib/filters.ts`. Mexer em uma
sem a outra quebra a navegação entre telas silenciosamente.

### camelCase é escrito à mão

Não há middleware de conversão: cada serializer declara o campo no formato que
o frontend consome, com `source` apontando para o atributo Python.

```python
harvesterRepositoryId = serializers.CharField(source="harvester_repository_id", read_only=True)
```

Campo novo na API exige a declaração explícita — e o tipo correspondente em
`frontend/src/lib/types.ts`.

### Uma origem só

Em desenvolvimento o Vite faz proxy de `/api` para o Django; em produção o
nginx serve o SPA e faz proxy de `/api/` para o gunicorn. Nos dois casos o
navegador conhece uma origem só, então não há requisição cross-origin:
`CORS_ALLOWED_ORIGINS` fica **vazia em produção de propósito**. Não a preencha
para "resolver" um erro de CORS em produção — o sintoma é outro problema.

## Convenções do frontend

Componentes levam `id` no HTML, com regras de nomenclatura e o cuidado com
listas descritos em `.claude/rules/ids-de-componentes.md`.

A tabela de registros pagina **no servidor** (dezenas de milhares de linhas) e a
de administração pagina **no navegador** (~2.200 linhas buscadas de uma vez, com
TanStack Table). A diferença é de escala, não de gosto: não uniformize as duas.

### Padrão Digital de Governo

A interface segue o [gov.br/ds](https://www.gov.br/ds). Não há Tailwind: o
estilo vem de `@govbr-ds/core` e os componentes de `@govbr-ds/react-components`,
com Font Awesome **5** (o core referencia `"Font Awesome 5 Free"`; na 6 o mapa de
glifos muda) e a fonte Rawline pelo CDN do SERPRO, declarada no `index.html`.

A marca gráfica do gov.br **não** é usada — o cabeçalho leva o lockup do
HarvestBoard e a assinatura do IBICT.

**Camadas da cascata.** O core não usa `@layer` em lugar nenhum, e CSS sem camada
vence CSS em camada. Por isso ele é importado dentro de uma camada nomeada, em
`src/index.css`:

```css
@layer base, govbr, components;
@import '@govbr-ds/core/dist/core-lite.min.css' layer(govbr);
```

Sem isso o core sobrescreve qualquer regra do projeto. Mexer nessa ordem quebra
o estilo de tudo ao mesmo tempo.

**Prefira o componente do design system**, mas confira antes de trocar. Quatro
deles foram testados e descartados, com o motivo no comentário de cada arquivo:

| Componente | Por que não | Onde |
|---|---|---|
| `BrHeader`, `BrMenu` | `aria-label` em português fixo no código; o menu é gaveta, não barra lateral | `layouts/AppShell.tsx` |
| `BrPagination` | imprime "Primeira/Última página" em português como texto visível | `components/Pagination.tsx` |
| `BrBreadcrumbs` | `aria-label` em português; não aceita `id` nem `className` | `components/Breadcrumb.tsx` |
| `BrModal` | sem `inert` nem captura de foco — o `<dialog>` nativo entrega os dois | `components/Modal.tsx` |

Nesses casos vale o markup próprio sobre as classes `br-*` do core, com os
rótulos passando por `t()`.

**Contraste não é herdado do padrão.** Os tokens de estado do DS reprovam como
texto pequeno: `--success` dá 4,02, `--danger` 4,24 e `--warning` 1,36 sobre o
pastel da mesma família. Os tokens do projeto descem um ou dois passos na mesma
escala; as medições estão nos comentários de `src/index.css` e de
`components/Badges.tsx`. Ao trocar uma cor, remeça e atualize o número.

Três classes do projeto cobrem o que o core não tem: `.sr-only`, `.plain-list` e
`.gap-1`…`.gap-5` — esta última na mesma escala de espaçamento das margens dele.

## API

Tudo sob `/api/v1/`, com Swagger em `/api/v1/docs/`. A app `audit` grava a
trilha por um ponto único (`apps/audit/services.record`).
