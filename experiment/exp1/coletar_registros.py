#!/usr/bin/env python
"""Pede `ListRecords` a cada origem e guarda os registros já desmontados.

    .venv/bin/python exp1/coletar_registros.py                  # 200 vivos por origem
    .venv/bin/python exp1/coletar_registros.py --registros 50   # amostra menor
    .venv/bin/python exp1/coletar_registros.py --de 2024-01-01  # janela temporal
    .venv/bin/python exp1/coletar_registros.py --refazer        # ignora o já coletado
    .venv/bin/python exp1/coletar_registros.py --resumo         # só relata

## Por que existe

Cinco das dez dimensões de qualidade que o experimento operacionaliza —
completude, conformidade, duplicação, normalização e consistência — são
perguntas sobre o **registro**, e a Base 1 inteira tem granularidade de fonte e
de coleta. `size` e `valid_size` dizem quantos registros passaram; não dizem
qual campo faltou em qual registro.

Perda e transformação **não** saem daqui: são de volume, medidas na camada de
coleta a partir de `size`, `valid_size` e `transformed_size`. Latência não é
medida em lugar nenhum enquanto não houver colheita por janela — é para isso
que existem `--de` e `--ate`.

Este é o único script do experimento que desce ao nível do registro.

## A amostra é contada em registros vivos, não em páginas

Quem define o tamanho da página é o provedor, e na coleta de 21/09/2026 isso
foi de 1 a 2.532 registros, com 1.483 das 1.550 páginas truncadas pelo próprio
provedor. Contar páginas dava precisão desigual — 40 fontes ficaram com 20
registros ou menos — e peso igual, na média por fonte, entre uma fonte de 1
registro e uma de 2.532.

`--registros N` segue o `resumptionToken` até juntar N registros **vivos** e
corta ali. Registro excluído não conta para a meta: ele não traz bloco de
metadados, e uma página inteira deles não mede nada. Naquela coleta foram 48
fontes assim, 3.643 registros gastos para zero medida — e 44 delas tinham
`resumptionToken` pendente, isto é, bastava pedir a página seguinte.

## Repetição, fluxo e disjuntor

**Falha de transporte se repete; resposta do servidor, não.** É a mesma regra do
`apps/integrations/harvester.py`: um 404 ou um 500 é determinístico e propaga na
primeira ocorrência, um timeout é ruído de rede. A versão anterior fazia o
inverso — repetia só o 503, uma vez, e desistia de qualquer erro de transporte
na primeira tentativa. Deu 147 desfechos `rede`, 95 deles timeout, e 36 em hosts
que responderam `ok` a outra fonte no mesmo lote. O número de tentativas fica
gravado em cada desfecho para que não-resposta da origem e pressa nossa sejam
separáveis no dado, que é o defeito que o `verificar_mudas.py` documentou.

**`429` vale o mesmo que `503`.** Os dois são controle de fluxo com
`Retry-After`, e só o segundo era obedecido: os 13 casos de 429 daquela coleta
estão em dois hosts, 12 deles num só — `periodicos.uninove.br`, que tem
exatamente 13 fontes. A pausa dentro do host agora dobra a cada 429 e não
volta, de modo que o host lento fica lento para todas as fontes dele.

**Disjuntor por host.** Quinze hosts falharam identicamente em *todas* as suas
fontes — 212 em `old.scielo.br` com 403, 38 em `periodicos.unb.br` com XML
inválido. Eram 289 pedidos evitáveis, cada um com pausa, contra servidores que
já haviam dito não. Depois de `FALHAS_PARA_DISJUNTOR` falhas duras idênticas
seguidas, as fontes restantes do host saem com `desfecho: disjuntor` e o
`herdado` diz qual era a falha. O caso do SciELO deixa de ser 212 linhas iguais
e vira um achado: endpoint de agregador compartilhado e morto.

## Por que `oai_dc` e não o prefixo de cada fonte

O cadastro traz oito prefixos diferentes (`oai_dc` em 2.045 fontes, `xoai` em
114, `oai_datacite` em 16, `mets` em 4). Comparar completude entre formatos
distintos compararia vocabulários distintos — um campo "ausente" em `mets`
pode existir com outro nome.

O `oai_dc` é obrigatório para todo repositório OAI-PMH 2.0, então é o único
denominador comum que permite uma medida por fonte comparável com as outras.
Onde ele falta, o desfecho registra `cannotDisseminateFormat`, que **é** o
achado: um repositório que não serve `oai_dc` está fora da especificação.

## O que não é guardado, e por quê

O XML cru **não** fica. `coletar_identify.py` guarda, e ali faz sentido: são
1.694 respostas de alguns KB. Aqui uma página de 100 registros passa de 200 KB
e o total ficaria em centenas de megabytes — volume que nem versiona nem
publica bem. Ficam o `sha256` de cada resposta, que continua provando de onde
veio o dado, e os campos desmontados.

Os valores são truncados em `LIMITE_VALOR`, com o comprimento original ao lado.
Um `dc:description` é um resumo inteiro e nenhuma das dimensões o lê por
extenso — o que se mede é presença, forma e vocabulário.

**Menos os campos cuja forma é lida.** `CAMPOS_SEM_CORTE` sai inteiro: os quatro
critérios de conformidade analisam o valor de `type`, `rights`, `language` e
`date`, e `title` alimenta o hash e a contagem de sete palavras da duplicação.
Cortar em 500 atingia 349 registros em `dc:rights` e 8 em `dc:title` — pouco,
mas é dúvida gratuita num campo que decide conformidade. Esses campos são curtos
por natureza; quem ocupa o arquivo é o `dc:description`, e esse continua cortado.

## Cortesia com a origem

A paralelização é **por host, não por fonte**. Dezenas de periódicos dividem o
mesmo servidor (212 fontes só em `old.scielo.br`, e uma universidade costuma
hospedar dúzias), e 16 pedidos simultâneos ao mesmo host é o tipo de pressa que
`verificar_mudas.py` já mostrou transformar falha nossa em característica da
origem. Cada host é atendido por uma linha de execução só, em sequência, com
pausa entre pedidos; o paralelismo vem de atender muitos hosts ao mesmo tempo.

**Identificação honesta.** O `User-Agent` dizia ser um Chrome no Windows. Contra
dois mil servidores institucionais isso torna o tráfego inatribuível, impede o
operador de liberar a coleta e deixa em aberto quantos dos 241 HTTP 403 eram
WAF reagindo ao disfarce. Agora o agente diz o que é; `--contato` acrescenta um
endereço, e vale a pena passá-lo.

**TLS é verificado primeiro.** A versão anterior desligava a verificação para
todo mundo. Como a procedência do dado se apoia no `sha256` da resposta, o
certificado importa: tenta-se verificado, e só o host que falhar no handshake
cai para não verificado — com `tlsVerificado: false` gravado no desfecho, que é
a diferença entre uma exceção silenciosa e uma propriedade medida.

**As origens são alcançáveis deste shell**, como em `coletar_identify.py` e
`coletar_sondas.py` — este script não fala com o Harvester.

## O que a recoleta de 22/09/2026 deu, contra a de 21/09

Mesmas 2.178 origens, `--registros 200`, em duas passadas (a segunda só sobre o
que não fechou `ok`):

    ok                  1.550 -> 1.573
    registros vivos   144.181 -> 296.019
    mediana por fonte     100 -> 200        (amplitude 1–2.532 -> 1–200)
    fontes com <=20 vivos  86 -> 5
    http-429               13 -> 0
    truncado em campo de forma  357 -> 0

68 fontes que a coleta anterior deu como `rede`, `429` ou `503` voltaram `ok`:
eram pressa nossa gravada como não-resposta da origem. 41 das 48 páginas que só
traziam lápide renderam registro vivo na página seguinte; as 7 restantes ficam
em `so-excluidos`, que é o desfecho honesto.

46 origens só respondem a `User-Agent` de navegador — 45 delas viraram `ok`
depois da troca, e o `agenteNavegador` no desfecho diz quais.

**58 fontes que a v1 trouxe não fecharam aqui, e 42 delas são um host só:**
`www.indexlaw.org` entrou em manutenção entre as duas datas e serve HTML com
HTTP 200 em vez de XML. Vale como lembrete de que página de manutenção com 200
é indistinguível de repositório quebrado sem olhar o corpo — o desfecho
`xml-invalido` guarda o `content-type`, que é o que permite separar depois.
"""

