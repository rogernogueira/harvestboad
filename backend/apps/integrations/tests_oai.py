"""Testes da resolução do link público de um registro.

Como em `tests.py`, a origem é um servidor HTTP real: o que se quer verificar é
o GetRecord como ele sai na rede e o XML como ele chega, não um mock combinado
com a própria implementação.
"""

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Profile

from .oai import suggested_link

User = get_user_model()

RECEIVED: list[dict] = []

OAI_CONFIG = {"TIMEOUT": 5, "MAX_BYTES": 1024 * 1024, "CACHE_TTL_LINK": 60}

ENVELOPE = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <responseDate>2026-01-01T00:00:00Z</responseDate>
  <request verb="GetRecord">{base}</request>
  <GetRecord><record>
    <header><identifier>oai:repo.br:artigo/1</identifier></header>
    <metadata>{metadata}</metadata>
  </record></GetRecord>
</OAI-PMH>"""

DUBLIN_CORE = """
    <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
               xmlns:dc="http://purl.org/dc/elements/1.1/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.w3.org/2001/XMLSchema">
      <dc:format>application/pdf</dc:format>
      <dc:identifier>https://revista.br/index.php/rev/article/download/1/2</dc:identifier>
      <dc:identifier>https://revista.br/index.php/rev/article/view/1</dc:identifier>
    </oai_dc:dc>
"""

SEM_URL = """
    <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
               xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>Sem endereço</dc:title>
    </oai_dc:dc>
"""

DSPACE = """
    <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
               xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:identifier>https://hdl.handle.net/11612/1234</dc:identifier>
      <dc:identifier>https://repositorio.uft.edu.br/jspui/handle/11612/1234</dc:identifier>
    </oai_dc:dc>
"""

DATACITE_DOI_CRU = """
    <resource xmlns="http://datacite.org/schema/kernel-4">
      <identifier identifierType="DOI">10.48472/deposita/0BYR5E</identifier>
    </resource>
"""

ERRO_FORMATO = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <error code="cannotDisseminateFormat">prefixo não suportado</error>
</OAI-PMH>"""

