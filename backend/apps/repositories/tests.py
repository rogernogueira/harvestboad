"""Testes do vínculo usuário↔repositório.

O Harvester é substituído por um duplo em todos os casos: a rede real é
intermitente e não deve decidir se a suíte passa.
"""

from io import StringIO
from unittest.mock import patch

from django.core.management import call_command

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Profile
from apps.audit.models import AuditLog
from apps.integrations.harvester import HarvesterError

from .models import RepositoryAccess

User = get_user_model()

BASE = "/api/v1/repositories/accesses"
REPOS = "/api/v1/repositories"

SUMMARY = "apps.repositories.serializers.repository_summary"
SERVICES_CLIENT = "apps.repositories.services.HarvesterClient"

NETWORK_PATH = "apps.repositories.serializers.HarvesterClient.get_network"


class RepositoryAccessAPITests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="admin", email="admin@uft.edu.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="gestor", email="gestor@uft.edu.br", password="x", profile=Profile.GESTOR
        )
        cls.outro = User.objects.create_user(
            username="outro", email="outro@uft.edu.br", password="x", profile=Profile.GESTOR
        )
        cls.acesso_gestor = RepositoryAccess.objects.create(
            user=cls.gestor, harvester_repository_id="1", acronym="VERACRUZ-0"
        )
        cls.acesso_outro = RepositoryAccess.objects.create(
            user=cls.outro, harvester_repository_id="5", acronym="UTFPR"
        )

    def setUp(self) -> None:
        # A leitura dos vínculos passou a enriquecer com dados do Harvester;
        # sem este duplo, a suíte bateria na rede real.
        patcher = patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
        patcher.start()
        self.addCleanup(patcher.stop)
        cache.clear()

    def api(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    # --- Leitura com escopo por perfil --------------------------------------

    def test_gestor_ve_apenas_os_proprios_vinculos(self) -> None:
        response = self.api(self.gestor).get(f"{BASE}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["acronym"], "VERACRUZ-0")

    def test_admin_ve_todos_os_vinculos(self) -> None:
        response = self.api(self.admin).get(f"{BASE}/")
        self.assertEqual(response.data["count"], 2)

    def test_gestor_nao_acessa_vinculo_alheio_por_id(self) -> None:
        response = self.api(self.gestor).get(
            f"{BASE}/{self.acesso_outro.pk}/"
        )
        self.assertEqual(response.status_code, 404)

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().get(f"{BASE}/").status_code, 401)

    # --- Escrita restrita ao ADMIN ------------------------------------------

    @patch(NETWORK_PATH, return_value={"acronym": "RIUFT", "name": "Repositório UFT"})
    def test_admin_cria_vinculo_e_sigla_vem_do_harvester(self, _mock) -> None:
        response = self.api(self.admin).post(
            f"{BASE}/",
            {"user": self.gestor.pk, "harvesterRepositoryId": "7"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        criado = RepositoryAccess.objects.get(user=self.gestor, harvester_repository_id="7")
        self.assertEqual(criado.acronym, "RIUFT")
        self.assertIsNotNone(criado.granted_at)

    @patch(NETWORK_PATH, return_value={"acronym": "RIUFT"})
    def test_gestor_nao_pode_criar_vinculo(self, _mock) -> None:
        response = self.api(self.gestor).post(
            f"{BASE}/",
            {"user": self.gestor.pk, "harvesterRepositoryId": "7"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(RepositoryAccess.objects.filter(harvester_repository_id="7").exists())

    @patch(NETWORK_PATH, return_value={"acronym": "VERACRUZ-0"})
    def test_vinculo_duplicado_e_rejeitado(self, _mock) -> None:
        response = self.api(self.admin).post(
            f"{BASE}/",
            {"user": self.gestor.pk, "harvesterRepositoryId": "1"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        # Mensagem vem do UniqueTogetherValidator derivado da constraint do modelo.
        self.assertIn("non_field_errors", response.data)

    @patch(NETWORK_PATH, side_effect=HarvesterError("404", status_code=404))
    def test_repositorio_inexistente_no_harvester_e_rejeitado(self, _mock) -> None:
        response = self.api(self.admin).post(
            f"{BASE}/",
            {"user": self.gestor.pk, "harvesterRepositoryId": "999999"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    @patch(NETWORK_PATH, side_effect=HarvesterError("sem rota"))
    def test_harvester_fora_do_ar_aceita_sigla_informada(self, _mock) -> None:
        response = self.api(self.admin).post(
            f"{BASE}/",
            {"user": self.gestor.pk, "harvesterRepositoryId": "7", "acronym": "RIUFT"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    @patch(NETWORK_PATH, side_effect=HarvesterError("sem rota"))
    def test_harvester_fora_do_ar_sem_sigla_falha_com_mensagem(self, _mock) -> None:
        response = self.api(self.admin).post(
            f"{BASE}/",
            {"user": self.gestor.pk, "harvesterRepositoryId": "7"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("acronym", response.data)

    def test_admin_remove_vinculo(self) -> None:
        response = self.api(self.admin).delete(
            f"{BASE}/{self.acesso_outro.pk}/"
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(RepositoryAccess.objects.filter(pk=self.acesso_outro.pk).exists())

    def test_gestor_nao_pode_remover(self) -> None:
        response = self.api(self.gestor).delete(
            f"{BASE}/{self.acesso_gestor.pk}/"
        )
        self.assertEqual(response.status_code, 403)

    # --- Auditoria ----------------------------------------------------------

    @patch(NETWORK_PATH, return_value={"acronym": "RIUFT"})
    def test_criacao_gera_registro_de_auditoria(self, _mock) -> None:
        self.api(self.admin).post(
            f"{BASE}/",
            {"user": self.gestor.pk, "harvesterRepositoryId": "7"},
            format="json",
        )
        log = AuditLog.objects.get(action=AuditLog.Action.CREATE, resource="repository_access")
        self.assertEqual(log.user, self.admin)

    def test_remocao_gera_registro_de_auditoria(self) -> None:
        self.api(self.admin).delete(f"{BASE}/{self.acesso_outro.pk}/")
        log = AuditLog.objects.get(action=AuditLog.Action.DELETE, resource="repository_access")
        self.assertEqual(log.resource_id, str(self.acesso_outro.pk))

    # --- Repositórios disponíveis -------------------------------------------

    @patch(
        "apps.repositories.views.HarvesterClient.list_networks_rest",
        return_value={
            "_embedded": {
                "network": [
                    {
                        "acronym": "VERACRUZ-0",
                        "name": "Revista Veras",
                        "institutionName": "Veracruz",
                        "published": True,
                        "_links": {"self": {"href": "http://h:8090/rest/network/1"}},
                    }
                ]
            },
            "page": {"totalElements": 1},
        },
    )
    def test_lista_repositorios_disponiveis(self, _mock) -> None:
        response = self.api(self.admin).get(f"{BASE}/available/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["harvesterRepositoryId"], "1")
        self.assertEqual(response.data["results"][0]["acronym"], "VERACRUZ-0")

    @patch(
        "apps.repositories.views.HarvesterClient.list_networks_rest",
        side_effect=HarvesterError("sem rota"),
    )
    def test_harvester_indisponivel_responde_503(self, _mock) -> None:
        response = self.api(self.admin).get(f"{BASE}/available/")
        self.assertEqual(response.status_code, 503)

    def test_gestor_nao_lista_repositorios_disponiveis(self) -> None:
        response = self.api(self.gestor).get(f"{BASE}/available/")
        self.assertEqual(response.status_code, 403)


NETWORK_PAYLOAD = {
    "acronym": "VERACRUZ-0",
    "name": "Revista Veras",
    "institutionAcronym": "VERACRUZ",
    "institutionName": "Instituto Superior de Educação Vera Cruz",
    "metadataPrefix": "oai_dc",
    "published": True,
}
SNAPSHOTS_PAYLOAD = {
    "_embedded": {
        "snapshot": [
            {
                "status": "VALID",
                "indexStatus": "INDEXED",
                "startTime": "2024-06-25 11:51:37",
                "endTime": "2024-06-25 12:10:33",
                "size": 26103,
                "validSize": 26091,
                "transformedSize": 26103,
                "deleted": False,
                "previousSnapshotId": None,
                "_links": {"self": {"href": "http://h:8090/rest/snapshot/98768"}},
            },
            {
                "status": "HARVESTING_FINISHED_ERROR",
                "size": 0,
                "_links": {"self": {"href": "http://h:8090/rest/snapshot/86338"}},
            },
        ]
    }
}


def fake_services_client():
    class _Fake:
        def get_network(self, repository_id):
            return NETWORK_PAYLOAD

        def list_snapshots(self, repository_id):
            return SNAPSHOTS_PAYLOAD

    return _Fake()


class RepositoryDetailAPITests(TestCase):
    """Visão geral e histórico de coletas de um repositório."""

    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="adm", email="adm@uft.edu.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="ges", email="ges@uft.edu.br", password="x", profile=Profile.GESTOR
        )
        RepositoryAccess.objects.create(
            user=cls.gestor, harvester_repository_id="1", acronym="VERACRUZ-0"
        )

    def setUp(self) -> None:
        cache.clear()

    def api(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().get(f"{REPOS}/1").status_code, 401)

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_gestor_vinculado_ve_dados_cadastrais(self) -> None:
        response = self.api(self.gestor).get(f"{REPOS}/1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "Revista Veras")
        self.assertEqual(response.data["harvesterRepositoryId"], "1")
        self.assertEqual(response.data["metadataPrefix"], "oai_dc")

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_gestor_sem_vinculo_recebe_403(self) -> None:
        self.assertEqual(self.api(self.gestor).get(f"{REPOS}/99").status_code, 403)

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_admin_ve_qualquer_repositorio(self) -> None:
        self.assertEqual(self.api(self.admin).get(f"{REPOS}/99").status_code, 200)

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_historico_de_coletas(self) -> None:
        response = self.api(self.gestor).get(f"{REPOS}/1/harvests")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        # O snapshotID só existe no _links.self.href do HAL.
        self.assertEqual(
            [s["snapshotId"] for s in response.data["results"]], ["98768", "86338"]
        )
        self.assertEqual(response.data["results"][0]["validSize"], 26091)

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_historico_respeita_vinculo(self) -> None:
        self.assertEqual(self.api(self.gestor).get(f"{REPOS}/99/harvests").status_code, 403)

    @patch(SERVICES_CLIENT, lambda *a, **k: (_ for _ in ()).throw(HarvesterError("sem rota")))
    def test_harvester_fora_vira_503(self) -> None:
        self.assertEqual(self.api(self.admin).get(f"{REPOS}/1").status_code, 503)

    def test_repositorio_inexistente_vira_404(self) -> None:
        class _NaoEncontrado:
            def get_network(self, repository_id):
                raise HarvesterError("404", status_code=404)

        with patch(SERVICES_CLIENT, lambda *a, **k: _NaoEncontrado()):
            self.assertEqual(self.api(self.admin).get(f"{REPOS}/12345").status_code, 404)

    def test_dados_do_repositorio_ficam_em_cache(self) -> None:
        chamadas = []

        class _Contando:
            def get_network(self, repository_id):
                chamadas.append(repository_id)
                return NETWORK_PAYLOAD

        with patch(SERVICES_CLIENT, lambda *a, **k: _Contando()):
            self.api(self.admin).get(f"{REPOS}/1")
            self.api(self.admin).get(f"{REPOS}/1")

        self.assertEqual(chamadas, ["1"])

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_lista_de_vinculos_vem_enriquecida(self) -> None:
        response = self.api(self.gestor).get(f"{BASE}/")
        linha = response.data["results"][0]
        self.assertEqual(linha["acronym"], "VERACRUZ-0")
        self.assertEqual(linha["name"], "Revista Veras")
        self.assertEqual(linha["institutionName"], "Instituto Superior de Educação Vera Cruz")

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_sigla_da_origem_prevalece_sobre_a_gravada(self) -> None:
        acesso = RepositoryAccess.objects.create(
            user=self.admin, harvester_repository_id="1", acronym="SIGLA-VELHA"
        )
        response = self.api(self.admin).get(f"{BASE}/{acesso.pk}/")
        self.assertEqual(response.data["acronym"], "VERACRUZ-0")
        self.assertTrue(response.data["acronymIsStale"])
        # A leitura não escreve: a coluna segue com o valor antigo.
        acesso.refresh_from_db()
        self.assertEqual(acesso.acronym, "SIGLA-VELHA")

    @patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client())
    def test_sigla_em_dia_nao_e_marcada_como_defasada(self) -> None:
        response = self.api(self.gestor).get(f"{BASE}/")
        self.assertFalse(response.data["results"][0]["acronymIsStale"])

    def test_lista_de_vinculos_sobrevive_ao_harvester_fora(self) -> None:
        """Com a origem indisponível, a sigla cai para o valor gravado."""

        class _Fora:
            def get_network(self, repository_id):
                raise HarvesterError("sem rota")

        with patch(SERVICES_CLIENT, lambda *a, **k: _Fora()):
            response = self.api(self.gestor).get(f"{BASE}/")

        self.assertEqual(response.status_code, 200)
        linha = response.data["results"][0]
        self.assertEqual(linha["acronym"], "VERACRUZ-0")  # valor gravado
        self.assertFalse(linha["acronymIsStale"])
        self.assertIsNone(linha["name"])


class SyncAcronymsCommandTests(TestCase):
    """Comando de ressincronização das siglas gravadas."""

    @classmethod
    def setUpTestData(cls) -> None:
        cls.a = User.objects.create_user(
            username="u1", email="u1@uft.edu.br", password="x", profile=Profile.GESTOR
        )
        cls.b = User.objects.create_user(
            username="u2", email="u2@uft.edu.br", password="x", profile=Profile.GESTOR
        )

    def setUp(self) -> None:
        cache.clear()

    def test_atualiza_siglas_divergentes(self) -> None:
        v1 = RepositoryAccess.objects.create(
            user=self.a, harvester_repository_id="1", acronym="BDTD"
        )
        v2 = RepositoryAccess.objects.create(
            user=self.b, harvester_repository_id="1", acronym="BDTD"
        )
        saida = StringIO()
        with patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client()):
            call_command("sync_repository_acronyms", stdout=saida)

        v1.refresh_from_db(); v2.refresh_from_db()
        self.assertEqual(v1.acronym, "VERACRUZ-0")
        self.assertEqual(v2.acronym, "VERACRUZ-0")
        self.assertIn("BDTD → VERACRUZ-0", saida.getvalue())

    def test_dry_run_nao_grava(self) -> None:
        vinculo = RepositoryAccess.objects.create(
            user=self.a, harvester_repository_id="1", acronym="BDTD"
        )
        with patch(SERVICES_CLIENT, lambda *a, **k: fake_services_client()):
            call_command("sync_repository_acronyms", "--dry-run", stdout=StringIO())

        vinculo.refresh_from_db()
        self.assertEqual(vinculo.acronym, "BDTD")

    def test_consulta_a_origem_uma_vez_por_repositorio(self) -> None:
        """Dois usuários no mesmo repositório não viram duas consultas."""
        RepositoryAccess.objects.create(
            user=self.a, harvester_repository_id="1", acronym="BDTD"
        )
        RepositoryAccess.objects.create(
            user=self.b, harvester_repository_id="1", acronym="BDTD"
        )
        chamadas = []

        class _Contando:
            def get_network(self, repository_id):
                chamadas.append(repository_id)
                return NETWORK_PAYLOAD

        with patch(SERVICES_CLIENT, lambda *a, **k: _Contando()):
            call_command("sync_repository_acronyms", stdout=StringIO())

        self.assertEqual(chamadas, ["1"])

    def test_repositorio_inacessivel_nao_apaga_a_sigla_gravada(self) -> None:
        vinculo = RepositoryAccess.objects.create(
            user=self.a, harvester_repository_id="1", acronym="BDTD"
        )

        class _Fora:
            def get_network(self, repository_id):
                raise HarvesterError("sem rota")

        saida, erro = StringIO(), StringIO()
        with patch(SERVICES_CLIENT, lambda *a, **k: _Fora()):
            call_command("sync_repository_acronyms", stdout=saida, stderr=erro)

        vinculo.refresh_from_db()
        self.assertEqual(vinculo.acronym, "BDTD")
        self.assertIn("não consultado", erro.getvalue())


SNAPSHOTS_COM_HISTORICO = {
    "_embedded": {
        "snapshot": [
            {
                "status": "HARVESTING",
                "endTime": None,
                "size": 0,
                "_links": {"self": {"href": "http://h:8090/rest/snapshot/99999"}},
            },
            {
                "status": "VALID",
                "endTime": "2024-06-25 12:10:33",
                "size": 26103,
                "validSize": 26091,
                "transformedSize": 26103,
                "_links": {"self": {"href": "http://h:8090/rest/snapshot/98768"}},
            },
        ]
    }
}

DIAGNOSE_COM_REGRAS = {
    "size": 26103,
    "validSize": 26091,
    "rulesByID": {
        "110": {"ruleID": 110, "name": "Abstract", "invalidCount": 26103, "validCount": None},
        "117": {"ruleID": 117, "name": "Idioma", "invalidCount": 49, "validCount": None},
        "104": {"ruleID": 104, "name": "Título", "invalidCount": None, "validCount": 26103},
    },
    "facets": {},
}


def fake_summary_client():
    class _Fake:
        def get_network(self, repository_id):
            return NETWORK_PAYLOAD

        def list_snapshots(self, repository_id):
            return SNAPSHOTS_COM_HISTORICO

        def get_diagnose(self, snapshot_id):
            return DIAGNOSE_COM_REGRAS

    return _Fake()


class RepositorySummaryTests(TestCase):
    """Painel de repositórios com estatísticas da última coleta."""

    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="a", email="a@ibict.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="g", email="g@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.outro = User.objects.create_user(
            username="o", email="o@ibict.br", password="x", profile=Profile.GESTOR
        )
        RepositoryAccess.objects.create(
            user=cls.gestor, harvester_repository_id="1", acronym="VERACRUZ-0"
        )
        RepositoryAccess.objects.create(
            user=cls.outro, harvester_repository_id="5", acronym="OUTRO"
        )

    def setUp(self) -> None:
        cache.clear()

    def api(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().get(f"{REPOS}/summary/").status_code, 401)

    def test_gestor_ve_somente_os_proprios(self) -> None:
        with patch(SERVICES_CLIENT, lambda *a, **k: fake_summary_client()):
            response = self.api(self.gestor).get(f"{REPOS}/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["harvesterRepositoryId"], "1")

    def test_admin_ve_todos(self) -> None:
        with patch(SERVICES_CLIENT, lambda *a, **k: fake_summary_client()):
            response = self.api(self.admin).get(f"{REPOS}/summary/")
        self.assertEqual(response.data["count"], 2)

    def test_traz_estatisticas_da_ultima_coleta(self) -> None:
        with patch(SERVICES_CLIENT, lambda *a, **k: fake_summary_client()):
            response = self.api(self.gestor).get(f"{REPOS}/summary/")

        linha = response.data["results"][0]
        self.assertEqual(linha["name"], "Revista Veras")
        coleta = linha["lastHarvest"]
        self.assertEqual(coleta["snapshotId"], "98768")
        self.assertEqual(coleta["endTime"], "2024-06-25 12:10:33")
        self.assertEqual(coleta["size"], 26103)
        self.assertEqual(coleta["validSize"], 26091)
        self.assertEqual(coleta["invalidSize"], 12)
        self.assertEqual(coleta["harvestCount"], 2)

    def test_ignora_coleta_em_andamento_sem_registros(self) -> None:
        """A mais recente está coletando e tem 0 registros: o resumo usa a anterior."""
        with patch(SERVICES_CLIENT, lambda *a, **k: fake_summary_client()):
            response = self.api(self.gestor).get(f"{REPOS}/summary/")
        self.assertEqual(response.data["results"][0]["lastHarvest"]["snapshotId"], "98768")

    def test_conta_e_ordena_regras_violadas(self) -> None:
        with patch(SERVICES_CLIENT, lambda *a, **k: fake_summary_client()):
            response = self.api(self.gestor).get(f"{REPOS}/summary/")

        coleta = response.data["results"][0]["lastHarvest"]
        # Só 110 e 117 têm invalidCount; a 104 não conta.
        self.assertEqual(coleta["violatedRuleCount"], 2)
        self.assertEqual(
            [v["ruleId"] for v in coleta["topViolations"]], [110, 117]
        )
        self.assertEqual(coleta["topViolations"][0]["invalidCount"], 26103)

    def test_repositorio_sem_coletas(self) -> None:
        class _SemColetas:
            def get_network(self, repository_id):
                return NETWORK_PAYLOAD

            def list_snapshots(self, repository_id):
                return {"_embedded": {"snapshot": []}}

        with patch(SERVICES_CLIENT, lambda *a, **k: _SemColetas()):
            response = self.api(self.gestor).get(f"{REPOS}/summary/")

        self.assertIsNone(response.data["results"][0]["lastHarvest"])
        self.assertFalse(response.data["results"][0]["unavailable"])

    def test_falha_do_harvester_marca_a_linha_sem_derrubar_o_painel(self) -> None:
        """Uma origem fora do ar não pode zerar o painel inteiro."""

        class _Fora:
            def get_network(self, repository_id):
                raise HarvesterError("sem rota")

        with patch(SERVICES_CLIENT, lambda *a, **k: _Fora()):
            response = self.api(self.admin).get(f"{REPOS}/summary/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        for linha in response.data["results"]:
            self.assertTrue(linha["unavailable"])
            # A sigla gravada localmente sobrevive e identifica a linha.
            self.assertIn(linha["acronym"], {"VERACRUZ-0", "OUTRO"})

    def test_diagnostico_indisponivel_preserva_os_numeros_da_coleta(self) -> None:
        """Sem o diagnóstico, os totais da coleta ainda valem."""

        class _SemDiagnostico:
            def get_network(self, repository_id):
                return NETWORK_PAYLOAD

            def list_snapshots(self, repository_id):
                return SNAPSHOTS_COM_HISTORICO

            def get_diagnose(self, snapshot_id):
                raise HarvesterError("sem rota")

        with patch(SERVICES_CLIENT, lambda *a, **k: _SemDiagnostico()):
            response = self.api(self.gestor).get(f"{REPOS}/summary/")

        coleta = response.data["results"][0]["lastHarvest"]
        self.assertEqual(coleta["size"], 26103)
        self.assertIsNone(coleta["violatedRuleCount"])
        self.assertEqual(coleta["topViolations"], [])