from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import ssl
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf
from resolucao import buscar

SAIDA = bf.DADOS / "registros.json.gz"

AGENTE = "HarvestBoard-Experiment/2.0 (coleta OAI-PMH para pesquisa; IBICT)"

# O agente honesto é o certo e é o padrão, mas alguns WAF respondem 403 a ele:
# 19 fontes que a coleta anterior trouxe com agente de navegador passaram a
# recusar. Em vez de escolher entre identificar-se e coletar, tenta-se honesto e
# só o host que devolver 403 cai para este — com `agenteNavegador: true` no
# desfecho, o que transforma o disfarce em propriedade medida.
AGENTE_NAVEGADOR = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
)

TIMEOUT = 40.0  # página de registros é bem maior que um Identify
TRABALHADORES = 12  # hosts simultâneos, não fontes
PAUSA_ENTRE_PEDIDOS = 0.7  # segundos, dentro do mesmo host
LIMITE_VALOR = 500
MAX_ESPERA_FLUXO = 60.0  # teto para o Retry-After de 429 e 503

# Transporte se repete, resposta do servidor não. Três tentativas com recuo
# geométrico cobrem o timeout de rede sem virar insistência: 1,5 s e 3 s.
TENTATIVAS_TRANSPORTE = 3
RECUO_BASE = 1.5

