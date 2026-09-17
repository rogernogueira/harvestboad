"""Cliente HTTP do Harvester (IBICT).

O serviço usa autenticação HTTP básica. Este módulo concentra base URL,
credenciais, timeout e tratamento de erro para que as apps de domínio não
falem HTTP diretamente.
"""

import time
from typing import Any
from urllib.parse import quote

import httpx
from django.conf import settings


class HarvesterError(RuntimeError):
    """Falha ao conversar com o Harvester (rede, timeout ou status HTTP)."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class HarvesterClient:
    def __init__(
        self,
        base_url: str | None = None,
        user: str | None = None,
        password: str | None = None,
        timeout: float | None = None,
        retries: int | None = None,
    ) -> None:
        config = settings.HARVESTER
        self.base_url = (base_url if base_url is not None else config["BASE_URL"]).rstrip("/")
        self.user = user if user is not None else config["USER"]
        self.password = password if password is not None else config["PASSWORD"]
        self.timeout = timeout if timeout is not None else config["TIMEOUT"]
        self.retries = retries if retries is not None else config["RETRIES"]
        self.retry_backoff = config["RETRY_BACKOFF"]

        if not self.base_url:
            raise HarvesterError("HARVESTER_BASE_URL não configurada no .env.")

    @property
    def _auth(self) -> httpx.BasicAuth | None:
        if self.user:
            return httpx.BasicAuth(self.user, self.password)
        return None

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        """Executa a requisição, repetindo apenas em falha de transporte.

        A rede até o Harvester perde uma fração alta das conexões
        ("No route to host"), a ponto de uma única tentativa tornar operações
        com vários repositórios inviáveis. Já uma resposta HTTP de erro é
        determinística: repetir um 404 ou um 500 só gasta tempo, então esses
        propagam na primeira ocorrência.
        """
        url = f"{self.base_url}/{path.lstrip('/')}"
        ultima: Exception | None = None

        for tentativa in range(self.retries + 1):
            try:
                with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
                    response = client.request(method, url, auth=self._auth, **kwargs)
                    response.raise_for_status()
                    return response
            except httpx.HTTPStatusError as exc:
                raise HarvesterError(
                    f"Harvester respondeu {exc.response.status_code} em {method} {url}",
                    status_code=exc.response.status_code,
                ) from exc
            except httpx.HTTPError as exc:
                ultima = exc
                if tentativa < self.retries:
                    time.sleep(self.retry_backoff * (2**tentativa))

        raise HarvesterError(
            f"Falha de comunicação com o Harvester após "
            f"{self.retries + 1} tentativa(s): {ultima}"
        ) from ultima

    def get_json(self, path: str, **kwargs: Any) -> Any:
        response = self._request("GET", path, headers={"Accept": "application/json"}, **kwargs)
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise HarvesterError(
                f"Resposta não-JSON em GET {path}: {response.text[:120]}"
            ) from exc

    def get_text(self, path: str, **kwargs: Any) -> str:
        return self._request("GET", path, **kwargs).text

    # --- Endpoints do Harvester ---------------------------------------------

    def list_networks(
        self,
        page: int = 1,
        count: int = 25,
        filter_field: str | None = None,
        filter_value: str | None = None,
        sort_field: str | None = None,
        sort_direction: str = "asc",
    ) -> Any:
        """Lista de repositórios. GET /private/networks

        É a mesma rota que a interface do próprio Harvester usa, e devolve por
        repositório os dados da última coleta (`lstSnapshot*`) além do cadastro.

        `page` e `count` são **obrigatórios**: sem eles a rota responde 500 —
        não é indisponibilidade, é parâmetro faltando.

        Filtros e ordenação seguem a convenção do ng-table usada na origem:
        `filter[acronym]`, `filter[name]`, `filter[institution]`,
        `filter[status]` e `sorting[campo]=asc|desc`. O filtro de nome ignora
        maiúsculas mas **não** ignora acentos.
        """
        params: dict[str, Any] = {"page": page, "count": count}
        if filter_field and filter_value:
            params[f"filter[{filter_field}]"] = filter_value
        if sort_field:
            params[f"sorting[{sort_field}]"] = sort_direction
        return self.get_json("/private/networks", params=params)

    def list_networks_rest(self, page: int = 0, size: int = 20) -> Any:
        """Alternativa funcional à rota acima. GET /rest/network

        Devolve o envelope HAL do Spring Data REST (`_embedded.network`).
        """
        return self.get_json("/rest/network", params={"page": page, "size": size})

    def search_networks_by_name(self, term: str, page: int = 0, size: int = 20) -> Any:
        """Busca por nome. GET /rest/network/search/findByNameIgnoreCaseContaining

        Ignora maiúsculas, mas **não** ignora acentos: "ceramica" não encontra
        "Cerâmica". Limitação da origem.
        """
        return self.get_json(
            "/rest/network/search/findByNameIgnoreCaseContaining",
            params={"name": term, "page": page, "size": size},
        )

    def search_networks_by_acronym(self, term: str, page: int = 0, size: int = 20) -> Any:
        """Busca por sigla. GET /rest/network/search/findByAcronymIgnoreCaseContaining

        O parâmetro se chama `filterExpression`, não `acronym`: passar `acronym`
        faz a origem responder 500.
        """
        return self.get_json(
            "/rest/network/search/findByAcronymIgnoreCaseContaining",
            params={"filterExpression": term, "page": page, "size": size},
        )

    def search_networks_by_institution(self, term: str, page: int = 0, size: int = 20) -> Any:
        """Busca por instituição.

        GET /rest/network/search/findByInstitutionNameIgnoreCaseContaining
        """
        return self.get_json(
            "/rest/network/search/findByInstitutionNameIgnoreCaseContaining",
            params={"institution": term, "page": page, "size": size},
        )

    def get_network(self, network_id: str | int) -> Any:
        """Dados cadastrais do repositório. GET /rest/network/{networkID}"""
        return self.get_json(f"/rest/network/{quote(str(network_id))}")

    def list_snapshots(self, network_id: str | int) -> Any:
        """Histórico de coletas.

        GET /rest/snapshot/search/findByNetworkIdOrdered?network_id={id}
        """
        return self.get_json(
            "/rest/snapshot/search/findByNetworkIdOrdered",
            params={"network_id": str(network_id)},
        )

    def get_diagnose(self, snapshot_id: str | int) -> Any:
        """Diagnóstico da coleta. GET /public/diagnose/{snapshotID}"""
        return self.get_json(f"/public/diagnose/{quote(str(snapshot_id))}")

    def list_validation_occurrences(
        self,
        snapshot_id: str | int,
        rule_id: str | int,
        query: str | None = None,
    ) -> Any:
        """Ocorrências por regra, com filtro opcional.

        GET /public/diagnoseValidationOcurrences/{snapshotID}/{ruleID}[/{fq}]

        O segmento de filtro é a mesma consulta Solr da listagem de registros, e
        recorta as contagens do mesmo jeito: sem filtro a regra 110 da coleta
        108434 conta 527 ocorrências, com `record_is_valid:false` conta 2.

        Ao contrário da listagem, aqui **não existe filtro neutro**: o literal
        "fq" faz a rota responder 500. Sem filtro o segmento simplesmente não
        entra — é o que a interface do próprio Harvester faz.
        """
        path = (
            f"/public/diagnoseValidationOcurrences/"
            f"{quote(str(snapshot_id))}/{quote(str(rule_id))}"
        )
        if query:
            path = f"{path}/{quote(query, safe='')}"
        return self.get_json(path)

    def list_record_validation_results(
        self,
        snapshot_id: str | int,
        page: int = 1,
        count: int = 20,
        query: str = "fq",
        **extra: Any,
    ) -> Any:
        """Registros individuais, com filtro opcional.

        GET /public/diagnoseListRecordValidationResults/{snapshotID}/{fq}?page=1&count=20

        O segmento documentado como `fq` é, na verdade, uma consulta Solr sobre
        os campos indexados (`record_is_valid`, `valid_rules`, `invalid_rules`,
        `record_is_transformed`, `id`). O literal "fq" funciona como filtro
        neutro. Parâmetros de query string são ignorados pelo serviço — o filtro
        precisa mesmo ir no caminho.
        """
        params: dict[str, Any] = {"page": page, "count": count, **extra}
        return self.get_json(
            f"/public/diagnoseListRecordValidationResults/{quote(str(snapshot_id))}"
            f"/{quote(query, safe='')}",
            params=params,
        )

    def get_record_metadata(self, snapshot_id: str | int, identifier: str) -> str:
        """XML transformado do registro.

        GET /public/getRecordMetadataBySnapshotAndIdentifier/{snapshotID}/{identifier}

        O identificador é um único segmento de caminho, mas identificadores OAI
        contêm "/" (ex.: `oai:host:article/1`). Contra o Tomcat do Harvester:

        - barra crua     -> 404 (quebra o roteamento em segmentos extras)
        - escape simples -> 400 (Tomcat recusa %2F em caminho por padrão)
        - escape duplo   -> 200, e é o que a interface do Harvester usa

        **Só a barra leva escape duplo.** Escapar duas vezes o resto também
        devolve 200, mas com o texto "No record found - Probably the diagnose
        report is outdated": depois da única decodificação do Tomcat sobra
        `%3A` no lugar do ":", e o identificador deixa de casar com o indexado.
        Medido em 17/09/2026 contra as coletas 98768 e 108702 — a mesma
        requisição, mudando só o escape dos dois-pontos, devolve o XML.

        É o que a interface dela faz em `rest-url-helper.js`: troca "/" por
        "%2F" e passa o resto por `encodeURI`, que preserva ":" e escapa o "%"
        do escape anterior.

        Retorna texto: a resposta é XML, não JSON.
        """
        # Conjunto seguro do `encodeURI`, menos "/" (já substituído) e menos
        # "%", que precisa virar %25 para o Tomcat decodificar de volta a %2F.
        encoded = quote(str(identifier).replace("/", "%2F"), safe=";,?:@&=+$-_.!~*'()#")
        return self.get_text(
            "/public/getRecordMetadataBySnapshotAndIdentifier/"
            f"{quote(str(snapshot_id))}/{encoded}"
        )
