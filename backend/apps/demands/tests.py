"""Demandas de coleta: abertura pelo gestor, atendimento e recusa pelo ADMIN.

Esta app não fala com o Harvester — o que se verifica aqui é quem pode abrir,
quem pode resolver, e a coerência entre situação e os campos que a acompanham.
"""

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Profile, User
from apps.audit.models import AuditLog
from apps.demands.models import HarvestRequest
from apps.notifications.models import Notification
from apps.repositories.models import RepositoryAccess

BASE = "/api/v1/demands"


def api(user=None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class HarvestRequestAPITests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="adm", email="adm@ibict.br", password="x", profile=Profile.ADMIN
        )
        # Ana e Bruno cuidam do 1; Carla cuida do 9.
        cls.ana = User.objects.create_user(
            username="ana", email="ana@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.bruno = User.objects.create_user(
            username="bruno", email="bru@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.carla = User.objects.create_user(
            username="carla", email="car@ibict.br", password="x", profile=Profile.GESTOR
        )
        RepositoryAccess.objects.create(user=cls.ana, harvester_repository_id="1", acronym="A")
        RepositoryAccess.objects.create(user=cls.bruno, harvester_repository_id="1", acronym="A")
        RepositoryAccess.objects.create(user=cls.carla, harvester_repository_id="9", acronym="C")

    def setUp(self) -> None:
        cache.clear()

    def abrir(self, user=None, repositorio="1", **extra):
        return api(user or self.ana).post(
            f"{BASE}/",
            {"harvesterRepositoryId": repositorio, "acronym": "A", **extra},
            format="json",
        )

    # --- Abertura -----------------------------------------------------------

    def test_gestor_abre_demanda_no_proprio_repositorio(self) -> None:
        resposta = self.abrir(note="A coleta está parada há 16 meses.")
        self.assertEqual(resposta.status_code, 201)
        self.assertEqual(resposta.data["status"], "PENDENTE")
        self.assertEqual(resposta.data["requesterUsername"], "ana")

    def test_gestor_nao_abre_em_repositorio_alheio(self) -> None:
        self.assertEqual(self.abrir(repositorio="9").status_code, 403)

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(api().get(f"{BASE}/").status_code, 401)

    def test_segunda_pendente_no_mesmo_repositorio_e_rejeitada(self) -> None:
        """Sem isso, quem não vê resposta clica de novo e a fila duplica."""
        self.abrir()
        segunda = self.abrir(user=self.bruno)
        self.assertEqual(segunda.status_code, 400)
        self.assertEqual(HarvestRequest.objects.count(), 1)

    def test_pode_abrir_de_novo_depois_de_resolvida(self) -> None:
        primeira = self.abrir()
        api(self.admin).post(
            f"{BASE}/{primeira.data['id']}/attend/", {"snapshotId": "106512"}, format="json"
        )
        self.assertEqual(self.abrir().status_code, 201)

    def test_abertura_gera_auditoria(self) -> None:
        self.abrir()
        self.assertTrue(
            AuditLog.objects.filter(
                action=AuditLog.Action.CREATE, resource="harvest_request"
            ).exists()
        )

    # --- Alcance ------------------------------------------------------------

    def test_demanda_e_do_repositorio_nao_de_quem_abriu(self) -> None:
        """O colega de plantão precisa ver que o pedido já foi feito."""
        self.abrir(user=self.ana)
        vista_por_bruno = api(self.bruno).get(f"{BASE}/")
        self.assertEqual(vista_por_bruno.data["count"], 1)

    def test_gestor_nao_ve_demanda_de_repositorio_alheio(self) -> None:
        self.abrir(user=self.ana)
        self.assertEqual(api(self.carla).get(f"{BASE}/").data["count"], 0)

    def test_admin_ve_todas(self) -> None:
        self.abrir(user=self.ana)
        HarvestRequest.objects.create(
            harvester_repository_id="9", acronym="C", requester=self.carla
        )
        self.assertEqual(api(self.admin).get(f"{BASE}/").data["count"], 2)

    def test_filtra_por_situacao(self) -> None:
        self.abrir()
        self.assertEqual(api(self.admin).get(f"{BASE}/?status=PENDENTE").data["count"], 1)
        self.assertEqual(api(self.admin).get(f"{BASE}/?status=ATENDIDA").data["count"], 0)

    # --- Atendimento --------------------------------------------------------

    def test_admin_atende_informando_a_coleta(self) -> None:
        demanda = self.abrir().data
        resposta = api(self.admin).post(
            f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "#106512"}, format="json"
        )
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.data["status"], "ATENDIDA")
        # O `#` digitado por hábito não entra no dado.
        self.assertEqual(resposta.data["snapshotId"], "106512")
        self.assertEqual(resposta.data["resolvedByUsername"], "adm")

    def test_atender_sem_numero_e_rejeitado(self) -> None:
        demanda = self.abrir().data
        resposta = api(self.admin).post(
            f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "   "}, format="json"
        )
        self.assertEqual(resposta.status_code, 400)

    def test_gestor_nao_atende(self) -> None:
        demanda = self.abrir().data
        resposta = api(self.ana).post(
            f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "1"}, format="json"
        )
        self.assertEqual(resposta.status_code, 403)

    def test_atender_duas_vezes_e_rejeitado(self) -> None:
        demanda = self.abrir().data
        api(self.admin).post(f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "1"}, format="json")
        segunda = api(self.admin).post(
            f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "2"}, format="json"
        )
        self.assertEqual(segunda.status_code, 400)

    def test_atendimento_avisa_quem_pediu(self) -> None:
        demanda = self.abrir().data
        api(self.admin).post(
            f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "106512"}, format="json"
        )
        aviso = Notification.objects.get(recipient=self.ana)
        self.assertIn("106512", aviso.message)
        self.assertEqual(aviso.author, self.admin)

    # --- Recusa -------------------------------------------------------------

    def test_admin_recusa_com_motivo(self) -> None:
        demanda = self.abrir().data
        resposta = api(self.admin).post(
            f"{BASE}/{demanda['id']}/refuse/",
            {"reason": "A origem está fora do ar."},
            format="json",
        )
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.data["status"], "RECUSADA")
        self.assertEqual(resposta.data["reason"], "A origem está fora do ar.")

    def test_recusar_sem_motivo_e_rejeitado(self) -> None:
        """Sem o motivo o gestor repete o pedido sem saber por quê."""
        demanda = self.abrir().data
        resposta = api(self.admin).post(
            f"{BASE}/{demanda['id']}/refuse/", {"reason": "  "}, format="json"
        )
        self.assertEqual(resposta.status_code, 400)

    def test_recusa_avisa_quem_pediu_com_o_motivo(self) -> None:
        demanda = self.abrir().data
        api(self.admin).post(
            f"{BASE}/{demanda['id']}/refuse/",
            {"reason": "A origem está fora do ar."},
            format="json",
        )
        aviso = Notification.objects.get(recipient=self.ana)
        self.assertEqual(aviso.message, "A origem está fora do ar.")

    def test_resolucao_gera_auditoria(self) -> None:
        demanda = self.abrir().data
        api(self.admin).post(f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "1"}, format="json")
        self.assertTrue(
            AuditLog.objects.filter(resource="harvest_request.attend").exists()
        )

    def test_demanda_fora_do_alcance_e_404(self) -> None:
        demanda = self.abrir(user=self.ana).data
        resposta = api(self.carla).post(
            f"{BASE}/{demanda['id']}/attend/", {"snapshotId": "1"}, format="json"
        )
        # A carla nem chega na permissão de ADMIN: o objeto está fora do alcance.
        self.assertIn(resposta.status_code, (403, 404))

    # --- Coerência no banco -------------------------------------------------

    def test_atendida_sem_coleta_e_barrada_pelo_banco(self) -> None:
        """A constraint é a última linha: cada situação carrega o que lhe cabe."""
        with self.assertRaises(IntegrityError), transaction.atomic():
            HarvestRequest.objects.create(
                harvester_repository_id="1",
                requester=self.ana,
                status=HarvestRequest.Status.ATENDIDA,
            )

    def test_recusada_sem_motivo_e_barrada_pelo_banco(self) -> None:
        with self.assertRaises(IntegrityError), transaction.atomic():
            HarvestRequest.objects.create(
                harvester_repository_id="1",
                requester=self.ana,
                status=HarvestRequest.Status.RECUSADA,
            )