# Falhas duras idênticas seguidas no mesmo host antes de desistir dele.
#
# Cinco, e com sonda, porque a primeira versão (três, sem sonda) **perdeu 68
# fontes que a coleta anterior trouxe**: em `www.indexlaw.org` as três primeiras
# falharam e as 42 do host foram descartadas, sendo que as 42 vinham `ok`. Era o
# defeito do `verificar_mudas.py` de novo — decisão nossa virando propriedade da
# origem —, só que no nível do host.
#
# A sonda é o que impede o erro de ser definitivo: a cada `SONDA_DISJUNTOR`
# fontes puladas, uma é pedida de verdade, e se responder o disjuntor rearma.
# No host morto isso custa um pedido em dez em vez de todos; no host vivo que
# teve um mau começo, devolve o resto do lote.
FALHAS_PARA_DISJUNTOR = 5
SONDA_DISJUNTOR = 10

# Teto de páginas por fonte, independente da meta de registros: impede que uma
# origem que serve dez registros por página consuma a coleta inteira sozinha.
MAX_PAGINAS = 12

# Os campos cuja **forma** alguma dimensão lê não podem ser truncados: os quatro
# critérios de conformidade analisam o valor, e `title` vira hash e contagem de
# palavras na duplicação. São curtos por natureza — quem pesa é `description`.
CAMPOS_SEM_CORTE = frozenset({"title", "type", "rights", "language", "date"})

# Os quinze elementos do Dublin Core simples. A lista é fechada de propósito:
# um `oai_dc` que traga outra coisa está fora do esquema, e isso é achado de
# conformidade — não motivo para a coluna aparecer sozinha na tabela.
DUBLIN_CORE = (
    "title",
    "creator",
    "subject",
    "description",
    "publisher",
    "contributor",
    "date",
    "type",
    "format",
    "identifier",
    "source",
    "language",
    "relation",
    "coverage",
    "rights",
)


def _localname(tag: object) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _erro_oai(raiz: ET.Element) -> str:
    for elem in raiz.iter():
        if _localname(elem.tag) == "error":
            return elem.get("code") or "unknown"
    return ""


