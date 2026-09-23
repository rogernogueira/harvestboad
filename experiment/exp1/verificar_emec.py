#!/usr/bin/env python
"""Confere nossa classificação de instituição contra os recortes do e-MEC.

    .venv/bin/python exp1/verificar_emec.py            # o relatório
    .venv/bin/python exp1/verificar_emec.py --divergem # só o que não bate

Lê **todo** CSV de `data/` que tenha o cabeçalho do e-MEC, junta os recortes e
confere as 755 instituições nossas contra eles. Cada recorte novo que você
exportar entra sem mexer no código.

O e-MEC traz `Categoria Administrativa` e `Natureza Jurídica`, e os dois
discordam com frequência — há "Privada com fins lucrativos" dentro de um
recorte de não-lucrativas, e municipal dentro dele também. Por isso o esperado
sai do **par** das duas colunas, e não de uma só.

Municipal, aliás, aparece em dois baldes diferentes: `Pública Municipal` e
`Especial`. O segundo reúne instituições criadas por lei municipal que o
e-MEC não enquadra no primeiro; FURB e UNITAU estão lá, não aqui.

## O casamento é o problema difícil, não a comparação

Três regras, da mais forte para a mais fraca, todas travadas pela UF — que só
temos porque o cadastro do Harvester dá o estado de cada fonte:

- `sigla+UF` — sigla normalizada (sem hífen nem ponto) e UF iguais.
- `não casou` — fica assim, em vez de casar no susto.

O casamento por termos do nome foi tentado e descartado: rendia oito pares a
mais e dois deles errados. Com a UF travada, o que sobra de comum entre nomes
distintos é quase sempre o nome da cidade ou da área.

Cada afrouxamento foi pago com um falso positivo, e por isso o critério está
onde está: casar só por sigla trouxe a UNESC do Espírito Santo para a do
Extremo Sul Catarinense, e a UCP de Petrópolis para uma do Paraná. Exigir um
termo em comum trouxe a Tuiuti do Paraná para uma faculdade "do centro do
Paraná" e a UNIPÊ para a Maurício de Nassau de João Pessoa — com a UF travada,
o nome da cidade não distingue nada.

**Não casar não é evidência de nada.** Os recortes cobrem o que você exportou;
ausência de um deles só quer dizer que a instituição não está naquele recorte.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf

SAIDA = bf.DADOS / "verificacao-emec.csv"

COLUNAS_EMEC = {
    "Instituição(IES)",
    "Sigla",
    "UF",
    "Natureza Jurídica",
    "Categoria Administrativa",
}

# O esperado sai de **três** colunas, porque nenhuma basta sozinha.
#
# `Categoria Administrativa` dá a esfera — federal, estadual, municipal,
# privada. `Natureza Jurídica` desempata quando a categoria mente: há
# municipal dentro do recorte de privadas, e "Privada com fins lucrativos"
# dentro do de não-lucrativas. E `Organização Acadêmica` dá o **tipo**, que é
# o que faltava: `Pública Federal` não implica universidade — a Fiocruz, a
# ENAP e a Academia Nacional de Polícia são "Escola de Governo", e exigir
# FEDERAL_UNIVERSITY delas acusava sete falsas divergências.
ESFERA = {
    "Pública Federal": ("FEDERAL_UNIVERSITY", "FEDERAL_INSTITUTE"),
    "Pública Estadual": ("STATE_UNIVERSITY", None),
    "Pública Municipal": ("MUNICIPAL_UNIVERSITY", None),
}

# Tipos que um público **não universitário** pode legitimamente ter no CV01.
# É bucket largo de propósito: "Faculdade" no e-MEC cobre unidade de
# universidade, escola militar e instituto de pesquisa ao mesmo tempo. Continua
# pegando o erro que importa — privada ou sociedade científica num público.
PUBLICO_NAO_UNIVERSITARIO = {
    "GOVERNMENT_AGENCY",
    "RESEARCH_INSTITUTE",
    "OTHER",
    "LIBRARY",
}

SO_GOVERNO = {"Escola de Governo"}
SO_REDE_FEDERAL = {
    "Instituto Federal de Educação, Ciência e Tecnologia",
    "Centro Federal de Educação Tecnológica",
}


def esperado_para(categoria: object, natureza: object, organizacao: object) -> set[str]:
    """Os códigos do CV01 compatíveis com o que o e-MEC diz."""
    cat, nat, org = str(categoria or ""), str(natureza or ""), str(organizacao or "")

    # A natureza vence a categoria quando discordam: município dentro de um
    # recorte de privadas é município.
    if "Municipal" in nat:
        return {"MUNICIPAL_UNIVERSITY"} | PUBLICO_NAO_UNIVERSITARIO
    if cat.startswith("Privada com fins") or "Com fins" in nat:
        # Com fins lucrativos exclui comunitária: a ICES da Lei 12.881/2013
        # exige entidade sem fins lucrativos.
        return {"PRIVATE_UNIVERSITY"}
    if cat.startswith("Privada") or cat == "Especial":
        return (
            {"PRIVATE_UNIVERSITY", "MUNICIPAL_UNIVERSITY"}
            if cat == "Especial"
            else {"PRIVATE_UNIVERSITY"}
        )

    universidade, rede = ESFERA.get(cat, (None, None))
    if universidade is None:
        return set()
    if org in SO_GOVERNO:
        return {"GOVERNMENT_AGENCY", "RESEARCH_INSTITUTE"}
    if org in SO_REDE_FEDERAL:
        return {rede} if rede else {universidade}
    if org == "Universidade":
        return {universidade}
    # Faculdade, centro universitário e credenciada especial: pode ser unidade
    # da universidade, órgão de governo ou instituto de pesquisa.
    return {universidade} | PUBLICO_NAO_UNIVERSITARIO


PARAR = {
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "em",
    "universidade",
    "centro",
    "universitario",
    "faculdade",
    "faculdades",
    "instituto",
    "superior",
    "ensino",
    "escola",
    "pontificia",
    "integradas",
    "associacao",
    "sociedade",
    "fundacao",
    "estado",
    "regional",
    "vale",
    "grande",
    "acre",
    "alagoas",
    "amapa",
    "amazonas",
    "bahia",
    "ceara",
    "espirito",
    "santo",
    "goias",
    "maranhao",
    "mato",
    "grosso",
    "sul",
    "minas",
    "gerais",
    "para",
    "paraiba",
    "parana",
    "pernambuco",
    "piaui",
    "rio",
    "janeiro",
    "norte",
    "sao",
    "paulo",
    "catarina",
    "sergipe",
    "tocantins",
    "brasilia",
    "distrito",
    "federal",
    "nacional",
    "brasileiro",
    "brasileira",
}


def k(t: object) -> str:
    t = unicodedata.normalize("NFKD", str(t or ""))
    return " ".join(
        "".join(c for c in t if not unicodedata.combining(c)).lower().split()
    )


def sig(t: object) -> str:
    return re.sub(r"[^a-z0-9]", "", k(t))


def tokens(nome: object) -> set[str]:
    return {
        t
        for t in k(re.sub(r"\([^)]*\)", " ", str(nome))).split()
        if t not in PARAR and len(t) > 2
    }


# O e-MEC exporta em mais de uma codificação. O recorte de privadas com fins
# lucrativos veio em Mac OS Roman e com terminador CR — `0x97` é "ó" ali, e
# `\r` sozinho quebra o leitor em C do pandas. Tentar na ordem e **falhar alto**
# é o ponto: a primeira versão disto pulava arquivo que não decodificasse, e
# teria descartado 2.028 instituições sem dizer nada.
CODIFICACOES = ("utf-8-sig", "mac_roman", "cp1252", "latin-1")


def _e_do_emec(caminho: Path) -> bool:
    """O cabeçalho é do e-MEC? Decidido nos bytes, antes de qualquer parse.

    Separar isto do `_ler_emec` é o que distingue "CSV nosso, ignore" de
    "recorte do e-MEC que não abriu" — sem a distinção, os nossos próprios
    arquivos viravam alarme e um recorte perdido viraria ruído entre eles.
    """
    cabecalho = caminho.read_bytes()[:2048].decode("latin-1")
    return "Mantenedora" in cabecalho and "Categoria Administrativa" in cabecalho


def _ler_emec(caminho: Path) -> pd.DataFrame | None:
    """Um recorte do e-MEC, seja qual for a codificação. `None` se não for um."""
    if not _e_do_emec(caminho):
        return None
    erros = []
    for codificacao in CODIFICACOES:
        try:
            d = pd.read_csv(
                caminho, sep=";", dtype="str", encoding=codificacao, engine="python"
            )
        except (
            UnicodeDecodeError,
            pd.errors.ParserError,
            pd.errors.EmptyDataError,
        ) as erro:
            erros.append(f"{codificacao}: {type(erro).__name__}")
            continue
        if not COLUNAS_EMEC <= set(d.columns):
            continue  # decodificou torto; a próxima codificação pode acertar
        d.attrs["codificacao"] = codificacao
        return d
    # O cabeçalho é do e-MEC e nenhuma codificação abriu: isso **precisa**
    # gritar. A primeira versão disto pulava calado, e teria descartado as
    # 2.028 privadas com fins lucrativos sem dizer nada.
    raise SystemExit(f"{caminho.name}: recorte do e-MEC ilegível ({'; '.join(erros)})")


def carregar_emec() -> pd.DataFrame:
    """Todos os recortes do e-MEC que estiverem em `data/`, empilhados."""
    partes = []
    for caminho in sorted(bf.DADOS.glob("*.csv")):
        d = _ler_emec(caminho)
        if d is None:
            continue
        d["recorte"] = caminho.name
        partes.append(d)
        print(f"  {caminho.name}: {len(d)} linhas ({d.attrs['codificacao']})")
    if not partes:
        raise SystemExit("nenhum recorte do e-MEC em data/")
    emec = pd.concat(partes, ignore_index=True)
    emec["sig"] = emec["Sigla"].map(sig)
    emec["toks"] = emec["Instituição(IES)"].map(tokens)
    emec["nome_inteiro"] = emec["Instituição(IES)"].map(
        lambda n: k(re.sub(r"\s*\([^)]*\)\s*$", "", str(n)))
    )
    emec["razao_social_k"] = emec["Razão Social"].map(lambda n: k(str(n)))
    print(f"{len(partes)} recorte(s) do e-MEC, {len(emec)} instituições")
    return emec


def casar(
    nome: str, nossa_uf: object, emec: pd.DataFrame
) -> tuple[pd.Series | None, str]:
    """A linha do e-MEC que corresponde a esta instituição, e por qual regra.

    Uma regra só: sigla normalizada e UF iguais, **mais** pelo menos um termo
    distintivo em comum — que é o que impede a Fundação Carlos Chagas de casar
    com a Faculdade Cristã da Cidade, as duas "FCC" em São Paulo.

    O casamento por termos do nome foi tentado e **descartado**. Rendia 8
    pares e 2 estavam errados — a UFJF virava o Centro Universitário Universo
    de Juiz de Fora, a SBMAC virava a Escola de Matemática Aplicada da FGV.
    Apertar não resolveu: com a UF travada, o que sobra de comum entre nomes
    distintos é quase sempre o nome da cidade ou da área, e não dá para
    enumerar as duas coisas. 25% de erro contra 0% do `sigla+UF` não compensa
    oito pares a mais.
    """
    parenteses = re.findall(r"\(([^)]+)\)", nome or "")
    nossa_sig = sig(parenteses[-1]) if parenteses else ""
    toks = tokens(nome)

    if nossa_sig:
        c = emec[emec.sig.eq(nossa_sig)]
        if len(c) and toks:
            c = c[c["toks"].map(lambda t, alvo=toks: bool(t & alvo) or not t)]
        if len(c) and pd.notna(nossa_uf) and c.UF.eq(nossa_uf).any():
            return c[c.UF.eq(nossa_uf)].iloc[0], "sigla+UF"
        if len(c) == 1 and pd.isna(nossa_uf):
            return c.iloc[0], "sigla"
        # Sigla certa e UF ausente **no e-MEC**: a UNEB tem 36 linhas, uma por
        # campus, e nenhuma delas traz UF. Não dá para escolher a linha, mas
        # não é preciso — a verificação quer a classificação, não o campus, e
        # se as 36 concordam no enquadramento a resposta é a mesma qualquer
        # que seja a escolhida. Discordando, não casa.
        if len(c) and c.UF.isna().all():
            enquadramentos = {
                frozenset(
                    esperado_para(
                        linha["Categoria Administrativa"],
                        linha["Natureza Jurídica"],
                        linha["Organização Acadêmica"],
                    )
                )
                for _, linha in c.iterrows()
            }
            if len(enquadramentos) == 1:
                return c.iloc[0], "sigla, e-MEC sem UF"

    # Nome idêntico. A comparação é do **nome inteiro** normalizado, e não dos
    # termos distintivos: "Universidade Estadual do Ceará" reduz a
    # `{estadual}` depois da lista de parada e casaria com a da Paraíba; o
    # nome inteiro não tem esse problema.
    #
    # Vale **mesmo quando temos sigla** e ela não casou, porque sigla é o que
    # mais varia entre os dois cadastros: a PUC de Goiás é `PUC-GO` para nós e
    # `PUC GOIÁS` no e-MEC, a Mackenzie é `UPM` e `MACKENZIE`, a Anhembi
    # Morumbi é `ANHEMBI` e `UAM`. Em todas o nome completo é o mesmo.
    #
    # E a regra continua recusando o que deve: "Faculdade Santo Agostinho" não
    # é "Centro Universitário Santo Agostinho", nem "Universidade Vale do Rio
    # Verde" é "Faculdade Verde Norte" — pares que o jaccard dava como 1,00
    # porque "faculdade" e "universidade" estão na lista de parada. Exigir o
    # nome inteiro separa os dois casos sem precisar de limiar.
    if True:
        inteiro = k(re.sub(r"\s*\([^)]*\)\s*$", "", nome or ""))
        c = emec[emec["nome_inteiro"].eq(inteiro)]
        if len(c) == 1:
            return c.iloc[0], "nome exato"
        if len(c) > 1 and pd.notna(nossa_uf) and c.UF.eq(nossa_uf).any():
            return c[c.UF.eq(nossa_uf)].iloc[0], "nome exato+UF"
    # Última tentativa, e a mais fraca: a `Razão Social`, que é o nome legal da
    # **mantenedora**. Ela responde outra pergunta — diz que a entidade mantém
    # uma IES, não que ela é uma. A Associação Paulista de Medicina mantém a
    # "Faculdade da Associação Médica Paulista" e continua sendo sociedade
    # científica; o ICMBio mantém a ACADEBio e continua sendo órgão de
    # governo. Por isso o casamento entra registrado e **não conta como
    # verificação do tipo**: usá-lo para corrigir `institution_type` seria
    # erro de categoria, não ganho de cobertura.
    inteiro = k(re.sub(r"\s*\([^)]*\)\s*$", "", nome or ""))
    c = emec[emec["razao_social_k"].eq(inteiro)]
    if len(c):
        return c.iloc[0], "razão social (mantenedora)"
    return None, "não casou"


def fins_lucrativos(nome: str, nossa_uf: object, emec: pd.DataFrame) -> object:
    """`S`, `N` ou vazio, pelo recorte do e-MEC em que a instituição está.

    Vazio é **não apurado**, e é o estado de quem não casou com recorte
    nenhum. Os recortes que você exportou cobrem parte do universo; ausência
    de todos eles não diz nada sobre a instituição.
    """
    achado, _ = casar(nome, nossa_uf, emec)
    if achado is None:
        return pd.NA
    natureza = str(achado["Natureza Jurídica"] or "")
    categoria = str(achado["Categoria Administrativa"] or "")
    if "Com fins" in natureza or categoria == "Privada com fins lucrativos":
        return "S"
    if "Sem fins" in natureza or "sem fins" in natureza or "sem fins" in categoria:
        return "N"
    return pd.NA  # pública: a pergunta não se aplica


def ufs_das_instituicoes() -> pd.Series:
    """A UF de cada instituição, pela moda das fontes dela."""
    base = bf.ler()
    return (
        base.dropna(subset=["subdivision_code"])
        .groupby("institution_name")["subdivision_code"]
        .agg(lambda s: s.mode().iloc[0])
        .str.slice(3)
    )


def conferir() -> pd.DataFrame:
    emec = carregar_emec()
    base = bf.ler()
    uf = ufs_das_instituicoes()
    inst = pd.read_csv(bf.DADOS / "instituicoes.csv", dtype="str")
    inst = inst.join(
        base.groupby("institution_name").size().rename("fontes"), on="institution_name"
    )
    inst["uf"] = inst.institution_name.map(uf)

    linhas = []
    for r in inst.itertuples():
        achado, como = casar(r.institution_name, r.uf, emec)
        nossa_uf = r.uf
        # O casamento por mantenedora informa, mas não julga: `confere` fica
        # vazio nele, e a linha entra no CSV com o que a mantenedora mantém.
        codigos = (
            set()
            if como.startswith("razão social")
            else (
                esperado_para(
                    achado["Categoria Administrativa"],
                    achado["Natureza Jurídica"],
                    achado["Organização Acadêmica"],
                )
                if achado is not None
                else set()
            )
        )
        linhas.append(
            {
                "institution_name": r.institution_name,
                "nosso_tipo": r.institution_type,
                "uf": nossa_uf,
                "fontes": r.fontes,
                "como": como,
                "recorte": achado["recorte"] if achado is not None else "",
                "mec_nome": achado["Instituição(IES)"] if achado is not None else "",
                "mec_categoria": achado["Categoria Administrativa"]
                if achado is not None
                else "",
                "mec_natureza": achado["Natureza Jurídica"]
                if achado is not None
                else "",
                "esperado": " | ".join(sorted(codigos)),
                "confere": r.institution_type in codigos if codigos else pd.NA,
            }
        )
    return pd.DataFrame(linhas)


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("--divergem", action="store_true", help="só o que não bate")
    opcoes = argumentos.parse_args()

    quadro = conferir()
    quadro.to_csv(SAIDA, index=False)

    casadas = quadro[quadro.confere.notna()]
    divergem = casadas[~casadas.confere.astype(bool)]

    if opcoes.divergem:
        print(
            divergem[
                [
                    "institution_name",
                    "nosso_tipo",
                    "esperado",
                    "mec_categoria",
                    "mec_natureza",
                    "como",
                    "fontes",
                ]
            ].to_string(index=False)
        )
        return 0

    print(
        f"\n{len(quadro)} instituições nossas | casaram: {len(casadas)} ({casadas.fontes.sum()} observações)"
    )
    print(quadro.como.value_counts().to_string())
    print(f"\nconferem: {int(casadas.confere.sum())} | divergem: {len(divergem)}")
    if len(divergem):
        print("\ndivergências:")
        print(
            divergem[
                ["institution_name", "nosso_tipo", "esperado", "mec_natureza", "fontes"]
            ].to_string(index=False, max_colwidth=40)
        )
    print(f"\n{SAIDA.name}: gravado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
