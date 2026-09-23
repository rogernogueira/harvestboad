# HarvestBoard Evidence

Painel do experimento Base 1 sobre um dataset científico **congelado**: seis
tabelas Parquet consultadas por DuckDB-WASM dentro do navegador, sem API e sem
servidor de aplicação.

```
evidence/
├── public/              fonte do dataset, versionada
│   ├── data/            6 Parquet + cópia .txt em base64 de cada um
│   ├── metadata/        dataset · codebook · vocabularies · hypotheses · provenance · checksums
│   └── sql/views.sql    camada analítica
├── src/                 React 19 + TypeScript + Tailwind 4 + ECharts + TanStack Table
└── dashboard/           build (gerado)
```

## Rodar

```bash
cd exp1/evidence
npm install
npm run build          # tsc -b && vite build && node empacotar.mjs
npm run preview        # http://127.0.0.1:4173
```

A porta 4173 é o padrão do `vite preview`; 8080 já estava ocupada nesta máquina
e as do projeto (5433, 6380, 8002, 5173) estão reservadas — ver o `CLAUDE.md` da
raiz. `npm run dev` levanta o Vite com recarga em `5173`, mas isso conflita com
o frontend principal se ele estiver de pé.

O build produz **duas entradas para o mesmo painel**:

| | arquivo | como lê os dados |
|---|---|---|
| multiarquivo | `dashboard/index.html` | busca `data/`, `metadata/` e `sql/` por HTTP |
| autocontida | `dashboard/painel-evidence.html` | tudo embutido, 3,95 MB, **nenhum caminho relativo** |

A segunda existe porque o visualizador de artefatos aninha a página dentro do
próprio documento e a serve numa URL que não é diretório: ali qualquer
`./assets/...` resolve para fora e volta 404. `empacotar.mjs` embute script,
estilo, os Parquet em base64, os metadados e o SQL num fragmento só. O código
usa `window.__EVIDENCE__` quando existe e busca os arquivos quando não.

## Regerar o dataset

```bash
cd ../..                                    # experiment/
.venv/bin/python exp1/congelar.py
sha256sum -c exp1/evidence/public/metadata/checksums.sha256
```

`congelar.py` é função pura dos arquivos de coleta em `exp1/data/`: as mesmas
entradas devolvem os mesmos bytes. Por isso `exported_at` e `git_commit` em
`provenance.json` são constantes da versão e não lidos em tempo de execução —
um carimbo de relógio mudaria o hash a cada rodada e mataria o invariante.

O binário do DuckDB (33 MB) vem do jsDelivr: não cabe no limite de 15 MB por
arquivo do publicador, e é a via documentada do `duckdb-wasm`.

## Exportar em CSV

Toda tabela do painel tem um botão **exportar CSV** logo acima dela — as do
componente `src/componentes/Tabela.tsx` ganham o botão de graça, e as três
escritas à mão (perfil da fonte, análise de sensibilidade e o contraste por
faixa de atualidade) montam o conteúdo na chamada de `BarraCsv`.

O contrato do arquivo, em `src/csv.ts`:

- **Valor cru, não formatado** — `0.8732`, não `"87,3%"`; `2183`, não `"2.183"`.
  O destino é a mesma planilha ou o mesmo DuckDB que lê `data/base-fontes.csv`,
  e número em pt-BR volta como texto. É a razão de a vírgula ser o separador e
  de não haver BOM: é o que o `to_csv` do pandas gera no dataset.
- **A tabela inteira, na ordem da tela** — não a página visível. O recorte são
  os filtros globais, que já entraram na consulta SQL.
- **As colunas declaradas** — a coluna "Fonte" leva `source_name_raw`, mesmo
  que a célula também desenhe a instituição embaixo. Quem quer todos os campos
  pega o Parquet, que é o formato canônico.
- **Nulo é campo vazio**, nunca `—` nem `0`.

Uma coluna sem acessador, ou cujo acessador guarda sentinela de ordenação,
precisa dizer o que exporta em `meta.csv` — `false` tira a coluna do arquivo,
e uma função `(linha) => valor` troca o valor. Os dois casos vivos estão em
`secoes/Fontes.tsx`: "Critérios atendidos", que não tem acessador nenhum, e
"Validade", cujo `-1` só existe para a fonte sem registro ordenar no fim.

## Onde mudar o quê

- **Faixa, critério de atenção, persistência** → `public/sql/views.sql`. Vivem
  no SQL para que o número do painel e o de quem baixa o dataset não divirjam.
- **Veredito de hipótese** → `metadata/hypotheses.json`, gerado por
  `congelar.py`. A aba Evidências só renderiza o que está lá.
- **Cor** → tokens em `src/index.css`, com o contraste medido no comentário.
  Os tokens de estado do gov.br DS reprovam como texto pequeno; estes descem um
  ou dois passos na mesma escala. Ao trocar, remeça.