def _desmontar(registro: ET.Element) -> dict:
    """Um `<record>` em cabeçalho, campos e o que não pertence ao esquema."""
    cabecalho: dict = {"sets": []}
    campos: dict[str, list[str]] = {}
    fora: list[str] = []
    tamanhos: dict[str, list[int]] = {}

    # O `<identifier>` aparece no cabeçalho **e** dentro do `oai_dc`, com
    # sentidos diferentes: o primeiro é a chave OAI, o segundo é a URL ou DOI
    # do documento. Percorrer `iter()` sem olhar o pai mistura os dois — daí a
    # varredura por seção, e não por nome.
    for secao in registro:
        nome_secao = _localname(secao.tag)
        if nome_secao == "header":
            cabecalho["deleted"] = secao.get("status") == "deleted"
            for filho in secao:
                etiqueta = _localname(filho.tag)
                valor = (filho.text or "").strip()
                if etiqueta == "identifier":
                    cabecalho["identifier"] = valor
                elif etiqueta == "datestamp":
                    cabecalho["datestamp"] = valor
                elif etiqueta == "setSpec" and valor:
                    cabecalho["sets"].append(valor)
        elif nome_secao == "metadata":
            for envelope in secao:
                for filho in envelope:
                    etiqueta = _localname(filho.tag)
                    valor = (filho.text or "").strip()
                    if not valor:
                        continue
                    if etiqueta in DUBLIN_CORE:
                        corte = (
                            len(valor) if etiqueta in CAMPOS_SEM_CORTE else LIMITE_VALOR
                        )
                        campos.setdefault(etiqueta, []).append(valor[:corte])
                        tamanhos.setdefault(etiqueta, []).append(len(valor))
                    else:
                        fora.append(etiqueta)

    saida = {**cabecalho, "campos": campos}
    if fora:
        saida["foraDoEsquema"] = sorted(set(fora))
    # Só onde houve truncamento: guardar o comprimento de todo valor dobraria
    # o arquivo para registrar, quase sempre, o que já se sabe.
    truncados = {
        k: v
        for k, v in tamanhos.items()
        if k not in CAMPOS_SEM_CORTE and any(t > LIMITE_VALOR for t in v)
    }
    if truncados:
        saida["comprimentos"] = truncados
    return saida


def _tls_falhou(erro: BaseException) -> bool:
    """Se a falha de transporte foi o handshake, e não a rede.

    O `httpx` embrulha o erro de certificado num `ConnectError`, então o nome da
    classe não distingue "servidor fora do ar" de "certificado não confere" — é
    preciso descer a cadeia de causas. A diferença decide o desfecho: sem ela,
    as 212 fontes de `old.scielo.br`, cujo certificado tem hostname trocado,
    saem como `rede` em vez do `http-403` que o servidor de fato responde, e o
    achado de endpoint de agregador morto vira ruído de rede.
    """
    vistas: set[int] = set()
    atual: BaseException | None = erro
    while atual is not None and id(atual) not in vistas:
        vistas.add(id(atual))
        if isinstance(atual, ssl.SSLError) or "SSLCertVerification" in type(atual).__name__:
            return True
        atual = atual.__cause__ or atual.__context__
    return False


def _retry_after(resposta: httpx.Response, padrao: float = 5.0) -> float:
    try:
        return min(float(resposta.headers.get("Retry-After", padrao)), MAX_ESPERA_FLUXO)
    except ValueError:
        return padrao


class Fluxo(Exception):
    """429 ou 503 que não cedeu depois das tentativas. Carrega o código."""

    def __init__(self, codigo: int) -> None:
        super().__init__(str(codigo))
        self.codigo = codigo


def _pedir(client: httpx.Client, url: str) -> tuple[httpx.Response, int]:
    """Um GET com as duas repetições que o protocolo e a rede justificam.

    Devolve a resposta e quantas tentativas custou. O número vai para o
    desfecho: sem ele, não há como distinguir origem muda de cliente apressado
    depois do fato — que é o achado do `verificar_mudas.py`.

    Repete **transporte** (timeout, conexão recusada) e **controle de fluxo**
    (429, 503, ambos com `Retry-After`). Não repete 4xx nem 5xx comuns: são
    determinísticos, e insistir neles é só barulho na origem.
    """
    for tentativa in range(1, TENTATIVAS_TRANSPORTE + 1):
        ultima = tentativa == TENTATIVAS_TRANSPORTE
        try:
            resposta = buscar(client, url)
        except httpx.HTTPError:
            if ultima:
                raise
            time.sleep(RECUO_BASE * 2 ** (tentativa - 1))
            continue

        if resposta.status_code in (429, 503):
            if ultima:
                raise Fluxo(resposta.status_code)
            time.sleep(_retry_after(resposta))
            continue

        return resposta, tentativa

    raise AssertionError("inalcançável")


