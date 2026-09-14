"""Testes do cliente do Harvester contra um servidor HTTP local.

Um servidor real (em vez de mock) garante que o Basic auth, a montagem de
caminhos e os parâmetros de consulta cheguem exatamente como esperado.
"""

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from django.test import SimpleTestCase, override_settings

from .harvester import HarvesterClient, HarvesterError

RECEIVED: list[dict] = []


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (assinatura da stdlib)
        parsed = urlparse(self.path)
        RECEIVED.append(
            {
                "path": parsed.path,
                "raw_path": self.path.split("?")[0],
                "query": parse_qs(parsed.query),
                "auth": self.headers.get("Authorization"),
            }
        )

        if parsed.path.startswith("/public/getRecordMetadataBySnapshotAndIdentifier"):
            body, content_type = b"<record><id>1</id></record>", "application/xml"
        elif parsed.path == "/boom":
            self.send_response(500)
            self.end_headers()
            return
        else:
            body, content_type = json.dumps([{"id": 1}]).encode(), "application/json"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:
        pass


class HarvesterClientTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.server = HTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        super().tearDownClass()

    def setUp(self) -> None:
        RECEIVED.clear()
        self.client_ = HarvesterClient(
            base_url=self.base_url, user="admin", password="s3nha", timeout=5
        )

    def last(self) -> dict:
        return RECEIVED[-1]

    def test_envia_basic_auth(self) -> None:
        self.client_.list_networks()
        expected = base64.b64encode(b"admin:s3nha").decode()
        self.assertEqual(self.last()["auth"], f"Basic {expected}")

    def test_lista_repositorios(self) -> None:
        self.client_.list_networks()
        self.assertEqual(self.last()["path"], "/private/networks")

    def test_lista_repositorios_via_rest(self) -> None:
        self.client_.list_networks_rest(page=2, size=5)
        self.assertEqual(self.last()["path"], "/rest/network")
        self.assertEqual(self.last()["query"], {"page": ["2"], "size": ["5"]})

    def test_dados_do_repositorio(self) -> None:
        self.client_.get_network(42)
        self.assertEqual(self.last()["path"], "/rest/network/42")

    def test_historico_de_coletas(self) -> None:
        self.client_.list_snapshots(42)
        self.assertEqual(self.last()["path"], "/rest/snapshot/search/findByNetworkIdOrdered")
        self.assertEqual(self.last()["query"], {"network_id": ["42"]})

    def test_diagnostico(self) -> None:
        self.client_.get_diagnose("snap-1")
        self.assertEqual(self.last()["path"], "/public/diagnose/snap-1")

    def test_ocorrencias_por_regra(self) -> None:
        self.client_.list_validation_occurrences("snap-1", 7)
        self.assertEqual(
            self.last()["path"], "/public/diagnoseValidationOcurrences/snap-1/7"
        )

    def test_registros_individuais_com_paginacao(self) -> None:
        self.client_.list_record_validation_results("snap-1", page=3, count=50)
        self.assertEqual(
            self.last()["path"], "/public/diagnoseListRecordValidationResults/snap-1/fq"
        )
        self.assertEqual(self.last()["query"], {"page": ["3"], "count": ["50"]})

    def test_xml_do_registro_volta_como_texto(self) -> None:
        xml = self.client_.get_record_metadata("snap-1", "oai:repo.br:123/456")
        self.assertEqual(xml, "<record><id>1</id></record>")
        # Escape duplo: o Tomcat do Harvester recusa %2F simples no caminho (400)
        # e decodifica uma vez antes de rotear.
        self.assertEqual(
            self.last()["raw_path"],
            "/public/getRecordMetadataBySnapshotAndIdentifier/snap-1/oai%253Arepo.br%253A123%252F456",
        )
        # Depois da primeira decodificação sobra o escape simples, num único segmento.
        self.assertEqual(
            unquote(self.last()["raw_path"]),
            "/public/getRecordMetadataBySnapshotAndIdentifier/snap-1/oai%3Arepo.br%3A123%2F456",
        )

    def test_erro_http_vira_harvester_error_com_status(self) -> None:
        with self.assertRaises(HarvesterError) as ctx:
            self.client_.get_json("/boom")
        self.assertEqual(ctx.exception.status_code, 500)

    def test_resposta_de_erro_nao_e_repetida(self) -> None:
        """Um 500 é determinístico: repetir só gastaria tempo."""
        RECEIVED.clear()
        with self.assertRaises(HarvesterError):
            self.client_.get_json("/boom")
        self.assertEqual(len(RECEIVED), 1)

    def test_falha_de_transporte_e_repetida(self) -> None:
        """Porta fechada: erro de transporte, repetido até esgotar o orçamento."""
        cliente = HarvesterClient(
            base_url="http://127.0.0.1:9", user="a", password="b", timeout=1, retries=2
        )
        with self.assertRaises(HarvesterError) as ctx:
            cliente.get_json("/qualquer")
        self.assertIn("3 tentativa(s)", str(ctx.exception))

    def test_retry_desiste_no_orcamento_configurado(self) -> None:
        cliente = HarvesterClient(
            base_url="http://127.0.0.1:9", user="a", password="b", timeout=1, retries=0
        )
        with self.assertRaises(HarvesterError) as ctx:
            cliente.get_json("/qualquer")
        self.assertIn("1 tentativa(s)", str(ctx.exception))

    @override_settings(HARVESTER={"BASE_URL": "", "USER": "", "PASSWORD": "", "TIMEOUT": 5, "RETRIES": 0, "RETRY_BACKOFF": 0})
    def test_base_url_ausente_falha_cedo(self) -> None:
        with self.assertRaises(HarvesterError):
            HarvesterClient()
