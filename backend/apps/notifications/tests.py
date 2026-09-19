"""Notificações: criação, alcance e leitura compartilhada.

Esta app não fala com o Harvester, então não há duplê a montar — o que se
verifica aqui é quem pode criar, quem enxerga o quê, e o efeito de uma leitura
sobre os demais gestores do mesmo repositório.
"""

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Profile, User
from apps.audit.models import AuditLog
from apps.notifications.models import (
    Notification,
    NotificationCategory,
    NotificationTemplate,
)
from apps.repositories.models import RepositoryAccess

BASE = "/api/v1/notifications"


def COLETA() -> NotificationCategory:
    """Categoria semeada pela migração 0004. Buscada, não criada."""
    return NotificationCategory.objects.get(slug="coleta")


def COMUNICACAO() -> NotificationCategory:
    return NotificationCategory.objects.get(slug="comunicacao")


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
                "category": COLETA().pk,
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
                "category": COMUNICACAO().pk,
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
            {"title": "t", "message": "m", "category": COLETA().pk, "harvesterRepositoryId": "1"},
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
                "category": COLETA().pk,
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
            {"title": "t", "message": "m", "category": COLETA().pk},
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_destino_duplo_e_barrado_pelo_banco(self) -> None:
        """A constraint é a última linha de defesa, furando o serializer."""
        with self.assertRaises(IntegrityError), transaction.atomic():
            Notification.objects.create(
                title="t",
                message="m",
                category=cls.coleta if False else COLETA(),
                harvester_repository_id="1",
                recipient=self.gestor,
            )

    def test_recado_direto_nao_aceita_admin(self) -> None:
        """O ADMIN não tem caixa de entrada: ele já enxerga tudo."""
        resposta = api(self.admin).post(
            f"{BASE}/",
            {"title": "t", "message": "m", "category": COLETA().pk, "recipient": self.admin.pk},
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_mensagem_longa_demais_e_rejeitada(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/",
            {
                "title": "t",
                "message": "x" * 2001,
                "category": COLETA().pk,
                "harvesterRepositoryId": "1",
            },
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_criacao_gera_auditoria(self) -> None:
        api(self.admin).post(
            f"{BASE}/",
            {"title": "t", "message": "m", "category": COLETA().pk, "harvesterRepositoryId": "1"},
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
            title="do 1", message="m", category=cls.coleta if False else COLETA(),
            harvester_repository_id="1", acronym="A",
        )
        cls.do_nove = Notification.objects.create(
            title="do 9", message="m", category=cls.coleta if False else COLETA(),
            harvester_repository_id="9", acronym="C",
        )
        cls.para_ana = Notification.objects.create(
            title="para ana", message="m", category=COMUNICACAO(),
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
            title="do 1", message="m", category=cls.coleta if False else COLETA(),
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
            title="t", message="m", category=COMUNICACAO(),
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
            title="t", message="m", category=cls.coleta if False else COLETA(),
            harvester_repository_id="1", author=admin,
        )
        admin.delete()
        self.assertEqual(Notification.objects.count(), 1)
        self.assertIsNone(Notification.objects.get().author)


class NotificationBulkAPITests(TestCase):
    """Envio em lote e exclusão, a gestão do administrador."""

    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="adm", email="adm@ibict.br", password="x", profile=Profile.ADMIN
        )
        cls.ana = User.objects.create_user(
            username="ana", email="ana@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.bruno = User.objects.create_user(
            username="bruno", email="bru@ibict.br", password="x", profile=Profile.GESTOR
        )
        RepositoryAccess.objects.create(user=cls.ana, harvester_repository_id="1", acronym="A")
        RepositoryAccess.objects.create(user=cls.bruno, harvester_repository_id="1", acronym="A")

    def setUp(self) -> None:
        cache.clear()

    def corpo(self, **extra) -> dict:
        return {"title": "t", "message": "m", "category": COLETA().pk, **extra}

    def test_envia_para_varios_repositorios_e_gestores(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/bulk/",
            self.corpo(
                repositories=[
                    {"harvesterRepositoryId": "1", "acronym": "A"},
                    {"harvesterRepositoryId": "9", "acronym": "C"},
                ],
                recipients=[self.ana.pk],
            ),
            format="json",
        )
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.data["createdCount"], 3)
        self.assertEqual(Notification.objects.count(), 3)

    def test_repositorio_repetido_no_lote_e_ignorado(self) -> None:
        """Repetir uma seleção não é erro do usuário, é a tela."""
        resposta = api(self.admin).post(
            f"{BASE}/bulk/",
            self.corpo(
                repositories=[
                    {"harvesterRepositoryId": "1", "acronym": "A"},
                    {"harvesterRepositoryId": "1", "acronym": "A"},
                ]
            ),
            format="json",
        )
        self.assertEqual(resposta.data["createdCount"], 1)

    def test_lote_sem_destino_e_rejeitado(self) -> None:
        resposta = api(self.admin).post(f"{BASE}/bulk/", self.corpo(), format="json")
        self.assertEqual(resposta.status_code, 400)

    def test_gestor_nao_pode_enviar_em_lote(self) -> None:
        resposta = api(self.ana).post(
            f"{BASE}/bulk/",
            self.corpo(repositories=[{"harvesterRepositoryId": "1", "acronym": "A"}]),
            format="json",
        )
        self.assertEqual(resposta.status_code, 403)

    def test_cada_notificacao_do_lote_gera_auditoria(self) -> None:
        api(self.admin).post(
            f"{BASE}/bulk/",
            self.corpo(
                repositories=[
                    {"harvesterRepositoryId": "1", "acronym": "A"},
                    {"harvesterRepositoryId": "9", "acronym": "C"},
                ]
            ),
            format="json",
        )
        trilha = AuditLog.objects.filter(action=AuditLog.Action.CREATE, resource="notification")
        self.assertEqual(trilha.count(), 2)

    def test_admin_exclui_notificacao(self) -> None:
        notificacao = Notification.objects.create(
            title="t", message="m", category=cls.coleta if False else COLETA(),
            harvester_repository_id="1",
        )
        resposta = api(self.admin).delete(f"{BASE}/{notificacao.pk}/")
        self.assertEqual(resposta.status_code, 204)
        self.assertFalse(Notification.objects.filter(pk=notificacao.pk).exists())
        self.assertTrue(
            AuditLog.objects.filter(action=AuditLog.Action.DELETE, resource="notification").exists()
        )

    def test_gestor_nao_exclui(self) -> None:
        notificacao = Notification.objects.create(
            title="t", message="m", category=cls.coleta if False else COLETA(),
            harvester_repository_id="1",
        )
        self.assertEqual(api(self.ana).delete(f"{BASE}/{notificacao.pk}/").status_code, 403)
        self.assertTrue(Notification.objects.filter(pk=notificacao.pk).exists())

    def test_enviadas_trazem_os_gestores_pendentes(self) -> None:
        """Com visto compartilhado, pendente é o repositório inteiro ou ninguém."""
        Notification.objects.create(
            title="t", message="m", category=cls.coleta if False else COLETA(),
            harvester_repository_id="1", acronym="A", author=self.admin,
        )
        resposta = api(self.admin).get(f"{BASE}/?sent=true")
        self.assertEqual(resposta.data["results"][0]["pendingManagers"], ["ana", "bruno"])

    def test_notificacao_vista_nao_tem_pendentes(self) -> None:
        notificacao = Notification.objects.create(
            title="t", message="m", category=cls.coleta if False else COLETA(),
            harvester_repository_id="1", acronym="A", author=self.admin,
        )
        api(self.ana).post(f"{BASE}/{notificacao.pk}/read/")
        resposta = api(self.admin).get(f"{BASE}/?sent=true")
        self.assertEqual(resposta.data["results"][0]["pendingManagers"], [])

    def test_pendentes_saem_em_uma_consulta(self) -> None:
        """O mapa é montado uma vez para a página, não uma vez por linha."""
        for identificador in ("1", "9", "7"):
            Notification.objects.create(
                title="t", message="m", category=cls.coleta if False else COLETA(),
                harvester_repository_id=identificador, author=self.admin,
            )
        cliente = api(self.admin)
        with self.assertNumQueries(4):
            cliente.get(f"{BASE}/?sent=true")

    def test_exige_visto_viaja_ate_a_tela(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/",
            {
                "title": "t", "message": "m", "category": COLETA().pk,
                "harvesterRepositoryId": "1", "requiresAcknowledgement": True,
            },
            format="json",
        )
        self.assertEqual(resposta.status_code, 201)
        self.assertTrue(resposta.data["requiresAcknowledgement"])