def _url(base: str, parametros: dict) -> str:
    partes = urlsplit(base)
    return urlunsplit(
        (partes.scheme, partes.netloc, partes.path, urlencode(parametros), "")
    )


def listar(
    client: httpx.Client,
    base: str,
    alvo: int,
    max_paginas: int = MAX_PAGINAS,
    janela: tuple[str | None, str | None] = (None, None),
) -> dict:
    """`ListRecords` de uma origem. Não levanta: o desfecho é parte do dado.

    Segue o `resumptionToken` até juntar `alvo` registros **vivos**, e corta no
    alvo-ésimo. Registro excluído não conta para a meta — ele vem sem bloco de
    metadados e não responde a nenhuma dimensão —, mas os que apareceram antes
    do corte ficam, porque caracterizam a amostra.
    """
    registros: list[dict] = []
    hashes: list[str] = []
    token: str | None = None
    tentativas = 0
    paginas = 0
    de, ate = janela

    def parcial(desfecho: str, detalhe: str = "") -> dict | None:
        """Desfecho de erro, ou `None` quando já há registro para aproveitar."""
        return None if registros else {"desfecho": desfecho, "detalhe": detalhe,
                                       "tentativas": tentativas}

    while paginas < max_paginas:
        if token:
            parametros = {"verb": "ListRecords", "resumptionToken": token}
        else:
            parametros = {"verb": "ListRecords", "metadataPrefix": "oai_dc"}
            # `from` e `until` só na primeira: o token já carrega o recorte, e
            # repeti-los ao lado dele é erro em boa parte das implementações.
            if de:
                parametros["from"] = de
            if ate:
                parametros["until"] = ate

        try:
            resposta, custou = _pedir(client, _url(base, parametros))
        except Fluxo as fluxo:
            tentativas += TENTATIVAS_TRANSPORTE
            if saida := parcial(f"http-{fluxo.codigo}"):
                return saida
            break
        except httpx.HTTPError as erro:
            tentativas += TENTATIVAS_TRANSPORTE
            detalhe = type(erro).__name__ + ("/TLS" if _tls_falhou(erro) else "")
            if saida := parcial("rede", detalhe):
                return saida
            break
        tentativas += custou

        if resposta.status_code >= 400:
            if saida := parcial(f"http-{resposta.status_code}"):
                return saida
            break

        try:
            raiz = ET.fromstring(resposta.content)
        except ET.ParseError:
            if saida := parcial(
                "xml-invalido", resposta.headers.get("content-type", "")[:40]
            ):
                return saida
            break

        if codigo := _erro_oai(raiz):
            # `noRecordsMatch` não é defeito: é repositório vazio, e a
            # diferença importa para não contá-lo como origem quebrada.
            if saida := parcial(f"oai-{codigo}"):
                return saida
            break

        paginas += 1
        hashes.append(hashlib.sha256(resposta.content).hexdigest())
        for elemento in raiz.iter():
            if _localname(elemento.tag) == "record":
                registros.append(_desmontar(elemento))

        token = next(
            (
                (e.text or "").strip()
                for e in raiz.iter()
                if _localname(e.tag) == "resumptionToken"
            ),
            "",
        )
        if _vivos(registros) >= alvo or not token:
            break
        time.sleep(PAUSA_ENTRE_PEDIDOS)

    if not registros:
        return {"desfecho": "vazio", "detalhe": "", "tentativas": tentativas}

    registros = _cortar_no_alvo(registros, alvo)
    vivos = _vivos(registros)
    datas = sorted(r["datestamp"] for r in registros if r.get("datestamp"))

    return {
        # Página que só traz lápide não é amostra: sem registro vivo não há
        # completude, conformidade nem título para comparar. Vira desfecho
        # próprio para não passar por `ok` e sumir dentro da contagem.
        "desfecho": "ok" if vivos else "so-excluidos",
        "detalhe": "",
        "paginas": len(hashes),
        "sha256": hashes,
        "tentativas": tentativas,
        "vivos": vivos,
        "temMais": bool(token),
        # A faixa de datestamp da página torna analisável o viés de *qual*
        # página o provedor serviu: 953 origens servem em ordem crescente e 592
        # em decrescente, e a completude medida acompanha a época do lote.
        "faixaDatestamp": [datas[0], datas[-1]] if datas else None,
        "registros": registros,
    }