ERRO_FORMATO_ID = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <error code="badArgument">Identifier is not in a valid format</error>
</OAI-PMH>"""

ERRO_ID = """<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <error code="idDoesNotExist">sem registro</error>
</OAI-PMH>"""


# Páginas de item que "existem" neste repositório de mentira. Tudo o que não
# estiver aqui responde 404 — é isso que permite testar a confirmação da URL
# derivada, que precisa distinguir palpite certo de palpite errado.
PAGINAS = {
    "/revista/article/view/1315",
    "/dspace/handle/riufs/10820",
    "/canonico/handle/11612/5191",
}

# Caminho que só responde atrás de um redirecionamento — o equivalente local do
# `http` cadastrado que o repositório manda para o endereço canônico.
REDIRECIONAMENTOS = {"/movido/handle/11612/5191": "/canonico/handle/11612/5191"}

# Endpoints OAI e o que cada um responde.
ROTAS_OAI = {
    "/oai-vazio": lambda: ENVELOPE.format(base=BASE_FALSA, metadata=SEM_URL),
    "/oai-datacite": lambda: ENVELOPE.format(base=BASE_FALSA, metadata=DATACITE_DOI_CRU),
    "/oai-dspace": lambda: ENVELOPE.format(base=BASE_FALSA, metadata=DSPACE),
    "/oai-sem-registro": lambda: ERRO_ID,
    # Derivação: o GetRecord falha, mas a página do item está no ar.
    "/revista/oai": lambda: ERRO_FORMATO_ID,
    "/dspace/oai/request": lambda: ERRO_ID,
    "/perdida/oai": lambda: ERRO_ID,
    "/movido/oai/request": lambda: ERRO_ID,
}

BASE_FALSA = "http://origem.local/oai"


class _Handler(BaseHTTPRequestHandler):
    def _responder(self, corpo: bytes | None, status: int, com_corpo: bool) -> None:
        self.send_response(status)
        if status == 301 and corpo:
            self.send_header("Location", corpo.decode())
            self.end_headers()
            return
        self.send_header("Content-Type", "text/xml; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo or b"")))
        self.end_headers()
        if com_corpo and corpo:
            self.wfile.write(corpo)

    def _resolver(self) -> tuple[bytes | None, int]:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        RECEIVED.append({"path": parsed.path, "query": query})

        if parsed.path in PAGINAS:
            return b"<html></html>", 200

        destino = REDIRECIONAMENTOS.get(parsed.path)
        if destino:
            return destino.encode(), 301

        rota = ROTAS_OAI.get(parsed.path)
        if rota:
            return rota().encode(), 200

        if parsed.path != "/oai":
            return None, 404

        prefix = (query.get("metadataPrefix") or [""])[0]
        identifier = (query.get("identifier") or [""])[0]
        if identifier == "oai:repo.br:ausente":
            corpo = ERRO_ID
        elif prefix != "oai_dc":
            # Só serve Dublin Core; qualquer outro prefixo é recusado pelo
            # protocolo, e não com 404.
            corpo = ERRO_FORMATO
        else:
            corpo = ENVELOPE.format(base=BASE_FALSA, metadata=DUBLIN_CORE)
        return corpo.encode(), 200

    def do_GET(self) -> None:  # noqa: N802 (assinatura da stdlib)
        corpo, status = self._resolver()
        self._responder(corpo, status, com_corpo=True)

    def do_HEAD(self) -> None:  # noqa: N802 (assinatura da stdlib)
        corpo, status = self._resolver()
        self._responder(corpo, status, com_corpo=False)

    def log_message(self, *args) -> None:
        pass


@override_settings(OAI=OAI_CONFIG)
class SuggestedLinkTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.server = HTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.raiz = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.base_url = f"{cls.raiz}/oai"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        super().tearDownClass()

    def setUp(self) -> None:
        RECEIVED.clear()
        cache.clear()

    def test_identificador_doi_resolve_sem_rede(self) -> None:
        resultado = suggested_link(
            "doi:10.48472/deposita/0BYR5E", self.base_url, "oai_datacite"
        )
        self.assertEqual(resultado["link"], "https://doi.org/10.48472/deposita/0BYR5E")
        self.assertEqual(resultado["source"], "identifier")
        self.assertEqual(RECEIVED, [])

    def test_get_record_sai_com_verbo_identificador_e_prefixo(self) -> None:
        suggested_link("oai:repo.br:artigo/1", self.base_url)
        self.assertEqual(RECEIVED[-1]["path"], "/oai")
        self.assertEqual(
            RECEIVED[-1]["query"],
            {
                "verb": ["GetRecord"],
                "identifier": ["oai:repo.br:artigo/1"],
                "metadataPrefix": ["oai_dc"],
            },
        )

    def test_pagina_do_item_vence_o_link_de_download(self) -> None:
        """Ordem de preferência, não ordem de aparição: o download vem antes no XML."""
        resultado = suggested_link("oai:repo.br:artigo/1", self.base_url)
        self.assertEqual(
            resultado["link"], "https://revista.br/index.php/rev/article/view/1"
        )
        self.assertEqual(resultado["source"], "record:ojs")

    def test_url_de_namespace_e_do_request_nao_sao_candidatas(self) -> None:
        """O `<request>` traz o próprio baseURL — uma URL válida que não é o registro."""
        resultado = suggested_link("oai:repo.br:artigo/1", self.base_url)
        self.assertNotIn("http://origem.local/oai", resultado["candidates"])
        for candidata in resultado["candidates"]:
            self.assertNotIn("w3.org", candidata)
            self.assertNotIn("openarchives.org", candidata)

    def test_handle_local_vence_o_resolvedor_global(self) -> None:
        """`/handle/` é a página no repositório; `hdl.handle.net` só redireciona
        para ela, com um salto a mais e dependente de serviço de terceiros."""
        base = self.base_url.replace("/oai", "/oai-dspace")
        resultado = suggested_link("oai:repo.br:11612/1234", base)
        self.assertEqual(
            resultado["link"], "https://repositorio.uft.edu.br/jspui/handle/11612/1234"
        )
        self.assertEqual(resultado["source"], "record:dspace")
        # O resolvedor aparece antes no XML: a escolha é por prioridade, não por ordem.
        self.assertEqual(resultado["candidates"][0], "https://hdl.handle.net/11612/1234")

    def test_doi_cru_no_metadado_vira_url(self) -> None:
        base = self.base_url.replace("/oai", "/oai-datacite")
        resultado = suggested_link("oai:repo.br:deposita/1", base)
        self.assertEqual(resultado["link"], "https://doi.org/10.48472/deposita/0BYR5E")
        self.assertEqual(resultado["source"], "record:doi")

    def test_prefixo_recusado_cai_para_oai_dc(self) -> None:
        resultado = suggested_link("oai:repo.br:artigo/1", self.base_url, "oai_datacite")
        self.assertEqual(
            resultado["link"], "https://revista.br/index.php/rev/article/view/1"
        )
        prefixos = [r["query"]["metadataPrefix"][0] for r in RECEIVED]
        self.assertEqual(prefixos, ["oai_datacite", "oai_dc"])

    def test_erro_oai_sem_doi_no_id_volta_com_motivo(self) -> None:
        resultado = suggested_link("oai:repo.br:ausente", self.base_url)
        self.assertIsNone(resultado["link"])
        self.assertEqual(resultado["reason"], "oai-error:idDoesNotExist")

    def test_metadado_sem_url_volta_com_motivo(self) -> None:
        base = self.base_url.replace("/oai", "/oai-vazio")
        resultado = suggested_link("oai:repo.br:artigo/1", base)
        self.assertIsNone(resultado["link"])
        self.assertEqual(resultado["reason"], "no-usable-url")

    def test_deriva_pagina_do_ojs_quando_o_id_envelheceu(self) -> None:
        """OJS recusa o id do host antigo (`badArgument`), mas a página continua no ar.

        O domínio vem do baseURL, não do identificador: é justamente a troca de
        domínio que faz o id guardado na coleta parar de funcionar.
        """
        base = self.base_url.replace("/oai", "/revista/oai")
        resultado = suggested_link("oai:ojs2.host-antigo.br:article/1315", base)
        self.assertEqual(resultado["link"], f"{self.raiz}/revista/article/view/1315")
        self.assertEqual(resultado["source"], "derived:ojs")

    def test_deriva_handle_do_dspace_quando_o_get_record_nao_acha(self) -> None:
        """Há origens cujo GetRecord responde `idDoesNotExist` até para o que listam."""
        base = self.base_url.replace("/oai", "/dspace/oai/request")
        resultado = suggested_link("oai:oai:ri.ufs.br:repo_01:riufs/10820", base, "xoai")
        self.assertEqual(resultado["link"], f"{self.raiz}/dspace/handle/riufs/10820")
        self.assertEqual(resultado["source"], "derived:dspace")

    def test_derivacao_devolve_o_endereco_final_e_nao_o_palpite(self) -> None:
        """O baseURL cadastrado costuma ser http e o repositório manda para https.

        Devolver o palpite faria o usuário atravessar o redirecionamento a cada
        visita, e guardaria no cache um endereço que não é o canônico.
        """
        base = self.base_url.replace("/oai", "/movido/oai/request")
        resultado = suggested_link("oai:repo.br:11612/5191", base, "xoai")
        self.assertEqual(resultado["link"], f"{self.raiz}/canonico/handle/11612/5191")
        self.assertEqual(resultado["source"], "derived:dspace")

    def test_metadado_vence_a_derivacao(self) -> None:
        """A derivação é último recurso; havendo endereço no metadado, ele manda."""
        resultado = suggested_link("oai:repo.br:article/1", self.base_url)
        self.assertEqual(resultado["source"], "record:ojs")

    def test_origem_inacessivel_extrai_doi_do_identificador(self) -> None:
        """A rede até as origens cai; o DOI no texto do id ainda resolve o link."""
        resultado = suggested_link(
            "oai:repo.br:10.1590/abc123", "http://127.0.0.1:9/oai"
        )
        self.assertEqual(resultado["link"], "https://doi.org/10.1590/abc123")
        self.assertEqual(resultado["source"], "identifier")

    def test_host_morto_devolve_palpite_marcado_sem_segundo_timeout(self) -> None:
        """A URL derivada mora no mesmo host e porta que acabou de não atender.

        Perguntar por ela custaria outro timeout inteiro para chegar à mesma
        conclusão. E não alcançar a rede não diz nada sobre o link: diz que
        este servidor não chega lá — quem abrir no navegador pode chegar.
        """
        with patch("apps.integrations.oai._confirmar") as confirmar:
            resultado = suggested_link("oai:repo.br:article/1", "http://127.0.0.1:9/oai")
        confirmar.assert_not_called()
        self.assertEqual(resultado["link"], "http://127.0.0.1:9/article/view/1")
        self.assertEqual(resultado["source"], "derived-unverified:ojs")
        # O motivo acompanha o link não verificado: é o que explica a marca.
        self.assertEqual(resultado["reason"], "unreachable")

    def test_pagina_que_responde_404_nao_vira_link(self) -> None:
        """Aqui a origem respondeu e negou: o palpite estava errado mesmo."""
        base = self.base_url.replace("/oai", "/perdida/oai")
        resultado = suggested_link("oai:host.br:article/999", base)
        self.assertIsNone(resultado["link"])
        self.assertEqual(resultado["reason"], "oai-error:idDoesNotExist")

    def test_confirmacao_distingue_os_tres_desfechos(self) -> None:
        from apps.integrations.oai import _confirmar

        existe = f"{self.raiz}/revista/article/view/1315"
        self.assertEqual(_confirmar(existe), (existe, True))
        # Servidor respondeu que não existe -> palpite descartado.
        self.assertIsNone(_confirmar(f"{self.raiz}/nao-existe"))
        # Não deu para perguntar -> palpite segue, marcado como não verificado.
        self.assertEqual(
            _confirmar("http://127.0.0.1:9/handle/1/2"),
            ("http://127.0.0.1:9/handle/1/2", False),
        )

    def test_origem_inacessivel_sem_nada_derivavel_volta_unreachable(self) -> None:
        """Identificador sem "/" na cauda não tem forma de item para derivar."""
        resultado = suggested_link("oai:repo.br:artigo", "http://127.0.0.1:9/oai")
        self.assertIsNone(resultado["link"])
        self.assertEqual(resultado["reason"], "unreachable")

    def test_resposta_maior_que_o_teto_nao_derruba(self) -> None:
        with override_settings(OAI={**OAI_CONFIG, "MAX_BYTES": 10}):
            resultado = suggested_link("oai:repo.br:artigo/1", self.base_url)
        self.assertIsNone(resultado["link"])
        self.assertEqual(resultado["reason"], "unreachable")

    def test_link_resolvido_e_cacheado(self) -> None:
        suggested_link("oai:repo.br:artigo/1", self.base_url)
        suggested_link("oai:repo.br:artigo/1", self.base_url)
        self.assertEqual(len(RECEIVED), 1)

    def test_falha_nao_e_cacheada(self) -> None:
        """Origem instável não pode fixar "sem link" por toda a janela do TTL."""
        base = self.base_url.replace("/oai", "/oai-vazio")
        suggested_link("oai:repo.br:artigo/1", base)
        suggested_link("oai:repo.br:artigo/1", base)
        self.assertEqual(len(RECEIVED), 2)


@override_settings(OAI=OAI_CONFIG)
class RecordLinkViewTests(TestCase):
    """Rota `/api/v1/oai/record-link`: contrato com o frontend.

    O resolvedor é dublado aqui — o que se verifica é autenticação, validação
    da entrada e o formato da resposta, não a heurística, que tem testes
    próprios acima.
    """

    RESOLVER = "apps.integrations.views.suggested_link"
    BASE = "/api/v1/oai/record-link"
    ORIGEM = "https://revista.br/oai"

    @classmethod
    def setUpTestData(cls) -> None:
        cls.user = User.objects.create_user(
            username="gestor", email="g@uft.edu.br", password="x", profile=Profile.GESTOR
        )

    def api(self) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=self.user)
        return client

    def test_exige_autenticacao(self) -> None:
        resposta = APIClient().get(
            self.BASE, {"oaiId": "oai:repo.br:1", "baseUrl": self.ORIGEM}
        )
        self.assertEqual(resposta.status_code, 401)

    def test_resolve_e_ecoa_o_identificador(self) -> None:
        resolvido = {
            "link": "https://revista.br/article/view/1",
            "source": "record:ojs",
            "reason": None,
            "candidates": ["https://revista.br/article/view/1"],
        }
        with patch(self.RESOLVER, return_value=resolvido) as resolver:
            resposta = self.api().get(
                self.BASE, {"oaiId": "oai:repo.br:artigo/1", "baseUrl": self.ORIGEM}
            )
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.json(), {"oaiId": "oai:repo.br:artigo/1", **resolvido})
        resolver.assert_called_once_with(
            oai_id="oai:repo.br:artigo/1", base_url=self.ORIGEM, prefix="oai_dc"
        )

    def test_aceita_os_nomes_em_snake_case(self) -> None:
        with patch(self.RESOLVER, return_value={"link": None, "source": None, "reason": "unreachable", "candidates": []}) as resolver:
            resposta = self.api().get(
                self.BASE,
                {
                    "oai_id": "doi:10.48472/deposita/0BYR5E",
                    "base_url": self.ORIGEM,
                    "prefix": "oai_datacite",
                },
            )
        self.assertEqual(resposta.status_code, 200)
        resolver.assert_called_once_with(
            oai_id="doi:10.48472/deposita/0BYR5E",
            base_url=self.ORIGEM,
            prefix="oai_datacite",
        )

    def test_sem_link_ainda_responde_200(self) -> None:
        """Origem fora do ar não é erro desta API: a tela decide o que mostrar."""
        resolvido = {"link": None, "source": None, "reason": "unreachable", "candidates": []}
        with patch(self.RESOLVER, return_value=resolvido):
            resposta = self.api().get(
                self.BASE, {"oaiId": "oai:repo.br:1", "baseUrl": self.ORIGEM}
            )
        self.assertEqual(resposta.status_code, 200)
        self.assertIsNone(resposta.json()["link"])
        self.assertEqual(resposta.json()["reason"], "unreachable")

    def test_base_url_invalida_e_400(self) -> None:
        for invalida in ("file:///etc/passwd", "nao-e-url", "ftp://origem.br/oai"):
            with self.subTest(invalida=invalida):
                resposta = self.api().get(
                    self.BASE, {"oaiId": "oai:repo.br:1", "baseUrl": invalida}
                )
                self.assertEqual(resposta.status_code, 400)

    def test_parametros_obrigatorios(self) -> None:
        resposta = self.api().get(self.BASE, {"oaiId": "oai:repo.br:1"})
        self.assertEqual(resposta.status_code, 400)
        self.assertIn("base_url", resposta.json())