class NotificationCatalogAPITests(TestCase):
    """Cadastro de categorias e de textos padrão."""

    CATEGORIAS = "/api/v1/notifications/categories/"
    TEXTOS = "/api/v1/notifications/templates/"

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

    def test_migracao_semeou_as_quatro_categorias(self) -> None:
        """As que eram enum viraram linhas, já com os três idiomas."""
        resposta = api(self.gestor).get(self.CATEGORIAS)
        self.assertEqual(resposta.status_code, 200)
        por_slug = {c["slug"]: c for c in resposta.data}
        self.assertEqual(
            set(por_slug), {"comunicacao", "novidades", "coleta", "validacao"}
        )
        self.assertEqual(por_slug["coleta"]["nameEn"], "Harvest")
        self.assertEqual(por_slug["coleta"]["nameEs"], "Recolección")

    def test_admin_cadastra_categoria(self) -> None:
        resposta = api(self.admin).post(
            self.CATEGORIAS,
            {"slug": "manutencao", "namePtBr": "Manutenção", "nameEs": "Mantenimiento",
             "nameEn": "Maintenance"},
            format="json",
        )
        self.assertEqual(resposta.status_code, 201)
        self.assertTrue(
            AuditLog.objects.filter(
                action=AuditLog.Action.CREATE, resource="notification_category"
            ).exists()
        )

    def test_gestor_nao_cadastra_categoria(self) -> None:
        resposta = api(self.gestor).post(
            self.CATEGORIAS, {"slug": "x", "namePtBr": "X"}, format="json"
        )
        self.assertEqual(resposta.status_code, 403)

    def test_gestor_le_o_catalogo(self) -> None:
        """Ele precisa do nome para desenhar o selo da própria notificação."""
        self.assertEqual(api(self.gestor).get(self.CATEGORIAS).status_code, 200)

    def test_slug_repetido_e_rejeitado(self) -> None:
        resposta = api(self.admin).post(
            self.CATEGORIAS, {"slug": "coleta", "namePtBr": "Outra"}, format="json"
        )
        self.assertEqual(resposta.status_code, 400)

    def test_nomes_traduzidos_sao_opcionais(self) -> None:
        resposta = api(self.admin).post(
            self.CATEGORIAS, {"slug": "so-pt", "namePtBr": "Só português"}, format="json"
        )
        self.assertEqual(resposta.status_code, 201)
        categoria = NotificationCategory.objects.get(slug="so-pt")
        self.assertEqual(categoria.name_for("en"), "Só português")
        self.assertEqual(categoria.name_for("es"), "Só português")

    def test_nome_cai_no_idioma_base_da_variante(self) -> None:
        """`es-AR` resolve para `es`, como o i18next faz com a variante."""
        self.assertEqual(COLETA().name_for("es-AR"), "Recolección")

    def test_categoria_usada_nao_pode_ser_excluida(self) -> None:
        """O `PROTECT` guarda o histórico; a saída é desativar."""
        Notification.objects.create(
            title="t", message="m", category=COLETA(), harvester_repository_id="1"
        )
        with self.assertRaises(ProtectedError), transaction.atomic():
            COLETA().delete()

    def test_desativar_tira_do_formulario_mas_preserva_o_historico(self) -> None:
        categoria = COLETA()
        Notification.objects.create(
            title="t", message="m", category=categoria, harvester_repository_id="1"
        )
        resposta = api(self.admin).patch(
            f"{self.CATEGORIAS}{categoria.pk}/", {"active": False}, format="json"
        )
        self.assertEqual(resposta.status_code, 200)

        # Sai da escolha de um aviso novo…
        recusa = api(self.admin).post(
            f"{BASE}/",
            {"title": "t", "message": "m", "category": categoria.pk,
             "harvesterRepositoryId": "1"},
            format="json",
        )
        self.assertEqual(recusa.status_code, 400)

        # …mas continua no catálogo, para o selo do que já foi enviado.
        catalogo = api(self.admin).get(self.CATEGORIAS)
        self.assertIn(categoria.pk, [c["id"] for c in catalogo.data])

    def test_admin_cadastra_texto_padrao(self) -> None:
        resposta = api(self.admin).post(
            self.TEXTOS,
            {"category": COLETA().pk, "label": "Coleta parada",
             "title": "Coleta parada", "message": "Verifique o endpoint OAI."},
            format="json",
        )
        self.assertEqual(resposta.status_code, 201)

    def test_texto_padrao_filtra_por_categoria(self) -> None:
        NotificationTemplate.objects.create(
            category=COLETA(), label="A", title="A", message="m"
        )
        NotificationTemplate.objects.create(
            category=COMUNICACAO(), label="B", title="B", message="m"
        )
        resposta = api(self.admin).get(f"{self.TEXTOS}?category={COLETA().pk}")
        self.assertEqual([t["label"] for t in resposta.data], ["A"])

    def test_rotulo_repetido_na_mesma_categoria_e_rejeitado(self) -> None:
        NotificationTemplate.objects.create(
            category=COLETA(), label="A", title="A", message="m"
        )
        resposta = api(self.admin).post(
            self.TEXTOS,
            {"category": COLETA().pk, "label": "A", "title": "x", "message": "m"},
            format="json",
        )
        self.assertEqual(resposta.status_code, 400)

    def test_gestor_nao_cadastra_texto_padrao(self) -> None:
        resposta = api(self.gestor).post(
            self.TEXTOS,
            {"category": COLETA().pk, "label": "A", "title": "A", "message": "m"},
            format="json",
        )
        self.assertEqual(resposta.status_code, 403)

    def test_filtro_de_categoria_invalido_e_400(self) -> None:
        """Parâmetro malformado é erro de quem pede, não 500 do servidor."""
        resposta = api(self.admin).get(f"{self.TEXTOS}?category=null")
        self.assertEqual(resposta.status_code, 400)


