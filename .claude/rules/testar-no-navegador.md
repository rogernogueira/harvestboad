---
paths:
  - "frontend/src/**"
  - "backend/apps/**"
---

# Testar no navegador, com os usuários de teste

Verificação de tela neste projeto é pelo **MCP do Playwright**, contra a
aplicação de verdade. O que segue é o que já custou caro descobrir.

## As contas

Estão no `.env` da raiz, que é **ignorado pelo git**:

| Variável | Perfil | O que ela alcança |
|---|---|---|
| `TEST_USER` / `TEST_PASSWORD` | GESTOR | Painel de repositórios, caixa de entrada, solicitações |
| `TEST_ADM_USER` / `TEST_ADM_PASSWORD` | ADMIN | Acessos, notificações enviadas, catálogo, tabela do acervo |

Leia os valores do `.env` na hora. **Nunca os escreva em arquivo versionado,
commit, comentário ou mensagem** — é o motivo de o `.env` estar no
`.gitignore`, e um arquivo em `.claude/` é versionado como qualquer outro.

As duas telas são bem diferentes por perfil: `RepositoriesPage` entrega
`AdminRepositoriesPage` ao ADMIN e o painel de cartões ao GESTOR, e a seção de
notificações muda de uma aba para três. Testar só com uma conta cobre metade.

## Onde apontar o navegador

| | Endereço | Serve |
|---|---|---|
| Desenvolvimento | `http://localhost:5173` | Vite, com proxy de `/api` para o Django em **8002** |
| Produção | `https://hb.comais.uft.edu.br` | nginx do host → container na 8085 → gunicorn |

**Os dois usam o mesmo PostgreSQL.** Não há banco de desenvolvimento separado:
o que você alterar "em dev" é o dado que os usuários veem. Trate qualquer
escrita como escrita em produção.

## O dev server esgota as conexões do banco

`CONN_MAX_AGE: 60` (`backend/config/settings.py`) com o `runserver`, que abre
uma thread por requisição: a conexão da thread que morre nunca é fechada. Em
horas ele acumula as 100 conexões do PostgreSQL e **derruba produção junto**,
porque o banco é o mesmo.

Quando a API começar a devolver 500 em tudo, meça antes de suspeitar do código:

```bash
docker exec harvestboard_postgres ps aux | grep "postgres: monitor" \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | sort | uniq -c
```

`172.23.0.1` é o gateway da bridge, isto é, processos do host — o `runserver`.
O IP do container da API é o outro. Reiniciar o `runserver` devolve tudo.

## O que dá tração no Playwright

**Asserte pelo `id`, não pela aparência.** Todo componente emite `id`
(`.claude/rules/ids-de-componentes.md`), e é isso que torna a verificação
barata e precisa. `browser_evaluate` sobre `document.getElementById` diz mais,
em menos ida e volta, do que qualquer captura:

```js
() => ({
  aberto: document.getElementById('app-shell-pending-acknowledgement')?.open,
  abas: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent),
  fundo: getComputedStyle(document.getElementById('x-confirm')).backgroundColor,
})
```

Serve inclusive para conferir contraste: `getComputedStyle` devolve a cor que
o navegador realmente aplicou, que é o número a registrar no comentário.

**Captura de tela não chega ao disco local** neste ambiente — o arquivo que
`browser_take_screenshot` anuncia não aparece. Use `browser_snapshot`, que
devolve a árvore de acessibilidade em texto, ou `browser_evaluate`.

**`browser_fill_form` exige `target` em cada campo**, junto de `name`, `type` e
`value` — o `target` é a referência exata do snapshot, e sem ele a chamada é
recusada na validação antes de tocar a página.

## Quando um clique parece não funcionar

Antes de concluir que o componente está quebrado, **olhe o console e a API**.
Já aconteceu de cliques reais não surtirem efeito nenhum — inclusive em
controles antigos, intocados — e a causa ser o backend devolvendo 500: a página
carrega, mas nenhuma consulta resolve e a árvore fica inerte. `browser_console_messages`
e um `curl` na rota de login separam as duas hipóteses em segundos.

Outra pegadinha: `waitForSelector` numa lista pode estourar porque a lista
**esvaziou**, não porque quebrou. As telas trocam a lista pelo componente
`Empty`, com outro `id`. Espere pelo contêiner da página, não pelo `<ul>`.

## Escrita em dado real

`read`, `dismiss` e a exclusão de notificação **não se desfazem** — nem pela
interface, nem pela API. Não exercite nenhuma delas em registro de gente de
verdade.

O caminho seguro é criar o seu, usar e remover, tudo pela API:

```
POST   /api/v1/notifications/          (como ADMIN, com recipient = o gestor de teste)
POST   /api/v1/notifications/{id}/dismiss/   (como GESTOR)
DELETE /api/v1/notifications/{id}/     (como ADMIN, no fim)
```

A exclusão leva junto a dispensa, por cascata, e não sobra rastro além da
trilha de auditoria.

**Encerre a sessão ao terminar**, sobretudo a de ADMIN: o navegador do MCP
guarda o token no `localStorage` e a próxima verificação começaria autenticada
com o perfil errado, sem avisar.

## Antes de dar por verificado

Tela não substitui suíte, nem o contrário:

```bash
cd backend  && HARVESTER_BASE_URL="http://127.0.0.1:9" uv run python manage.py test apps
cd frontend && npx tsc -b && npm run lint && npm run format:check
```

O endereço morto no `HARVESTER_BASE_URL` comprova que a suíte não toca o
Harvester real — ela deve passar igual.
