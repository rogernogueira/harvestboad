#!/usr/bin/env python
"""Resolução de nomes forçada, para contornar o DNS desta máquina.

**Isto é configuração de ambiente, não do projeto.** A tabela abaixo corrige
nomes que o resolvedor local devolve errado aqui dentro; em outra máquina ela
pode ser desnecessária ou ter entradas diferentes. Uma entrada sobrando é
inofensiva — se o nome já resolve certo, forçar o mesmo destino não muda nada;
uma entrada faltando devolve `rede` e vira fonte falsamente inacessível, que é
o defeito que ela existe para evitar.

## O que aconteceu

Quatro periódicos da UFT apareceram como `rede`/`ConnectTimeout` e entraram na
base como indisponíveis. Não estavam: `sistemas.uft.edu.br` responde 200 com
XML OAI-PMH válido pelo endereço interno.

O resolvedor desta máquina devolve o IP **público** (`200.129.179.153`) para
`sistemas`, `curriola` e `www.uft.edu.br` — os três —, e esse endereço não
aceita conexão daqui. De dentro da rede da UFT o nome precisa resolver para o
endereço interno.

Foi diagnóstico do próprio usuário, e vale registrar o que isso significa:
**medimos a nossa rede e atribuímos o resultado à origem**. É o mesmo erro do
endpoint de agregador, com outra causa.

## Como funciona

O host é trocado pelo IP na URL, e o nome original volta em dois lugares que
não podem perdê-lo: o cabeçalho `Host`, sem o qual o servidor não sabe qual
site servir, e a extensão `sni_hostname`, sem a qual o handshake TLS pede o
certificado do IP e o servidor não responde.
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

import httpx

# nome -> endereço que funciona **desta máquina**.
RESOLUCAO: dict[str, str] = {
    "sistemas.uft.edu.br": "192.168.192.153",
    "curriola.uft.edu.br": "192.168.192.34",
    "repositorio.uft.edu.br": "192.168.192.47",
}


def buscar(client: httpx.Client, url: str) -> httpx.Response:
    """`client.get(url)`, aplicando a tabela quando o host estiver nela."""
    partes = urlsplit(url)
    endereco = RESOLUCAO.get(partes.hostname or "")
    if not endereco:
        return client.get(url)

    porta = f":{partes.port}" if partes.port else ""
    direto = urlunsplit(
        (partes.scheme, f"{endereco}{porta}", partes.path, partes.query, "")
    )
    pedido = client.build_request("GET", direto, headers={"Host": partes.netloc})
    pedido.extensions["sni_hostname"] = partes.hostname
    return client.send(pedido, follow_redirects=True)