def _vivos(registros: list[dict]) -> int:
    return sum(1 for r in registros if not r.get("deleted"))


def _cortar_no_alvo(registros: list[dict], alvo: int) -> list[dict]:
    """Corta no alvo-ésimo registro vivo, mantendo os excluídos que vieram antes.

    Sem o corte, uma fonte que serve 2.532 por página entraria com dez vezes a
    amostra de outra e pesaria o mesmo na média por fonte.
    """
    vivos = 0
    for i, registro in enumerate(registros):
        if not registro.get("deleted"):
            vivos += 1
            if vivos == alvo:
                return registros[: i + 1]
    return registros


# Desfechos que não adianta repetir noutra fonte do mesmo host: ou o servidor
# respondeu algo determinístico, ou não há servidor. `429`/`503` ficam de fora
# de propósito — são fluxo, e a resposta a eles é ir mais devagar, não desistir.
def _duro(desfecho: str) -> bool:
    # `rede` ficou **de fora**: falha de transporte é transitória por definição —
    # é por isso que ela se repete — e usá-la para condenar o host contradiz a
    # própria política de repetição. `429` e `503` também não: são fluxo, e a
    # resposta a eles é ir mais devagar, não desistir.
    return desfecho not in ("ok", "so-excluidos", "rede") and not desfecho.startswith(
        ("http-429", "http-503")
    )


def _cliente(verificar: bool, contato: str, navegador: bool = False) -> httpx.Client:
    if navegador:
        agente = AGENTE_NAVEGADOR
    else:
        agente = f"{AGENTE[:-1]}; {contato})" if contato else AGENTE
    return httpx.Client(
        timeout=TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": agente},
        verify=verificar,
    )


def _um_host(
    alvos: list[tuple[str, str]],
    alvo_registros: int,
    janela: tuple[str | None, str | None],
    contato: str,
) -> list[dict]:
    """Todas as fontes de um mesmo host, em sequência, com pausa e disjuntor."""
    achados: list[dict] = []
    pausa = PAUSA_ENTRE_PEDIDOS
    seguidas = 0
    ultimo_duro = ""
    pulados = 0
    verificar = True
    navegador = False
    cliente = _cliente(verificar, contato)

    def trocar(**mudanca) -> None:
        nonlocal cliente, verificar, navegador
        verificar = mudanca.get("verificar", verificar)
        navegador = mudanca.get("navegador", navegador)
        cliente.close()
        cliente = _cliente(verificar, contato, navegador)

    try:
        for i, (source_id, base) in enumerate(alvos):
            # Disjuntor aberto: pula, mas sonda uma a cada SONDA_DISJUNTOR para
            # que um mau começo não condene o host inteiro.
            if seguidas >= FALHAS_PARA_DISJUNTOR:
                pulados += 1
                if pulados % SONDA_DISJUNTOR:
                    achados.append(
                        {
                            "id": source_id,
                            "baseUrl": base,
                            "desfecho": "disjuntor",
                            "detalhe": "",
                            "herdado": ultimo_duro,
                            "tentativas": 0,
                        }
                    )
                    continue

            if i:
                time.sleep(pausa)
            achado = listar(cliente, base, alvo_registros, janela=janela)

            if (
                verificar
                and achado["desfecho"] == "rede"
                and achado.get("detalhe", "").endswith("/TLS")
            ):
                trocar(verificar=False)
                achado = listar(cliente, base, alvo_registros, janela=janela)

            # 403 com agente honesto costuma ser WAF, não política do acervo.
            if not navegador and achado["desfecho"] == "http-403":
                trocar(navegador=True)
                repetido = listar(cliente, base, alvo_registros, janela=janela)
                if repetido["desfecho"] == "ok":
                    achado = repetido
                else:
                    trocar(navegador=False)

            achado["tlsVerificado"] = verificar
            if navegador:
                achado["agenteNavegador"] = True
            achados.append({"id": source_id, "baseUrl": base, **achado})

            # Fluxo não conta para o disjuntor, mas desacelera o host inteiro —
            # e a pausa não volta: quem pediu calma pediu para todas as fontes.
            if achado["desfecho"].startswith(("http-429", "http-503")):
                pausa = min(pausa * 2, MAX_ESPERA_FLUXO)

            if _duro(achado["desfecho"]):
                seguidas = seguidas + 1 if achado["desfecho"] == ultimo_duro else 1
                ultimo_duro = achado["desfecho"]
            else:
                # A sonda respondeu: o host está vivo e o disjuntor rearma.
                seguidas = 0
                ultimo_duro = ""
                pulados = 0
    finally:
        cliente.close()
    return achados


