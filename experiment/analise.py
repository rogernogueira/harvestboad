#!/usr/bin/env python
"""Análise exploratória de `data/resultados-*.json`.

Onde `relatorio.py` responde "o que aconteceu com este registro", este script
pergunta **de que depende** o desfecho. É a diferença entre conferir e explorar:
aqui os recortes existem para levantar hipótese, não para fechar veredito.

Sem dependência externa: roda com o que a máquina já tem, e é para isso que
serve — abrir o resultado de uma corrida sem preparar ambiente. Quando a
pergunta não está aqui, `quadros.py` entrega os mesmos dados em DataFrames do
pandas, e aí qualquer recorte é uma linha. Os dois leem o mesmo JSON e foram
conferidos um contra o outro: a tabela de trocas de endereço bate registro a
registro.

    uv run python ../experiment/analise.py
    uv run python ../experiment/analise.py --arquivo data/resultados-indexed.json
    uv run python ../experiment/analise.py --secao regras --secao dominios
    uv run python ../experiment/analise.py --csv data/registros.csv

Seções: `visao`, `plataforma`, `regras`, `migracao`, `dominios`, `tamanho`,
`idade`, `oai`, `achados`. Sem `--secao`, roda todas.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

PASTA = Path(__file__).resolve().parent
DADOS = PASTA / "data"

# Desfecho em que a tela mostrou um botão e o botão não leva à página do item.
# `bloqueado` e `rede` ficam de fora: não são veredito sobre o endereço.
ENGANOSOS = ("fora-da-rota", "http-4xx", "http-5xx")
INCONCLUSIVOS = ("bloqueado", "rede")


# ------------------------------------------------------------------ leitura


def carregar(caminho: Path) -> tuple[dict, list[dict]]:
    """Achata o JSON em uma linha por registro, com o repositório junto.

    O formato gravado é aninhado (repositório → registros), que é o certo para
    ler com os olhos. Toda pergunta daqui para baixo é sobre registro, e cruzar
    com atributo do repositório é metade delas — daí achatar uma vez só, aqui.
    """
    dados = json.loads(caminho.read_text())
    linhas: list[dict] = []
    for repo in dados["repositorios"]:
        for registro in repo.get("registros", []):
            if "falha" in registro:
                continue
            nova = registro["paginaDoItem"]["nova"]
            antiga = registro["paginaDoItem"]["antiga"]
            linhas.append(
                {
                    "repo": repo.get("nome") or repo["baseUrl"],
                    "sigla": repo.get("sigla"),
                    "baseUrl": repo["baseUrl"],
                    "plataforma": repo.get("plataforma"),
                    "coletaEm": repo.get("ultimaColetaEm"),
                    "tamanhoDaColeta": repo.get("registrosNaUltimaColeta"),
                    "identifier": registro["identifier"],
                    "estrato": registro.get("estrato"),
                    "validacao": (registro.get("validacao") or {}).get("desfecho"),
                    "semelhanca": (registro.get("validacao") or {}).get("semelhanca"),
                    "candidatas": len(registro.get("candidates") or []),
                    "novaFonte": nova["source"],
                    "novaRegra": (nova["source"] or "").split(":")[-1] or None,
                    "novaVia": (nova["source"] or "").split(":")[0] or None,
                    "novaLink": nova["link"],
                    "nova": nova["abertura"]["desfecho"],
                    "antigaFonte": antiga["source"],
                    "antigaRegra": (antiga["source"] or "").split(":")[-1] or None,
                    "antigaLink": antiga["link"],
                    "antiga": antiga["abertura"]["desfecho"],
                    "oai": registro["oaiPmh"]["abertura"]["desfecho"],
                    "motivo": nova["abertura"].get("detalhe"),
                }
            )
    return dados, linhas


# ------------------------------------------------------------- apresentação


def barra(fracao: float, largura: int = 22) -> str:
    cheio = round(fracao * largura)
    return "█" * cheio + "·" * (largura - cheio)


def titulo(texto: str) -> None:
    print(f"\n\033[1m{texto}\033[0m\n" + "─" * 72)


def distribuicao(contagem: Counter, total: int, rotulo: str = "") -> None:
    if rotulo:
        print(f"  {rotulo}")
    for chave, valor in contagem.most_common():
        print(f"    {chave:<18} {valor:>5}  {barra(valor / total)} {100 * valor / total:5.1f}%")


def icc_binaria(linhas: list[dict], campo: str) -> float:
    """Correlação intraclasse do desfecho entre registros do mesmo repositório.

    Mede quanto dois registros do mesmo repositório se parecem. Aqui dá em
    torno de 0,5 a 0,8 — se um abre, o outro quase certamente abre —, e é por
    isso que tratar registros como independentes estreita demais os intervalos.

    Estimador de ANOVA, com tamanho médio corrigido para conglomerados
    desiguais: a média simples enviesaria quando um repositório rende 4
    registros e outro rende 1.
    """
    grupos: dict[str, list[int]] = defaultdict(list)
    for linha in linhas:
        grupos[linha["baseUrl"]].append(1 if linha[campo] == "ok" else 0)
    grupos = {k: v for k, v in grupos.items() if len(v) > 1}
    if len(grupos) < 2:
        return 0.0

    tamanhos = [len(v) for v in grupos.values()]
    somas = [sum(v) for v in grupos.values()]
    k, n = len(tamanhos), sum(tamanhos)
    p = sum(somas) / n
    sqe = sum((s / t - p) ** 2 * t for s, t in zip(somas, tamanhos))
    sqd = sum(s * (1 - s / t) for s, t in zip(somas, tamanhos))
    if k - 1 <= 0 or n - k <= 0:
        return 0.0
    mqe, mqd = sqe / (k - 1), sqd / (n - k)
    n0 = (n - sum(t * t for t in tamanhos) / n) / (k - 1)
    denominador = mqe + (n0 - 1) * mqd
    if denominador == 0:
        return 0.0
    return max(0.0, min(1.0, (mqe - mqd) / denominador))


def efeito_de_desenho(linhas: list[dict], campo: str) -> float:
    """Quanto a variância real é maior que a de uma amostra aleatória simples."""
    if not linhas:
        return 1.0
    contagem: dict[str, int] = defaultdict(int)
    for linha in linhas:
        contagem[linha["baseUrl"]] += 1
    m = sum(contagem.values()) / len(contagem)
    return 1 + (m - 1) * icc_binaria(linhas, campo)


def wilson(sucessos: float, total: float) -> tuple[float, float]:
    """Intervalo de confiança de 95% para uma proporção (Wilson).

    Wilson e não o normal simples porque as fatias ficam pequenas — uma
    plataforma com 16 itens, uma regra com 4. Ali o intervalo normal escapa de
    [0, 1] e sugere precisão que a amostra não tem.
    """
    if total == 0:
        return (0.0, 0.0)
    z, p, n = 1.96, sucessos / total, total
    centro = (p + z * z / (2 * n)) / (1 + z * z / n)
    margem = (z / (1 + z * z / n)) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, centro - margem), min(1.0, centro + margem))


def taxa(linhas: list[dict], campo: str, conglomerado: bool = True) -> str:
    """Taxa de acerto com intervalo de 95%, corrigido por conglomerado.

    A proporção é a observada; o que a correção muda é a incerteza em torno
    dela. Os registros vêm 2 a 4 por repositório e se parecem muito entre si,
    então o intervalo calculado sobre o n bruto promete uma precisão que a
    amostra não tem.
    """
    ok = sum(1 for linha in linhas if linha[campo] == "ok")
    efeito = efeito_de_desenho(linhas, campo) if conglomerado else 1.0
    baixo, alto = wilson(ok / efeito, len(linhas) / efeito)
    return f"{100 * ok / len(linhas):5.1f}% [{100 * baixo:4.1f}–{100 * alto:4.1f}]"


# --------------------------------------------------------------- as seções


def visao(dados: dict, linhas: list[dict]) -> None:
    titulo("VISÃO GERAL")
    repos = dados["repositorios"]
    listaram = [r for r in repos if not r.get("erro")]
    print(f"  repositórios          {len(repos)}")
    print(f"  listaram registros    {len(listaram)}  ({100 * len(listaram) / len(repos):.0f}%)")
    print(f"  registros medidos     {len(linhas)}")
    print(f"  rodado em             {dados['rodadoEm']}  (fonte: {dados['fonte']})")

    falhas = Counter(r["erro"].split(":")[0] for r in repos if r.get("erro"))
    if falhas:
        print()
        distribuicao(falhas, len(repos), "por que um repositório não listou")

    print()
    print(f"  página do item, régua antiga   {taxa(linhas, 'antiga')}")
    print(f"  página do item, régua nova     {taxa(linhas, 'nova')}")
    print(f"  OAI-PMH                        {taxa(linhas, 'oai')}")
    print("  (entre colchetes, o intervalo de 95% — a amostra é pequena por fatia)")

    for regua in ("antiga", "nova"):
        eng = sum(1 for linha in linhas if linha[regua] in ENGANOSOS)
        inc = sum(1 for linha in linhas if linha[regua] in INCONCLUSIVOS)
        print(f"\n  régua {regua:<7} enganosos {eng:>4}   inconclusivos {inc:>4}")


def plataforma(dados: dict, linhas: list[dict]) -> None:
    titulo("POR PLATAFORMA DA ORIGEM")
    grupos = defaultdict(list)
    for linha in linhas:
        grupos[linha["plataforma"] or "?"].append(linha)

    print(f"  {'':<11}{'itens':>6}{'antiga':>22}{'nova':>22}{'engana':>12}")
    for nome, grupo in sorted(grupos.items(), key=lambda p: -len(p[1])):
        ea = sum(1 for linha in grupo if linha["antiga"] in ENGANOSOS)
        en = sum(1 for linha in grupo if linha["nova"] in ENGANOSOS)
        print(
            f"  {nome:<11}{len(grupo):>6}{taxa(grupo, 'antiga'):>22}"
            f"{taxa(grupo, 'nova'):>22}{f'{ea} -> {en}':>12}"
        )


def regras(dados: dict, linhas: list[dict]) -> None:
    titulo("QUAL REGRA ESCOLHEU O ENDEREÇO, E COM QUE SUCESSO")
    grupos = defaultdict(list)
    for linha in linhas:
        grupos[linha["novaFonte"] or "(sem link)"].append(linha)

    print(f"  {'fonte':<24}{'itens':>6}{'abre':>22}")
    for nome, grupo in sorted(grupos.items(), key=lambda p: -len(p[1])):
        print(f"  {nome:<24}{len(grupo):>6}{taxa(grupo, 'nova'):>22}")

    titulo("A VIA IMPORTA MAIS QUE A REGRA?")
    vias = defaultdict(list)
    for linha in linhas:
        vias[linha["novaVia"] or "(sem link)"].append(linha)
    for nome, grupo in sorted(vias.items(), key=lambda p: -len(p[1])):
        print(f"  {nome:<24}{len(grupo):>6}{taxa(grupo, 'nova'):>22}")


def migracao(dados: dict, linhas: list[dict]) -> None:
    titulo("O QUE MUDOU: ANTIGA × NOVA")
    matriz = Counter((linha["antiga"], linha["nova"]) for linha in linhas)
    estados = sorted({e for par in matriz for e in par})

    print(f"  {'antiga \\ nova':<16}" + "".join(f"{e[:11]:>13}" for e in estados))
    for antiga in estados:
        celulas = "".join(f"{matriz.get((antiga, nova), 0) or '·':>13}" for nova in estados)
        print(f"  {antiga:<16}{celulas}")

    ganhos = sum(v for (a, n), v in matriz.items() if n == "ok" and a != "ok")
    perdas = sum(v for (a, n), v in matriz.items() if a == "ok" and n != "ok")
    iguais = sum(v for (a, n), v in matriz.items() if a == n)
    print(f"\n  inalterados {iguais}   ganhos +{ganhos}   perdas -{perdas}")

    # A diagonal domina em qualquer mudança sã; o que informa são os cantos.
    trocas = Counter(
        (linha["antigaRegra"], linha["novaRegra"])
        for linha in linhas
        if linha["antigaLink"] != linha["novaLink"]
    )
    if trocas:
        print("\n  trocou de endereço (regra antiga -> regra nova):")
        for (de, para), n in trocas.most_common(8):
            print(f"    {str(de):<12} -> {str(para):<12} {n:>4}")


def dominios(dados: dict, linhas: list[dict]) -> None:
    titulo("DOMÍNIOS QUE MAIS APARECEM NO LINK ESCOLHIDO")
    contagem = Counter(
        urlsplit(linha["novaLink"]).netloc for linha in linhas if linha["novaLink"]
    )
    for host, n in contagem.most_common(12):
        grupo = [
            linha
            for linha in linhas
            if linha["novaLink"] and urlsplit(linha["novaLink"]).netloc == host
        ]
        print(f"  {host[:44]:<46}{n:>4}{taxa(grupo, 'nova'):>22}")

    titulo("O LINK SAI DO DOMÍNIO DA ORIGEM?")
    dentro, fora = [], []
    for linha in linhas:
        if not linha["novaLink"]:
            continue
        (dentro if urlsplit(linha["novaLink"]).netloc == urlsplit(linha["baseUrl"]).netloc else fora).append(linha)
    for nome, grupo in (("mesmo domínio", dentro), ("outro domínio", fora)):
        if grupo:
            print(f"  {nome:<18}{len(grupo):>5}{taxa(grupo, 'nova'):>22}")
    print("  (sair não é defeito: DOI e hdl.handle.net são resolvedores)")


def tamanho(dados: dict, linhas: list[dict]) -> None:
    titulo("O TAMANHO DA COLETA PREVÊ ALGUMA COISA?")
    com = [linha for linha in linhas if isinstance(linha["tamanhoDaColeta"], int)]
    if not com:
        print("  a amostra não traz o tamanho da coleta (fonte sem índice)")
        return

    faixas = [(0, 100), (100, 1_000), (1_000, 10_000), (10_000, 10**9)]
    for baixo, alto in faixas:
        grupo = [linha for linha in com if baixo <= linha["tamanhoDaColeta"] < alto]
        if grupo:
            rotulo = f"{baixo:,}–{alto:,}" if alto < 10**9 else f"{baixo:,}+"
            print(f"  {rotulo:<18}{len(grupo):>5}{taxa(grupo, 'nova'):>22}")
    valores = [linha["tamanhoDaColeta"] for linha in com]
    print(f"\n  mediana {statistics.median(valores):,.0f} registros por coleta")


def idade(dados: dict, linhas: list[dict]) -> None:
    titulo("A COLETA ANTIGA ENVELHECE O LINK?")
    com = []
    for linha in linhas:
        try:
            com.append((datetime.fromisoformat(linha["coletaEm"]), linha))
        except (TypeError, ValueError):
            continue
    if not com:
        print("  a amostra não traz a data da coleta (fonte sem índice)")
        return

    recente = max(quando for quando, _ in com)
    faixas = [(0, 180), (180, 365), (365, 2 * 365), (2 * 365, 10**5)]
    for baixo, alto in faixas:
        grupo = [
            linha for quando, linha in com if baixo <= (recente - quando).days < alto
        ]
        if grupo:
            rotulo = f"{baixo}–{alto} dias" if alto < 10**5 else f"{baixo}+ dias"
            print(f"  {rotulo:<18}{len(grupo):>5}{taxa(grupo, 'nova'):>22}")
    print(f"\n  contado a partir da coleta mais recente da amostra: {recente:%Y-%m-%d}")


def oai(dados: dict, linhas: list[dict]) -> None:
    titulo("O BOTÃO OAI-PMH")
    distribuicao(Counter(linha["oai"] for linha in linhas), len(linhas))
    print("\n  não tem heurística: o endereço sai do registro. O que ele mede é a")
    print("  saúde da origem, e serve de piso para julgar a página do item.")

    titulo("A PÁGINA DO ITEM ABRE QUANDO O OAI-PMH ABRE?")
    for estado in ("ok", *INCONCLUSIVOS):
        grupo = [linha for linha in linhas if linha["oai"] == estado]
        if grupo:
            print(f"  OAI {estado:<12}{len(grupo):>5}{taxa(grupo, 'nova'):>22}")


def achados(dados: dict, linhas: list[dict]) -> None:
    titulo("O QUE MERECE OLHO HUMANO")

    restantes = [linha for linha in linhas if linha["nova"] in ENGANOSOS]
    print(f"  links enganosos que sobraram: {len(restantes)}")
    for linha in restantes[:10]:
        print(f"    [{linha['nova']}] {linha['novaFonte']}  {linha['novaLink']}")

    # Candidata única e recusada: ou a origem está fora, ou o metadado só tem
    # um endereço e ele não serve. Os dois casos pedem decisão humana.
    sozinhas = [
        linha for linha in linhas if linha["candidatas"] == 1 and linha["nova"] != "ok"
    ]
    print(f"\n  registros com uma candidata só, que não abriu: {len(sozinhas)}")

    sem = [linha for linha in linhas if linha["nova"] == "sem-link"]
    if sem:
        print(f"\n  sem link ({len(sem)}), por motivo:")
        distribuicao(Counter(linha["motivo"] or "?" for linha in sem), len(sem))

    fartos = Counter(linha["candidatas"] for linha in linhas)
    print("\n  quantas candidatas o metadado ofereceu:")
    distribuicao(Counter({f"{k} url": v for k, v in fartos.items()}), len(linhas))


def estrato(dados: dict, linhas: list[dict]) -> None:
    titulo("VIÉS DE AMOSTRAGEM: TOPO DO ACERVO × RECORTE SORTEADO")
    grupos = defaultdict(list)
    for linha in linhas:
        grupos[linha["estrato"] or "?"].append(linha)
    if len(grupos) < 2:
        print("  a corrida usou um estrato só; não há o que comparar")
        return

    print(f"  {'estrato':<12}{'itens':>6}{'antiga':>22}{'nova':>22}{'engana':>12}")
    for nome, grupo in sorted(grupos.items()):
        ea = sum(1 for linha in grupo if linha["antiga"] in ENGANOSOS)
        en = sum(1 for linha in grupo if linha["nova"] in ENGANOSOS)
        print(
            f"  {nome:<12}{len(grupo):>6}{taxa(grupo, 'antiga'):>22}"
            f"{taxa(grupo, 'nova'):>22}{f'{ea} -> {en}':>12}"
        )
    print()
    print("  `primeiros` é o topo do acervo — o OAI-PMH lista por datestamp")
    print("  crescente, então são os registros mais antigos do repositório.")
    print("  `janela` é um recorte de data sorteado. Diferença grande entre os")
    print("  dois significa que medir só o topo descreve o pior pedaço.")

    # A comparação acima é entre grupos que podem não vir dos mesmos
    # repositórios: uma origem pode responder ao recorte e falhar no topo, ou o
    # contrário. Nesse caso parte da diferença seria de composição, não de
    # estrato. O recorte abaixo isola os repositórios que deram os dois.
    por_repo = defaultdict(set)
    for linha in linhas:
        por_repo[linha["baseUrl"]].add(linha["estrato"])
    ambos = {url for url, e in por_repo.items() if len(e) > 1}
    pareado = [linha for linha in linhas if linha["baseUrl"] in ambos]
    if not pareado:
        return

    print(f"\n  Só os {len(ambos)} repositórios que renderam os dois estratos:")
    grupos_p = defaultdict(list)
    for linha in pareado:
        grupos_p[linha["estrato"]].append(linha)
    for nome, grupo in sorted(grupos_p.items()):
        print(f"    {nome:<12}{len(grupo):>6}{taxa(grupo, 'antiga'):>22}{taxa(grupo, 'nova'):>22}")


def validacao(dados: dict, linhas: list[dict]) -> None:
    titulo("O ÁRBITRO ACERTA? (título da página × título do metadado)")
    conferidos = [linha for linha in linhas if linha["validacao"]]
    if not conferidos:
        print("  esta corrida não validou; rode sem `--sem-validacao`")
        return

    distribuicao(Counter(linha["validacao"] for linha in conferidos), len(conferidos))
    confere = sum(1 for linha in conferidos if linha["validacao"] == "confere")
    julgados = [
        linha for linha in conferidos if linha["validacao"] in ("confere", "diverge")
    ]
    if julgados:
        baixo, alto = wilson(confere, len(julgados))
        print(
            f"\n  concordância entre árbitro e conteúdo: {confere}/{len(julgados)}"
            f" = {100 * confere / len(julgados):.1f}% [{100 * baixo:.1f}–{100 * alto:.1f}]"
        )
    print("\n  Mede o INSTRUMENTO, não o sistema: o árbitro chama de `ok` o")
    print("  endereço que responde e cuja rota final tem a marca certa, o que")
    print("  não prova que a página mostra o documento. Aqui isso é conferido.")

    divergem = [linha for linha in conferidos if linha["validacao"] == "diverge"]
    for linha in divergem[:8]:
        print(f"\n    [{linha['semelhanca']}] {linha['repo'][:44]}")
        print(f"      link : {linha['novaLink']}")


def desenho(dados: dict, linhas: list[dict]) -> None:
    titulo("DESENHO DA AMOSTRA: QUANTO ELA REALMENTE VALE")
    efeito = efeito_de_desenho(linhas, "nova")
    coeficiente = icc_binaria(linhas, "nova")
    repos = len({linha["baseUrl"] for linha in linhas})
    m = len(linhas) / repos

    print(f"  registros                 {len(linhas)}")
    print(f"  repositórios              {repos}")
    print(f"  registros por repositório {m:.2f}")
    print(f"  ICC do desfecho           {coeficiente:.3f}")
    print(f"  efeito de desenho (deff)  {efeito:.2f}")
    print(f"  n EFETIVO                 {len(linhas) / efeito:.0f}")
    print()
    print("  O ICC mede quanto dois registros do mesmo repositório se parecem.")
    print("  Alto como está, o segundo registro de um repositório traz pouca")
    print("  informação nova: os números acima dizem que esta amostra vale o")
    print(f"  equivalente a {len(linhas) / efeito:.0f} registros independentes, e não {len(linhas)}.")
    print()
    print("  Consequência de desenho: a precisão vem do número de REPOSITÓRIOS,")
    print("  não de registros por repositório. Com este ICC, o tamanho ótimo de")
    print("  conglomerado é 1 — mais repositórios, um registro em cada.")

    print("\n  Efeito por fatia:")
    print(f"    {'fatia':<14}{'n':>6}{'deff':>7}{'n efetivo':>11}")
    for campo in ("plataforma", "estrato"):
        grupos = defaultdict(list)
        for linha in linhas:
            grupos[linha[campo] or "?"].append(linha)
        for nome, grupo in sorted(grupos.items(), key=lambda p: -len(p[1])):
            e = efeito_de_desenho(grupo, "nova")
            print(f"    {str(nome):<14}{len(grupo):>6}{e:>7.2f}{len(grupo) / e:>11.0f}")


SECOES = {
    "visao": visao,
    "desenho": desenho,
    "estrato": estrato,
    "validacao": validacao,
    "plataforma": plataforma,
    "regras": regras,
    "migracao": migracao,
    "dominios": dominios,
    "tamanho": tamanho,
    "idade": idade,
    "oai": oai,
    "achados": achados,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arquivo", type=Path, default=DADOS / "resultados.json")
    parser.add_argument(
        "--secao", action="append", choices=list(SECOES), help="repetível"
    )
    parser.add_argument("--csv", type=Path, help="grava as linhas achatadas para outra ferramenta")
    args = parser.parse_args()

    dados, linhas = carregar(args.arquivo)
    if not linhas:
        print("nenhum registro medido no arquivo", file=sys.stderr)
        return 1

    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with args.csv.open("w", newline="") as saida:
            escritor = csv.DictWriter(saida, fieldnames=list(linhas[0]))
            escritor.writeheader()
            escritor.writerows(linhas)
        print(f"{len(linhas)} linhas em {args.csv}")

    for nome in args.secao or list(SECOES):
        SECOES[nome](dados, linhas)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
