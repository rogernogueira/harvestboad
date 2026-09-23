"""Bootstrap do Django para os scripts do experimento.

Eles rodam em dois lugares com layouts diferentes: nesta máquina o backend está
em `../backend`, e dentro do container `harvestboard_api` ele **é** a raiz
`/app`. Procurar o `manage.py` resolve os dois sem variável de ambiente nem
`if` no meio de cada script.

O container importa porque é o único lugar que alcança as duas redes de que o
experimento precisa: o Harvester (`200.130.0.61:8090`, que não responde do shell
da máquina) e a internet aberta, onde vivem as origens OAI.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"

# A ordem é deliberada. Dentro do container, `/app` é o backend **da imagem** —
# o código que o serviço no ar está executando. Copiar a árvore corrigida para
# `/app/backend` e pô-la na frente deixa o experimento medir a correção sem
# tocar no que atende os usuários. Fora do container só a primeira existe.
CANDIDATOS = (PASTA.parent / "backend", Path("/app/backend"), Path("/app"), PASTA.parent)


def raiz_django() -> Path:
    for caminho in CANDIDATOS:
        if (caminho / "manage.py").is_file() and (caminho / "config").is_dir():
            return caminho
    raise RuntimeError(
        "não achei o backend (manage.py + config/) em: "
        + ", ".join(str(c) for c in CANDIDATOS)
    )


def preparar() -> Path:
    """Põe o backend no `sys.path`, configura o Django e devolve a raiz."""
    raiz = raiz_django()
    if str(raiz) not in sys.path:
        sys.path.insert(0, str(raiz))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    import django

    django.setup()
    return raiz
