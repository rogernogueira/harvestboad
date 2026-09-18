"""Notificações: criação, alcance e leitura compartilhada.

Esta app não fala com o Harvester, então não há duplê a montar — o que se
verifica aqui é quem pode criar, quem enxerga o quê, e o efeito de uma leitura
sobre os demais gestores do mesmo repositório.
"""

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Profile, User
from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.repositories.models import RepositoryAccess

BASE = "/api/v1/notifications"


def api(user=None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class NotificationCreateAPITests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="adm", email="adm@ibict.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="ana", email="ana@ibict.br", password="x", profile=Profile.GESTOR
        )

    def setUp(self) -> None:
        cache.clear()

    def test_admin_cria_notificacao_para_repositorio(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/",
            {
                "title": "Coleta parada",
                "message": "O repositório não coleta há 90 dias.",
                "category": "COLETA",
                "harvesterRepositoryId": "1616",
                "acronym": "UFT-8",
            },
            format="json",
        )
        self.assertEqual(resposta.status_code, 201)
        self.assertEqual(resposta.data["harvesterRepositoryId"], "1616")
        self.assertIsNone(resposta.data["recipient"])
        self.assertFalse(resposta.data["read"])

    def test_admin_cria_recado_direto_para_gestor(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/",
            {
                "title": "Bem-vinda",
                "message": "Sua conta foi criada.",
                "category": "COMUNICACAO",
                "recipient": self.gestor.pk,
            },
            format="json",
        )
        self.assertEqual(resposta.status_code, 201)
        self.assertEqual(resposta.data["recipient"], self.gestor.pk)
        self.assertEqual(resposta.data["harvesterRepositoryId"], "")

    def test_gestor_nao_pode_criar_notificacao(self) -> None:
        resposta = api(self.gestor).post(
            f"{BASE}/",
            {"title": "t", "message": "m", "category": "COLETA", "harvesterRepositoryId": "1"},
            format="json",
        )
        self.assertEqual(resposta.status_code, 403)

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(api().get(f"{BASE}/").status_code, 401)

    def test_destino_com_repositorio_e_gestor_e_rejeitado(self) -> None:
        """Os dois destinos ao mesmo tempo contariam a notificação duas vezes."""
        resposta = api(self.admin).post(
            f"{BASE}/",
            {
                "title": "t",
                "message": "m",
                "category": "COLETA",
                "harvesterRepositoryId": "1",
                "recipient": self.gestor.pk,
            },
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_destino_vazio_e_rejeitado(self) -> None:
        """Sem destino, a notificação nasceria invisível para todo mundo."""
        resposta = api(self.admin).post(
            f"{BASE}/",
            {"title": "t", "message": "m", "category": "COLETA"},
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_destino_duplo_e_barrado_pelo_banco(self) -> None:
        """A constraint é a última linha de defesa, furando o serializer."""
        with self.assertRaises(IntegrityError), transaction.atomic():
            Notification.objects.create(
                title="t",
                message="m",
                category=Notification.Category.COLETA,
                harvester_repository_id="1",
                recipient=self.gestor,
            )

    def test_recado_direto_nao_aceita_admin(self) -> None:
        """O ADMIN não tem caixa de entrada: ele já enxerga tudo."""
        resposta = api(self.admin).post(
            f"{BASE}/",
            {"title": "t", "message": "m", "category": "COLETA", "recipient": self.admin.pk},
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_mensagem_longa_demais_e_rejeitada(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/",
            {
                "title": "t",
                "message": "x" * 2001,
                "category": "COLETA",
                "harvesterRepositoryId": "1",
            },
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_criacao_gera_auditoria(self) -> None:
        api(self.admin).post(
            f"{BASE}/",
            {"title": "t", "message": "m", "category": "COLETA", "harvesterRepositoryId": "1"},
            format="json",
        )
        log = AuditLog.objects.get(action=AuditLog.Action.CREATE, resource="notification")
        self.assertEqual(log.user, self.admin)


class NotificationVisibilityAPITests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="adm", email="adm@ibict.br", password="x", profile=Profile.ADMIN
        )
        # Ana e Bruno cuidam do repositório 1; Carla cuida do 9.
        cls.ana = User.objects.create_user(
            username="ana", email="ana@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.bruno = User.objects.create_user(
            username="bruno", email="bru@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.carla = User.objects.create_user(
            username="carla", email="car@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.sem_vinculo = User.objects.create_user(
            username="dora", email="dor@ibict.br", password="x", profile=Profile.GESTOR
        )
        RepositoryAccess.objects.create(user=cls.ana, harvester_repository_id="1", acronym="A")
        RepositoryAccess.objects.create(user=cls.bruno, harvester_repository_id="1", acronym="A")
        RepositoryAccess.objects.create(user=cls.carla, harvester_repository_id="9", acronym="C")

        cls.do_um = Notification.objects.create(
            title="do 1", message="m", category=Notification.Category.COLETA,
            harvester_repository_id="1", acronym="A",
        )
        cls.do_nove = Notification.objects.create(
            title="do 9", message="m", category=Notification.Category.COLETA,
            harvester_repository_id="9", acronym="C",
        )
        cls.para_ana = Notification.objects.create(
            title="para ana", message="m", category=Notification.Category.COMUNICACAO,
            recipient=cls.ana,
        )

    def setUp(self) -> None:
        cache.clear()

    def titulos(self, user) -> set[str]:
        resposta = api(user).get(f"{BASE}/")
        self.assertEqual(resposta.status_code, 200)
        return {item["title"] for item in resposta.data["results"]}

    def test_gestor_ve_as_do_seu_repositorio_e_os_proprios_recados(self) -> None:
        self.assertEqual(self.titulos(self.ana), {"do 1", "para ana"})

    def test_gestor_nao_ve_as_de_repositorio_alheio(self) -> None:
        self.assertNotIn("do 9", self.titulos(self.ana))

    def test_gestor_nao_ve_recado_direto_de_outro(self) -> None:
        """O ramo do destinatário é estritamente pessoal, mesmo entre colegas."""
        self.assertEqual(self.titulos(self.bruno), {"do 1"})

    def test_gestor_sem_vinculo_ve_lista_vazia(self) -> None:
        self.assertEqual(self.titulos(self.sem_vinculo), set())

    def test_sino_do_admin_nao_lista_o_acervo_inteiro(self) -> None:
        """A caixa de entrada segue o vínculo real, não o contrato `None = todos`.

        Se usasse `accessible_repository_ids()`, o sino do administrador
        acenderia com a notificação de todo repositório do acervo.
        """
        self.assertEqual(self.titulos(self.admin), set())

    def test_filtro_por_repositorio_exige_vinculo(self) -> None:
        self.assertEqual(api(self.ana).get(f"{BASE}/?repository=9").status_code, 403)

    def test_filtro_por_repositorio_do_gestor(self) -> None:
        resposta = api(self.ana).get(f"{BASE}/?repository=1")
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual([i["title"] for i in resposta.data["results"]], ["do 1"])

    def test_admin_alcanca_qualquer_repositorio(self) -> None:
        resposta = api(self.admin).get(f"{BASE}/?repository=9")
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual([i["title"] for i in resposta.data["results"]], ["do 9"])

    def test_filtra_apenas_nao_lidas(self) -> None:
        self.do_um.read_at = "2026-01-01T00:00:00Z"
        self.do_um.save(update_fields=["read_at"])
        resposta = api(self.ana).get(f"{BASE}/?unread=true")
        self.assertEqual([i["title"] for i in resposta.data["results"]], ["para ana"])


class NotificationReadAPITests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
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
        self.notificacao = Notification.objects.create(
            title="do 1", message="m", category=Notification.Category.COLETA,
            harvester_repository_id="1", acronym="A",
        )

    def test_listar_nao_marca_como_lida(self) -> None:
        """Abrir o painel não pode apagar o aviso da equipe inteira."""
        api(self.ana).get(f"{BASE}/")
        self.notificacao.refresh_from_db()
        self.assertIsNone(self.notificacao.read_at)

    def test_leitura_de_um_gestor_vale_para_os_outros(self) -> None:
        resposta = api(self.ana).post(f"{BASE}/{self.notificacao.pk}/read/")
        self.assertEqual(resposta.status_code, 200)

        vistas_por_bruno = api(self.bruno).get(f"{BASE}/?unread=true")
        self.assertEqual(vistas_por_bruno.data["results"], [])

    def test_segunda_leitura_preserva_quem_leu_primeiro(self) -> None:
        api(self.ana).post(f"{BASE}/{self.notificacao.pk}/read/")
        api(self.bruno).post(f"{BASE}/{self.notificacao.pk}/read/")

        self.notificacao.refresh_from_db()
        self.assertEqual(self.notificacao.read_by, self.ana)

    def test_reclique_nao_duplica_auditoria(self) -> None:
        api(self.ana).post(f"{BASE}/{self.notificacao.pk}/read/")
        api(self.bruno).post(f"{BASE}/{self.notificacao.pk}/read/")

        trilha = AuditLog.objects.filter(resource="notification.read")
        self.assertEqual(trilha.count(), 1)

    def test_gestor_de_outro_repositorio_recebe_404(self) -> None:
        """404, e não 403: a existência do registro alheio não é informação a dar."""
        resposta = api(self.carla).post(f"{BASE}/{self.notificacao.pk}/read/")
        self.assertEqual(resposta.status_code, 404)
        self.notificacao.refresh_from_db()
        self.assertIsNone(self.notificacao.read_at)

    def test_contador_do_sino(self) -> None:
        resposta = api(self.ana).get(f"{BASE}/unread-count/")
        self.assertEqual(resposta.data, {"unread": 1})

        api(self.ana).post(f"{BASE}/{self.notificacao.pk}/read/")
        self.assertEqual(api(self.ana).get(f"{BASE}/unread-count/").data, {"unread": 0})


class NotificationLifecycleTests(TestCase):
    def test_recado_direto_some_com_a_conta(self) -> None:
        gestor = User.objects.create_user(
            username="ana", email="ana@ibict.br", password="x", profile=Profile.GESTOR
        )
        Notification.objects.create(
            title="t", message="m", category=Notification.Category.COMUNICACAO,
            recipient=gestor,
        )
        gestor.delete()
        self.assertEqual(Notification.objects.count(), 0)

    def test_autor_removido_preserva_a_notificacao(self) -> None:
        """Mesmo critério da trilha de auditoria: o histórico não some junto."""
        admin = User.objects.create_user(
            username="adm", email="adm@ibict.br", password="x", profile=Profile.ADMIN
        )
        Notification.objects.create(
            title="t", message="m", category=Notification.Category.COLETA,
            harvester_repository_id="1", author=admin,
        )
        admin.delete()
        self.assertEqual(Notification.objects.count(), 1)
        self.assertIsNone(Notification.objects.get().author)