class NotificationScopeAPITests(TestCase):
    """Alcance amplo: todos os gestores, todos os repositórios."""

    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="adm", email="adm@ibict.br", password="x", profile=Profile.ADMIN
        )
        cls.ana = User.objects.create_user(
            username="ana", email="ana@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.bruno = User.objects.create_user(
            username="bruno", email="bru@ibict.br", password="x", profile=Profile.GESTOR
        )
        cls.inativo = User.objects.create_user(
            username="sai", email="sai@ibict.br", password="x", profile=Profile.GESTOR,
            is_active=False,
        )
        # 1 tem dois gestores; 9 tem um. Nenhum outro repositório tem vínculo.
        RepositoryAccess.objects.create(user=cls.ana, harvester_repository_id="1", acronym="A")
        RepositoryAccess.objects.create(user=cls.bruno, harvester_repository_id="1", acronym="A")
        RepositoryAccess.objects.create(user=cls.ana, harvester_repository_id="9", acronym="C")

    def setUp(self) -> None:
        cache.clear()

    def corpo(self, **extra) -> dict:
        return {"title": "t", "message": "m", "category": COLETA().pk, **extra}

    def test_todos_os_gestores_alcanca_os_ativos(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/bulk/", self.corpo(scope="ALL_MANAGERS"), format="json"
        )
        self.assertEqual(resposta.data["createdCount"], 2)
        alcancados = set(
            Notification.objects.values_list("recipient__username", flat=True)
        )
        self.assertEqual(alcancados, {"ana", "bruno"})

    def test_todos_os_gestores_ignora_conta_inativa(self) -> None:
        """Conta desativada não lê nada; mandar para ela é só ruído no histórico."""
        api(self.admin).post(f"{BASE}/bulk/", self.corpo(scope="ALL_MANAGERS"), format="json")
        self.assertFalse(Notification.objects.filter(recipient=self.inativo).exists())

    def test_todos_os_repositorios_sao_os_que_tem_gestor(self) -> None:
        """Repositório sem vínculo não entra: não haveria quem lesse o aviso."""
        resposta = api(self.admin).post(
            f"{BASE}/bulk/", self.corpo(scope="ALL_REPOSITORIES"), format="json"
        )
        self.assertEqual(resposta.data["createdCount"], 2)
        self.assertEqual(
            set(Notification.objects.values_list("harvester_repository_id", flat=True)),
            {"1", "9"},
        )

    def test_repositorio_com_dois_gestores_recebe_um_aviso_so(self) -> None:
        """O destino é o repositório, não cada vínculo — senão sairia duplicado."""
        api(self.admin).post(f"{BASE}/bulk/", self.corpo(scope="ALL_REPOSITORIES"), format="json")
        self.assertEqual(Notification.objects.filter(harvester_repository_id="1").count(), 1)

    def test_alcance_nao_duplica_o_que_ja_foi_escolhido(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/bulk/",
            self.corpo(
                scope="ALL_REPOSITORIES",
                repositories=[{"harvesterRepositoryId": "1", "acronym": "A"}],
            ),
            format="json",
        )
        self.assertEqual(resposta.data["createdCount"], 2)
        self.assertEqual(Notification.objects.filter(harvester_repository_id="1").count(), 1)

    def test_alcance_invalido_e_rejeitado(self) -> None:
        resposta = api(self.admin).post(
            f"{BASE}/bulk/", self.corpo(scope="TODO_MUNDO"), format="json"
        )
        self.assertEqual(resposta.status_code, 400)

    def test_gestor_nao_dispara_alcance_amplo(self) -> None:
        resposta = api(self.ana).post(
            f"{BASE}/bulk/", self.corpo(scope="ALL_MANAGERS"), format="json"
        )
        self.assertEqual(resposta.status_code, 403)
