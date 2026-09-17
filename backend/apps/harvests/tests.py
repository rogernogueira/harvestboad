"""Testes das rotas de coleta.

O Harvester é sempre dublado: a rede real é intermitente e não pode decidir se
a suíte passa.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.integrations.harvester import HarvesterError
from apps.repositories.models import RepositoryAccess

User = get_user_model()

BASE = "/api/v1/harvests"
SNAP = "98768"
IDENT = "oai:ojs2.ojs.brazilianjournals.com.br:article/1"

CLIENT = "apps.harvests.services.HarvesterClient"

NETWORK_PAYLOAD = {
    "acronym": "VERACRUZ-0",
    "name": "Revista Veras",
    "institutionName": "Veracruz",
    "_links": {"self": {"href": "http://h:8090/rest/network/1"}},
}
SNAPSHOT_PAYLOAD = {
    "status": "VALID",
    "indexStatus": "INDEXED",
    "startTime": "2024-06-25 10:00:00",
    "endTime": "2024-06-25 12:10:33",
    "size": 26103,
    "validSize": 26091,
    "transformedSize": 26103,
    "deleted": False,
    "previousSnapshotId": None,
}
DIAGNOSE_PAYLOAD = {
    "size": 26103,
    "validSize": 26091,
    "transformedSize": 26103,
    "rulesByID": {
        "110": {
            "ruleID": 110,
            "name": "Abstract",
            "description": "Verifica dc:description.abstract",
            "quantifier": "ONE_OR_MORE",
            "mandatory": False,
            "validCount": None,
            "invalidCount": 26103,
        },
        "12": {
            "ruleID": 12,
            "name": "Title",
            "description": "Verifica dc:title",
            "quantifier": "ONE",
            "mandatory": True,
            "validCount": 26100,
            "invalidCount": 3,
        },
    },
    "facets": {"record_is_valid": []},
}


def fake_client(**overrides):
    """Duplo do HarvesterClient com apenas os métodos que as rotas usam."""

    class _Fake:
        def get_json(self, path, **kwargs):
            if path.endswith("/network"):
                return NETWORK_PAYLOAD
            return SNAPSHOT_PAYLOAD

        def get_diagnose(self, snapshot_id):
            return DIAGNOSE_PAYLOAD

        def list_record_validation_results(self, snapshot_id, page=1, count=20, **kw):
            return {
                "content": [{"id": f"{snapshot_id}-VERACRUZ-0_abc", "identifier": IDENT}],
                "totalElements": 1,
                "totalPages": 1,
            }

        def get_record_metadata(self, snapshot_id, identifier):
            return "<record><id>1</id></record>"

        def list_validation_occurrences(self, snapshot_id, rule_id, query=None):
            return {
                "validRuleOccrs": [{"value": "ok", "count": 26091}],
                "invalidRuleOccrs": [
                    {"value": "no_occurrences_found", "count": 10},
                    {"value": "malformed", "count": 2},
                ],
            }

    fake = _Fake()
    for name, value in overrides.items():
        setattr(fake, name, value)
    return fake


class HarvestAPITests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="admin", email="a@uft.edu.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="gestor", email="g@uft.edu.br", password="x", profile=Profile.GESTOR
        )
        cls.alheio = User.objects.create_user(
            username="alheio", email="o@uft.edu.br", password="x", profile=Profile.GESTOR
        )
        # gestor tem acesso à rede 1 (dona do snapshot); alheio tem outra rede
        RepositoryAccess.objects.create(
            user=cls.gestor, harvester_repository_id="1", acronym="VERACRUZ-0"
        )
        RepositoryAccess.objects.create(
            user=cls.alheio, harvester_repository_id="99", acronym="OUTRO"
        )

    def setUp(self) -> None:
        cache.clear()

    def api(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # --- Controle de acesso --------------------------------------------------

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().get(f"{BASE}/{SNAP}").status_code, 401)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_gestor_com_vinculo_acessa(self) -> None:
        response = self.api(self.gestor).get(f"{BASE}/{SNAP}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["repository"]["acronym"], "VERACRUZ-0")

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_gestor_sem_vinculo_recebe_403(self) -> None:
        response = self.api(self.alheio).get(f"{BASE}/{SNAP}")
        self.assertEqual(response.status_code, 403)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_admin_acessa_qualquer_coleta(self) -> None:
        self.assertEqual(self.api(self.admin).get(f"{BASE}/{SNAP}").status_code, 200)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_acesso_negado_vale_para_todas_as_rotas(self) -> None:
        for suffix in (
            "",
            "/diagnosis",
            "/rules",
            "/rules/110/occurrences",
            "/records",
            f"/records/{IDENT}",
            f"/records/{IDENT}/xml",
        ):
            with self.subTest(rota=suffix or "detalhe"):
                response = self.api(self.alheio).get(f"{BASE}/{SNAP}{suffix}")
                self.assertEqual(response.status_code, 403)

    # --- Conteúdo das rotas --------------------------------------------------

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_detalhe_da_coleta(self) -> None:
        data = self.api(self.admin).get(f"{BASE}/{SNAP}").data
        self.assertEqual(data["snapshotId"], SNAP)
        self.assertEqual(data["status"], "VALID")
        self.assertEqual(data["size"], 26103)
        self.assertEqual(data["repository"]["harvesterRepositoryId"], "1")

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_diagnostico_calcula_invalidos(self) -> None:
        data = self.api(self.admin).get(f"{BASE}/{SNAP}/diagnosis").data
        self.assertEqual(data["invalidSize"], 12)  # 26103 - 26091
        self.assertEqual(data["ruleCount"], 2)
        self.assertNotIn("rulesByID", data)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_regras_viram_lista_ordenada(self) -> None:
        data = self.api(self.admin).get(f"{BASE}/{SNAP}/rules").data
        self.assertEqual(data["count"], 2)
        self.assertEqual([r["ruleId"] for r in data["results"]], [12, 110])
        self.assertEqual(data["results"][0]["name"], "Title")

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_ocorrencias_por_regra(self) -> None:
        data = self.api(self.admin).get(f"{BASE}/{SNAP}/rules/110/occurrences").data
        self.assertEqual(data["ruleId"], "110")
        self.assertEqual(data["validTotal"], 26091)
        self.assertEqual(data["invalidTotal"], 12)  # 10 + 2
        self.assertEqual(data["invalid"][0]["value"], "no_occurrences_found")
        self.assertEqual(data["filters"]["valid"], None)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_ocorrencias_aceitam_o_vocabulario_de_filtros(self) -> None:
        data = (
            self.api(self.admin)
            .get(f"{BASE}/{SNAP}/rules/110/occurrences?valid=false&invalidRule=110")
            .data
        )
        self.assertEqual(data["filters"]["valid"], "false")
        self.assertEqual(data["filters"]["invalidRule"], ["110"])

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_registros_paginados(self) -> None:
        data = self.api(self.admin).get(f"{BASE}/{SNAP}/records?page=2&count=5").data
        self.assertEqual(data["page"], 2)
        self.assertEqual(data["count"], 5)
        self.assertEqual(data["totalElements"], 1)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_count_e_limitado(self) -> None:
        data = self.api(self.admin).get(f"{BASE}/{SNAP}/records?count=9999").data
        self.assertEqual(data["count"], 200)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_registro_individual_com_barra_no_identificador(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["identifier"], IDENT)

    @patch(CLIENT, lambda *a, **k: fake_client(
        list_record_validation_results=lambda *a, **k: {"content": [], "totalElements": 0, "totalPages": 0}
    ))
    def test_registro_inexistente_404(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}")
        self.assertEqual(response.status_code, 404)

    def test_registro_encontrado_pelo_id_derivado(self) -> None:
        """Coletas cujo id segue {snapshot}-{sigla}_{md5}: uma única consulta."""
        consultas: list[str] = []

        class _PorId:
            def get_json(self, path, **kwargs):
                return NETWORK_PAYLOAD if path.endswith("/network") else SNAPSHOT_PAYLOAD

            def list_record_validation_results(self, snapshot_id, page=1, count=20, query="fq", **kw):
                consultas.append(query)
                if query.startswith("id:"):
                    return {
                        "content": [{"id": query[3:], "identifier": IDENT}],
                        "totalElements": 1,
                        "totalPages": 1,
                    }
                return {"content": [], "totalElements": 0, "totalPages": 0}

        with patch(CLIENT, lambda *a, **k: _PorId()):
            response = self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(consultas), 1)
        self.assertTrue(consultas[0].startswith("id:98768-VERACRUZ-0_"))

    def test_registro_com_id_opaco_cai_na_varredura(self) -> None:
        """Coletas com id numérico: o derivado falha e a varredura encontra."""
        consultas: list[str] = []

        class _IdOpaco:
            def get_json(self, path, **kwargs):
                return NETWORK_PAYLOAD if path.endswith("/network") else SNAPSHOT_PAYLOAD

            def list_record_validation_results(self, snapshot_id, page=1, count=20, query="fq", **kw):
                consultas.append(query)
                if query.startswith("id:"):
                    return {"content": [], "totalElements": 0, "totalPages": 0}
                return {
                    "content": [{"id": "16475792", "identifier": IDENT}],
                    "totalElements": 1,
                    "totalPages": 1,
                }

        with patch(CLIENT, lambda *a, **k: _IdOpaco()):
            response = self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], "16475792")
        self.assertEqual(len(consultas), 2)

    def test_varredura_do_registro_respeita_os_filtros_da_tela(self) -> None:
        """Chegando de uma listagem filtrada, a varredura herda o recorte."""
        consultas: list[str] = []

        class _Captura:
            def get_json(self, path, **kwargs):
                return NETWORK_PAYLOAD if path.endswith("/network") else SNAPSHOT_PAYLOAD

            def list_record_validation_results(self, snapshot_id, page=1, count=20, query="fq", **kw):
                consultas.append(query)
                return {"content": [], "totalElements": 0, "totalPages": 0}

        with patch(CLIENT, lambda *a, **k: _Captura()):
            self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}?invalidRule=104")

        self.assertIn("invalid_rules:104", consultas[0])
        self.assertEqual(consultas[-1], "invalid_rules:104")

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_xml_do_registro(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}/xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/xml", response["Content-Type"])

    @patch(CLIENT, lambda *a, **k: fake_client(
        get_record_metadata=lambda *a, **k: "No record found - Probably the diagnose report is outdated"
    ))
    def test_mensagem_de_texto_do_harvester_vira_404(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}/xml")
        self.assertEqual(response.status_code, 404)

    # --- Falhas do Harvester -------------------------------------------------

    @patch(CLIENT, lambda *a, **k: fake_client(
        get_json=lambda *a, **k: (_ for _ in ()).throw(HarvesterError("sem rota"))
    ))
    def test_harvester_inacessivel_vira_503(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/{SNAP}")
        self.assertEqual(response.status_code, 503)

    @patch(CLIENT, lambda *a, **k: fake_client(
        get_json=lambda *a, **k: (_ for _ in ()).throw(HarvesterError("404", status_code=404))
    ))
    def test_coleta_inexistente_vira_404(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/{SNAP}")
        self.assertEqual(response.status_code, 404)

    @patch(CLIENT, lambda *a, **k: fake_client(
        get_json=lambda *a, **k: (_ for _ in ()).throw(HarvesterError("500", status_code=500))
    ))
    def test_erro_do_harvester_vira_502(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/{SNAP}")
        self.assertEqual(response.status_code, 502)

    # --- Cache ---------------------------------------------------------------

    def contador(self):
        """Duplo que registra cada chamada ao Harvester."""
        chamadas = []

        class _Contando:
            def get_json(self, path, **kwargs):
                chamadas.append(path)
                return NETWORK_PAYLOAD if path.endswith("/network") else SNAPSHOT_PAYLOAD

            def get_diagnose(self, snapshot_id):
                chamadas.append(f"diagnose:{snapshot_id}")
                return DIAGNOSE_PAYLOAD

            def list_validation_occurrences(self, snapshot_id, rule_id, query=None):
                chamadas.append(f"occurrences:{snapshot_id}:{rule_id}:{query or '-'}")
                return {"validRuleOccrs": [], "invalidRuleOccrs": []}

            def list_record_validation_results(self, snapshot_id, page=1, count=20, **kw):
                chamadas.append(f"records:{snapshot_id}:{page}:{count}")
                return {
                    "content": [{"id": "x", "identifier": IDENT}],
                    "totalElements": 1,
                    "totalPages": 1,
                }

            def get_record_metadata(self, snapshot_id, identifier):
                chamadas.append(f"xml:{identifier}")
                return "<record/>"

        return chamadas, _Contando()

    def test_repositorio_do_snapshot_fica_em_cache(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}")
            self.api(self.admin).get(f"{BASE}/{SNAP}")
        self.assertEqual(sum(1 for c in chamadas if c.endswith("/network")), 1)

    def test_detalhe_da_coleta_fica_em_cache(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}")
            self.api(self.admin).get(f"{BASE}/{SNAP}")
        self.assertEqual(sum(1 for c in chamadas if c.endswith(f"/snapshot/{SNAP}")), 1)

    def test_diagnostico_e_regras_compartilham_uma_unica_ida_ao_harvester(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}/diagnosis")
            self.api(self.admin).get(f"{BASE}/{SNAP}/rules")
            self.api(self.admin).get(f"{BASE}/{SNAP}/diagnosis")
        self.assertEqual([c for c in chamadas if c.startswith("diagnose:")], [f"diagnose:{SNAP}"])

    def test_ocorrencias_ficam_em_cache_por_regra(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}/rules/110/occurrences")
            self.api(self.admin).get(f"{BASE}/{SNAP}/rules/110/occurrences")
            self.api(self.admin).get(f"{BASE}/{SNAP}/rules/104/occurrences")
        ocorrencias = [c for c in chamadas if c.startswith("occurrences:")]
        self.assertEqual(ocorrencias, [f"occurrences:{SNAP}:110:-", f"occurrences:{SNAP}:104:-"])

    def test_ocorrencias_ficam_em_cache_por_filtro(self) -> None:
        """Recortes diferentes são respostas diferentes — não podem colidir na chave."""
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}/rules/110/occurrences")
            self.api(self.admin).get(f"{BASE}/{SNAP}/rules/110/occurrences?valid=false")
            self.api(self.admin).get(f"{BASE}/{SNAP}/rules/110/occurrences?valid=false")
        self.assertEqual(
            [c for c in chamadas if c.startswith("occurrences:")],
            [
                f"occurrences:{SNAP}:110:-",
                f"occurrences:{SNAP}:110:record_is_valid:false",
            ],
        )

    def test_pagina_de_registros_fica_em_cache_por_pagina(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}/records?page=1&count=20")
            self.api(self.admin).get(f"{BASE}/{SNAP}/records?page=1&count=20")
            self.api(self.admin).get(f"{BASE}/{SNAP}/records?page=2&count=20")
        registros = [c for c in chamadas if c.startswith("records:")]
        self.assertEqual(registros, [f"records:{SNAP}:1:20", f"records:{SNAP}:2:20"])

    def test_busca_de_registro_reaproveita_paginas_ja_varridas(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}")
            self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}")
        self.assertEqual(len([c for c in chamadas if c.startswith("records:")]), 1)

    def test_xml_fica_em_cache(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}/xml")
            self.api(self.admin).get(f"{BASE}/{SNAP}/records/{IDENT}/xml")
        self.assertEqual(len([c for c in chamadas if c.startswith("xml:")]), 1)

    def test_falha_do_harvester_nao_e_cacheada(self) -> None:
        """Um erro não pode envenenar o cache: a chamada seguinte tenta de novo."""
        tentativas = []

        class _Instavel:
            def get_json(self, path, **kwargs):
                tentativas.append(path)
                if len(tentativas) == 1:
                    raise HarvesterError("sem rota")
                return NETWORK_PAYLOAD if path.endswith("/network") else SNAPSHOT_PAYLOAD

        with patch(CLIENT, lambda *a, **k: _Instavel()):
            primeira = self.api(self.admin).get(f"{BASE}/{SNAP}")
            segunda = self.api(self.admin).get(f"{BASE}/{SNAP}")

        self.assertEqual(primeira.status_code, 503)
        self.assertEqual(segunda.status_code, 200)

    def test_cache_e_isolado_por_snapshot(self) -> None:
        chamadas, duplo = self.contador()
        with patch(CLIENT, lambda *a, **k: duplo):
            self.api(self.admin).get(f"{BASE}/{SNAP}/diagnosis")
            self.api(self.admin).get(f"{BASE}/99999/diagnosis")
        self.assertEqual(
            [c for c in chamadas if c.startswith("diagnose:")],
            [f"diagnose:{SNAP}", "diagnose:99999"],
        )
