"""Testes das exportações.

O foco é o que o requisito pede: a exportação precisa obedecer exatamente as
mesmas regras de autorização e os mesmos filtros da tela.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.audit.models import AuditLog
from apps.repositories.models import RepositoryAccess

User = get_user_model()

BASE = "/api/v1/reports/harvests"
SNAP = "98768"

NETWORK_PAYLOAD = {
    "acronym": "VERACRUZ-0",
    "name": "Revista Veras",
    "_links": {"self": {"href": "http://h:8090/rest/network/1"}},
}

CLIENT = "apps.harvests.services.HarvesterClient"
HISTORICO = "/api/v1/reports/repositories"
SNAPSHOTS_CLIENT = "apps.repositories.services.HarvesterClient"


def fake_snapshots():
    """Duplo do histórico: uma coleta contada e outra sem contagem."""

    class _Fake:
        def list_snapshots(self, repository_id):
            return {
                "_embedded": {
                    "snapshot": [
                        {
                            "status": "VALID",
                            "indexStatus": "INDEXED",
                            "startTime": "2026-09-16 15:54:58",
                            "endTime": "2026-09-16 15:55:01",
                            "size": 10,
                            "validSize": 8,
                            "transformedSize": 10,
                            "_links": {"self": {"href": "http://h:8090/rest/snapshot/108702"}},
                        },
                        {
                            "status": "HARVESTING",
                            "indexStatus": None,
                            "startTime": "2026-09-17 10:00:00",
                            "endTime": None,
                            "size": None,
                            "validSize": None,
                            "transformedSize": None,
                            "_links": {"self": {"href": "http://h:8090/rest/snapshot/108703"}},
                        },
                    ]
                }
            }

    return _Fake()


def fake_client(total=3, capture=None):
    """Duplo que registra a consulta de filtro recebida."""

    class _Fake:
        def get_json(self, path, **kwargs):
            return NETWORK_PAYLOAD

        def list_record_validation_results(
            self, snapshot_id, page=1, count=20, query="fq", **kw
        ):
            if capture is not None:
                capture.append(query)
            restantes = max(0, total - (page - 1) * count)
            linhas = min(count, restantes)
            return {
                "content": [
                    {
                        "identifier": f"oai:x:{(page - 1) * count + i}",
                        "id": f"{snapshot_id}-VERACRUZ-0_{i}",
                        "isValid": False,
                        "isTransformed": True,
                        "networkAcronym": "VERACRUZ-0",
                        "repositoryName": "Revista Veras",
                        "institutionName": "VeraCruz",
                        "setSpec": "art",
                        "metadataPrefix": "oai_dc",
                        "origin": "ojs",
                    }
                    for i in range(linhas)
                ],
                "totalElements": total,
                "totalPages": (total + count - 1) // count,
            }

    return _Fake()


class ExportAuthorizationTests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="adm", email="a@uft.edu.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="ges", email="g@uft.edu.br", password="x", profile=Profile.GESTOR
        )
        cls.alheio = User.objects.create_user(
            username="alh", email="o@uft.edu.br", password="x", profile=Profile.GESTOR
        )
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

    def corpo(self, response) -> str:
        return b"".join(response.streaming_content).decode()

    # --- A regra central do requisito ---------------------------------------

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().get(f"{BASE}/{SNAP}/records.csv").status_code, 401)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_gestor_sem_vinculo_nao_exporta(self) -> None:
        """Mesma negativa da tela: 403, sem caminho alternativo pela exportação."""
        response = self.api(self.alheio).get(f"{BASE}/{SNAP}/records.csv")
        self.assertEqual(response.status_code, 403)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_gestor_vinculado_exporta(self) -> None:
        response = self.api(self.gestor).get(f"{BASE}/{SNAP}/records.csv")
        self.assertEqual(response.status_code, 200)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_admin_exporta_qualquer_coleta(self) -> None:
        self.assertEqual(
            self.api(self.admin).get(f"{BASE}/{SNAP}/records.csv").status_code, 200
        )

    # --- Histórico de coletas ------------------------------------------------

    def test_historico_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().get(f"{HISTORICO}/1/harvests.csv").status_code, 401)

    def test_historico_de_repositorio_alheio_nao_exporta(self) -> None:
        """A autorização é a do repositório: 403 antes de qualquer ida à origem."""
        response = self.api(self.alheio).get(f"{HISTORICO}/1/harvests.csv")
        self.assertEqual(response.status_code, 403)

    @patch(SNAPSHOTS_CLIENT, lambda *a, **k: fake_snapshots())
    def test_historico_sai_com_coletas_e_invalidos_calculados(self) -> None:
        response = self.api(self.gestor).get(f"{HISTORICO}/1/harvests.csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        self.assertIn(
            'filename="repositorio-1-coletas.csv"', response["Content-Disposition"]
        )

        linhas = self.corpo(response).strip().splitlines()
        self.assertEqual(
            linhas[0],
            "coleta,situacao,situacao_indexacao,inicio,termino,registros,validos,"
            "invalidos,transformados",
        )
        # 10 registros, 8 válidos: os inválidos saem da subtração, não da origem.
        self.assertIn("108702,VALID,INDEXED,2026-09-16 15:54:58,2026-09-16 15:55:01,10,8,2,10", linhas[1])
        # Coleta sem contagem: a subtração ficaria inventada, então sai em branco.
        self.assertTrue(linhas[2].endswith(",,,"))

    @patch(SNAPSHOTS_CLIENT, lambda *a, **k: fake_snapshots())
    def test_historico_registra_auditoria(self) -> None:
        self.api(self.gestor).get(f"{HISTORICO}/1/harvests.csv")
        trilha = AuditLog.objects.filter(resource="repository_harvests_csv").first()
        self.assertIsNotNone(trilha)
        self.assertEqual(trilha.action, AuditLog.Action.EXPORT)
        self.assertEqual(trilha.resource_id, "1")

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_autorizacao_da_exportacao_bate_com_a_da_tela(self) -> None:
        """Para cada usuário, exportar e visualizar concordam."""
        for user in (self.admin, self.gestor, self.alheio):
            with self.subTest(usuario=user.username):
                tela = self.api(user).get(f"/api/v1/harvests/{SNAP}/records")
                export = self.api(user).get(f"{BASE}/{SNAP}/records.csv")
                self.assertEqual(tela.status_code, export.status_code)

    # --- Conteúdo -----------------------------------------------------------

    @patch(CLIENT, lambda *a, **k: fake_client(total=3))
    def test_csv_tem_cabecalho_e_linhas(self) -> None:
        corpo = self.corpo(self.api(self.admin).get(f"{BASE}/{SNAP}/records.csv"))
        linhas = [l for l in corpo.splitlines() if l]
        self.assertEqual(len(linhas), 4)  # cabeçalho + 3
        self.assertTrue(linhas[0].startswith("identificador,id_interno,valido"))
        self.assertIn("oai:x:0", linhas[1])

    @patch(CLIENT, lambda *a, **k: fake_client(total=500))
    def test_paginacao_atravessa_varias_paginas(self) -> None:
        corpo = self.corpo(self.api(self.admin).get(f"{BASE}/{SNAP}/records.csv"))
        self.assertEqual(len([l for l in corpo.splitlines() if l]), 501)

    @patch(CLIENT, lambda *a, **k: fake_client(total=500))
    def test_max_rows_limita(self) -> None:
        corpo = self.corpo(
            self.api(self.admin).get(f"{BASE}/{SNAP}/records.csv?maxRows=10")
        )
        self.assertEqual(len([l for l in corpo.splitlines() if l]), 11)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_nome_do_arquivo_reflete_os_filtros(self) -> None:
        response = self.api(self.admin).get(
            f"{BASE}/{SNAP}/records.csv?valid=false&invalidRule=107"
        )
        self.assertIn(
            'filename="coleta-98768-invalidos-regra-107-violada.csv"',
            response["Content-Disposition"],
        )

    # --- Mesmos filtros da tela ---------------------------------------------

    def test_exportacao_aplica_os_mesmos_filtros_da_listagem(self) -> None:
        consultas_export: list[str] = []
        consultas_tela: list[str] = []

        with patch(CLIENT, lambda *a, **k: fake_client(capture=consultas_export)):
            resposta = self.api(self.admin).get(
                f"{BASE}/{SNAP}/records.csv?valid=false&invalidRule=107"
            )
            self.corpo(resposta)

        cache.clear()
        with patch(CLIENT, lambda *a, **k: fake_client(capture=consultas_tela)):
            self.api(self.admin).get(
                f"/api/v1/harvests/{SNAP}/records?valid=false&invalidRule=107"
            )

        self.assertEqual(consultas_export[0], consultas_tela[0])
        self.assertEqual(
            consultas_tela[0], "record_is_valid:false AND invalid_rules:107"
        )

    def test_filtro_invalido_e_recusado(self) -> None:
        with patch(CLIENT, lambda *a, **k: fake_client()):
            response = self.api(self.admin).get(
                f"{BASE}/{SNAP}/records.csv?invalidRule=abc"
            )
        self.assertEqual(response.status_code, 400)

    # --- Auditoria ----------------------------------------------------------

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_exportacao_gera_registro_de_auditoria(self) -> None:
        self.api(self.gestor).get(f"{BASE}/{SNAP}/records.csv")
        log = AuditLog.objects.get(action=AuditLog.Action.EXPORT)
        self.assertEqual(log.user, self.gestor)
        self.assertEqual(log.resource_id, SNAP)

    @patch(CLIENT, lambda *a, **k: fake_client())
    def test_exportacao_negada_nao_gera_auditoria_de_exportacao(self) -> None:
        self.api(self.alheio).get(f"{BASE}/{SNAP}/records.csv")
        self.assertFalse(AuditLog.objects.filter(action=AuditLog.Action.EXPORT).exists())