def carregar(saida: Path = SAIDA) -> dict[str, dict]:
    if not saida.is_file():
        return {}
    with gzip.open(saida, "rt", encoding="utf-8") as arquivo:
        return {o["id"]: o for o in json.load(arquivo)["origens"]}


def coletar(
    alvo: int,
    refazer: bool,
    limite: int | None,
    janela: tuple[str | None, str | None],
    contato: str,
    saida: Path,
) -> int:
    base = bf.ler()
    alvos = base.loc[
        base["harvest_endpoint_url"].notna(), ["source_id", "harvest_endpoint_url"]
    ]
    alvos = list(alvos.drop_duplicates("source_id").itertuples(index=False, name=None))

    havido = {} if refazer else carregar(saida)
    # `so-excluidos` e `disjuntor` são desfechos a refazer quando se reexecuta:
    # o primeiro pode render registro vivo numa página seguinte, o segundo nem
    # chegou a pedir. Só `ok` encerra uma fonte.
    pendentes = [(i, u) for i, u in alvos if havido.get(i, {}).get("desfecho") != "ok"]
    if limite:
        pendentes = pendentes[:limite]

    por_host: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for source_id, url in pendentes:
        por_host[urlsplit(url).netloc].append((source_id, url))

    recorte = f" | janela {janela[0] or '—'}..{janela[1] or '—'}" if any(janela) else ""
    print(
        f"{len(alvos)} origens com endpoint | {len(pendentes)} a pedir"
        f" | {len(por_host)} hosts | meta de {alvo} registros vivos por origem{recorte}"
    )
    if not pendentes:
        return 0
    if maior := max(por_host.values(), key=len, default=[]):
        anfitriao = urlsplit(maior[0][1]).netloc
        print(f"  maior host: {anfitriao} com {len(maior)} origens, em sequência")

    resultados = dict(havido)
    feitas = 0
    with ThreadPoolExecutor(max_workers=TRABALHADORES) as piscina:
        futuros = {
            piscina.submit(_um_host, lista, alvo, janela, contato): host
            for host, lista in por_host.items()
        }
        for futuro in as_completed(futuros):
            for achado in futuro.result():
                resultados[achado["id"]] = achado
                feitas += 1
            if feitas and feitas // 100 != (feitas - 1) // 100:
                oks = sum(1 for r in resultados.values() if r["desfecho"] == "ok")
                registros = sum(len(r.get("registros", [])) for r in resultados.values())
                print(
                    f"  {feitas}/{len(pendentes)} — {oks} ok, {registros} registros",
                    flush=True,
                )

    saida.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(saida, "wt", encoding="utf-8") as arquivo:
        json.dump(
            {
                "coletadoEm": bf.pd.Timestamp.now(tz="UTC").isoformat(),
                "metadataPrefix": "oai_dc",
                "registrosVivosPorOrigem": alvo,
                "maxPaginas": MAX_PAGINAS,
                "janela": {"de": janela[0], "ate": janela[1]},
                "limiteValor": LIMITE_VALOR,
                "camposSemCorte": sorted(CAMPOS_SEM_CORTE),
                "agente": AGENTE,
                "origens": sorted(resultados.values(), key=lambda o: int(o["id"])),
            },
            arquivo,
            ensure_ascii=False,
        )
    print(f"{saida.name}: {saida.stat().st_size // 1024} KB")
    return resumo(saida)


