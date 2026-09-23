#!/usr/bin/env python
"""Materializa a Base 1 e o dicionário que a explica, em `data/`.

    .venv/bin/python exp1/criar.py            # cria o que falta
    .venv/bin/python exp1/criar.py --conferir # só confere a base que já existe

Três arquivos, e cada um responde a uma pergunta diferente:

- `base-fontes.csv` — a base. Nasce vazia, com as 36 colunas na ordem canônica:
  um CSV só de cabeçalho é o contrato que planilha, script e revisor leem
  igual, e é onde a primeira observação será digitada ou despejada.
- `dicionario.csv` — um campo por linha, com tipo, obrigatoriedade, condição e
  tamanho. É o dicionário do texto, gerado do código: divergir fica impossível.
- `vocabularios.csv` — um termo por linha, com código, significado e o CV de
  origem. Serve de lista de validação em planilha e de anexo do artigo.

**A base nunca é sobrescrita se tiver linha.** Recriá-la por engano apagaria
observação coletada à mão, que é o dado mais caro aqui. `--forcar` desliga a
trava, e só ele.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import base_fontes as bf


def criar(forcar: bool = False) -> int:
    bf.DADOS.mkdir(parents=True, exist_ok=True)

    if bf.BASE.is_file():
        atual = bf.ler()
        if len(atual) and not forcar:
            print(f"{bf.BASE.name}: {len(atual)} observação(ões) — preservado")
        else:
            bf.gravar(bf.vazia())
            print(f"{bf.BASE.name}: recriado vazio")
    else:
        bf.gravar(bf.vazia())
        print(f"{bf.BASE.name}: criado com {len(bf.COLUNAS)} colunas")

    dicionario = bf.DADOS / "dicionario.csv"
    dicionario.write_text(bf.dicionario().to_csv(index=False))
    print(f"{dicionario.name}: {len(bf.CAMPOS)} campos")

    vocabularios = bf.DADOS / "vocabularios.csv"
    vocabularios.write_text(bf.termos().to_csv(index=False))
    print(
        f"{vocabularios.name}: {len(bf.termos())} termos em {len(bf.VOCABULARIOS)} vocabulários"
    )
    return 0


def conferir() -> int:
    if not bf.BASE.is_file():
        print(f"{bf.BASE} não existe — rode sem `--conferir` primeiro")
        return 1
    base = bf.ler()
    problemas = bf.conferir(base)
    print(f"{bf.BASE.name}: {len(base)} observação(ões), {len(problemas)} problema(s)")
    if len(problemas):
        print(bf.resumo(problemas).to_string(index=False))
        return 1
    return 0


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument(
        "--forcar", action="store_true", help="recria a base mesmo com linhas"
    )
    argumentos.add_argument(
        "--conferir", action="store_true", help="só confere, não escreve"
    )
    opcoes = argumentos.parse_args()
    return conferir() if opcoes.conferir else criar(forcar=opcoes.forcar)


if __name__ == "__main__":
    raise SystemExit(main())