def resumo(saida: Path = SAIDA) -> int:
    origens = carregar(saida)
    if not origens:
        print(f"{saida} não existe")
        return 1

    desfechos = collections.Counter(o["desfecho"] for o in origens.values())
    print(f"\n{len(origens)} origens pedidas")
    for desfecho, quantas in desfechos.most_common():
        print(f"  {quantas:>5}  {desfecho}")

    oks = [o for o in origens.values() if o["desfecho"] == "ok"]
    if not oks:
        return 0
    registros = [r for o in oks for r in o["registros"]]
    print(f"\n{len(registros)} registros de {len(oks)} origens")
    print(f"  excluídos (status=deleted): {sum(1 for r in registros if r.get('deleted'))}")
    print(f"  com campo fora do esquema:  {sum(1 for r in registros if r.get('foraDoEsquema'))}")

    # O que a revisão metodológica pediu que ficasse à vista.
    vivos_por_fonte = sorted(o.get("vivos", 0) for o in oks)
    meio = vivos_por_fonte[len(vivos_por_fonte) // 2]
    print(
        f"\nregistros vivos por origem: min {vivos_por_fonte[0]}"
        f" | mediana {meio} | max {vivos_por_fonte[-1]}"
    )
    for corte in (20, 50):
        magras = sum(1 for v in vivos_por_fonte if v <= corte)
        print(f"  origens com {corte} vivos ou menos: {magras}")
    print(f"  ainda truncadas pelo provedor (temMais): {sum(1 for o in oks if o.get('temMais'))}")
    print(f"  páginas pedidas no total: {sum(o.get('paginas', 0) for o in oks)}")
    repetidas = sum(1 for o in origens.values() if o.get("tentativas", 0) > o.get("paginas", 1))
    print(f"  origens que custaram repetição de pedido: {repetidas}")
    print(f"  origens em TLS não verificado: {sum(1 for o in origens.values() if o.get('tlsVerificado') is False)}")

    vivos = [r for r in registros if not r.get("deleted")]
    print(f"\npresença de campo entre os {len(vivos)} registros não excluídos:")
    for campo in DUBLIN_CORE:
        n = sum(1 for r in vivos if r["campos"].get(campo))
        print(f"  {campo:<12} {n:>7}  {n / max(len(vivos), 1) * 100:5.1f}%")
    return 0


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument(
        "--registros", type=int, default=200,
        help="registros vivos por origem; segue o token até juntar (padrão 200)",
    )
    argumentos.add_argument("--de", help="OAI `from`: início da janela (AAAA-MM-DD)")
    argumentos.add_argument("--ate", help="OAI `until`: fim da janela (AAAA-MM-DD)")
    argumentos.add_argument(
        "--contato", default="", help="endereço para o User-Agent; passe um"
    )
    argumentos.add_argument(
        "--saida", type=Path, default=SAIDA, help=f"arquivo de saída (padrão {SAIDA.name})"
    )
    argumentos.add_argument("--refazer", action="store_true", help="ignora o já coletado")
    argumentos.add_argument("--limite", type=int, help="só as N primeiras pendentes")
    argumentos.add_argument("--resumo", action="store_true", help="só relata")
    opcoes = argumentos.parse_args()
    if opcoes.resumo:
        return resumo(opcoes.saida)
    return coletar(
        opcoes.registros,
        opcoes.refazer,
        opcoes.limite,
        (opcoes.de, opcoes.ate),
        opcoes.contato,
        opcoes.saida,
    )


if __name__ == "__main__":
    raise SystemExit(main())
