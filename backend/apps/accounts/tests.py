"""Testes das contas.

O foco é a listagem de usuários: ela existe para a tela do ADMIN e não pode
estar disponível ao gestor.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Profile

User = get_user_model()

USERS = "/api/v1/accounts/users/"
ME = "/api/v1/auth/me/"


class UserListTests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="admin", email="admin@ibict.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="gestor", email="gestor@ibict.br", password="x", profile=Profile.GESTOR,
            first_name="Maria", last_name="Silva",
        )
        cls.inativo = User.objects.create_user(
            username="antigo", email="antigo@ibict.br", password="x",
            profile=Profile.GESTOR, is_active=False,
        )

    def api(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().get(USERS).status_code, 401)

    def test_gestor_nao_lista_usuarios(self) -> None:
        """A relação de contas é assunto de administração, não do gestor."""
        self.assertEqual(self.api(self.gestor).get(USERS).status_code, 403)

    def test_admin_lista_todos(self) -> None:
        response = self.api(self.admin).get(USERS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 3)

    def test_filtra_por_perfil(self) -> None:
        response = self.api(self.admin).get(f"{USERS}?profile=GESTOR")
        nomes = {linha["username"] for linha in response.data["results"]}
        self.assertEqual(nomes, {"gestor", "antigo"})

    def test_filtra_por_ativos(self) -> None:
        response = self.api(self.admin).get(f"{USERS}?profile=GESTOR&active=true")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["username"], "gestor")

    def test_busca_por_nome_e_email(self) -> None:
        for termo in ("Maria", "Silva", "gestor@ibict"):
            with self.subTest(termo=termo):
                response = self.api(self.admin).get(f"{USERS}?search={termo}")
                self.assertEqual(response.data["count"], 1)
                self.assertEqual(response.data["results"][0]["username"], "gestor")

    def test_perfil_invalido_e_ignorado(self) -> None:
        """Valor fora do vocabulário não deve silenciosamente zerar a lista."""
        response = self.api(self.admin).get(f"{USERS}?profile=QUALQUER")
        self.assertEqual(response.data["count"], 3)

    def test_nao_expoe_senha(self) -> None:
        response = self.api(self.admin).get(USERS)
        self.assertNotIn("password", response.data["results"][0])


class UserCreateTests(TestCase):
    """Criação de conta pelo ADMIN."""

    @classmethod
    def setUpTestData(cls) -> None:
        cls.admin = User.objects.create_user(
            username="chefe", email="chefe@ibict.br", password="x", profile=Profile.ADMIN
        )
        cls.gestor = User.objects.create_user(
            username="ges", email="ges@ibict.br", password="x", profile=Profile.GESTOR
        )

    def api(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def payload(self, **overrides) -> dict:
        base = {
            "username": "novo",
            "email": "novo@ibict.br",
            "first_name": "Ana",
            "last_name": "Souza",
            "profile": Profile.GESTOR,
            "password": "Integra!2026#ibict",
        }
        base.update(overrides)
        return base

    def test_gestor_nao_cria_conta(self) -> None:
        response = self.api(self.gestor).post(USERS, self.payload(), format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username="novo").exists())

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().post(USERS, self.payload(), format="json").status_code, 401)

    def test_admin_cria_conta(self) -> None:
        response = self.api(self.admin).post(USERS, self.payload(), format="json")
        self.assertEqual(response.status_code, 201)

        criado = User.objects.get(username="novo")
        self.assertEqual(criado.email, "novo@ibict.br")
        self.assertEqual(criado.profile, Profile.GESTOR)
        self.assertTrue(criado.is_active)

    def test_conta_nasce_exigindo_troca_de_senha(self) -> None:
        """A senha informada pelo ADMIN é provisória por construção."""
        self.api(self.admin).post(USERS, self.payload(), format="json")
        self.assertTrue(User.objects.get(username="novo").must_change_password)

    def test_senha_e_gravada_com_hash_e_funciona(self) -> None:
        self.api(self.admin).post(USERS, self.payload(), format="json")
        criado = User.objects.get(username="novo")
        self.assertNotEqual(criado.password, "Integra!2026#ibict")
        self.assertTrue(criado.check_password("Integra!2026#ibict"))

    def test_resposta_nao_devolve_a_senha(self) -> None:
        response = self.api(self.admin).post(USERS, self.payload(), format="json")
        self.assertNotIn("password", response.data)

    def test_senha_fraca_e_recusada(self) -> None:
        response = self.api(self.admin).post(
            USERS, self.payload(password="123"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)
        self.assertFalse(User.objects.filter(username="novo").exists())

    def test_usuario_duplicado_e_recusado(self) -> None:
        response = self.api(self.admin).post(
            USERS, self.payload(username="ges", email="outro@ibict.br"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)

    def test_email_duplicado_e_recusado_sem_diferenciar_caixa(self) -> None:
        response = self.api(self.admin).post(
            USERS, self.payload(email="GES@IBICT.BR"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_admin_cadastra_contato_do_gestor(self) -> None:
        self.api(self.admin).post(
            USERS,
            self.payload(
                phone="(61) 3217-6360 r. 214",
                institution="IBICT",
                departmentEmail="ridi@ibict.br",
            ),
            format="json",
        )
        criado = User.objects.get(username="novo")
        self.assertEqual(criado.phone, "(61) 3217-6360 r. 214")
        self.assertEqual(criado.institution, "IBICT")
        self.assertEqual(criado.department_email, "ridi@ibict.br")

    def test_contato_do_gestor_e_opcional(self) -> None:
        """Quem cadastra nem sempre tem o contato à mão; o dono completa depois."""
        response = self.api(self.admin).post(USERS, self.payload(), format="json")
        self.assertEqual(response.status_code, 201)
        criado = User.objects.get(username="novo")
        self.assertEqual(criado.phone, "")
        self.assertEqual(criado.institution, "")
        self.assertEqual(criado.department_email, "")

    def test_email_do_setor_invalido_e_recusado(self) -> None:
        response = self.api(self.admin).post(
            USERS, self.payload(departmentEmail="setor-arroba-ibict"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("departmentEmail", response.data)
        self.assertFalse(User.objects.filter(username="novo").exists())

    def test_email_do_setor_pode_repetir(self) -> None:
        """O endereço é do setor: a equipe toda declara o mesmo."""
        self.gestor.department_email = "ridi@ibict.br"
        self.gestor.save(update_fields=["department_email"])

        response = self.api(self.admin).post(
            USERS, self.payload(departmentEmail="ridi@ibict.br"), format="json"
        )
        self.assertEqual(response.status_code, 201)

    def test_criacao_gera_registro_de_auditoria(self) -> None:
        from apps.audit.models import AuditLog

        self.api(self.admin).post(USERS, self.payload(), format="json")
        log = AuditLog.objects.get(action=AuditLog.Action.CREATE, resource="user")
        self.assertEqual(log.user, self.admin)



class ProfileUpdateTests(TestCase):
    """Atualização do próprio cadastro em `PATCH /auth/me/`."""

    def setUp(self) -> None:
        self.gestor = User.objects.create_user(
            username="gestor",
            email="gestor@ibict.br",
            password="x",
            profile=Profile.GESTOR,
            first_name="Maria",
            last_name="Silva",
        )
        self.outro = User.objects.create_user(
            username="outro", email="outro@ibict.br", password="x", profile=Profile.GESTOR
        )

    def api(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_sem_autenticacao_401(self) -> None:
        self.assertEqual(APIClient().patch(ME, {"phone": "61"}, format="json").status_code, 401)

    def test_leitura_traz_o_contato(self) -> None:
        self.gestor.phone = "(61) 3217-6360"
        self.gestor.institution = "IBICT"
        self.gestor.department_email = "ridi@ibict.br"
        self.gestor.save(update_fields=["phone", "institution", "department_email"])

        response = self.api(self.gestor).get(ME)
        self.assertEqual(response.data["phone"], "(61) 3217-6360")
        self.assertEqual(response.data["institution"], "IBICT")
        self.assertEqual(response.data["departmentEmail"], "ridi@ibict.br")

    def test_gestor_atualiza_o_proprio_cadastro(self) -> None:
        response = self.api(self.gestor).patch(
            ME,
            {
                "first_name": "Maria Clara",
                "email": "maria@ibict.br",
                "phone": "(61) 3217-6360 r. 214",
                "institution": "Universidade Federal do Tocantins",
                "departmentEmail": "biblioteca@uft.edu.br",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        self.gestor.refresh_from_db()
        self.assertEqual(self.gestor.first_name, "Maria Clara")
        self.assertEqual(self.gestor.email, "maria@ibict.br")
        self.assertEqual(self.gestor.phone, "(61) 3217-6360 r. 214")
        self.assertEqual(self.gestor.institution, "Universidade Federal do Tocantins")
        self.assertEqual(self.gestor.department_email, "biblioteca@uft.edu.br")

    def test_email_do_setor_pode_ser_apagado(self) -> None:
        """Deixar o campo em branco é resposta legítima, não erro de formato."""
        self.gestor.department_email = "ridi@ibict.br"
        self.gestor.save(update_fields=["department_email"])

        response = self.api(self.gestor).patch(ME, {"departmentEmail": ""}, format="json")
        self.assertEqual(response.status_code, 200)
        self.gestor.refresh_from_db()
        self.assertEqual(self.gestor.department_email, "")

    def test_email_do_setor_invalido_e_recusado(self) -> None:
        response = self.api(self.gestor).patch(
            ME, {"departmentEmail": "setor-arroba-ibict"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("departmentEmail", response.data)

    def test_resposta_traz_o_usuario_inteiro(self) -> None:
        """O frontend troca a sessão pelo que voltou, sem uma segunda ida."""
        response = self.api(self.gestor).patch(ME, {"phone": "61 99999-0000"}, format="json")
        self.assertEqual(response.data["username"], "gestor")
        self.assertEqual(response.data["profile"], Profile.GESTOR)
        self.assertEqual(response.data["phone"], "61 99999-0000")

    def test_parcial_nao_apaga_o_que_nao_veio(self) -> None:
        self.api(self.gestor).patch(ME, {"phone": "61 99999-0000"}, format="json")
        self.gestor.refresh_from_db()
        self.assertEqual(self.gestor.first_name, "Maria")

    def test_manter_o_proprio_email_e_aceito(self) -> None:
        """A checagem de duplicidade não pode barrar a própria conta."""
        response = self.api(self.gestor).patch(ME, {"email": "gestor@ibict.br"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_email_de_outra_conta_e_recusado_sem_diferenciar_caixa(self) -> None:
        for email in ("outro@ibict.br", "OUTRO@IBICT.BR"):
            with self.subTest(email=email):
                response = self.api(self.gestor).patch(ME, {"email": email}, format="json")
                self.assertEqual(response.status_code, 400)
                # A mesma mensagem nos dois casos: o engano é o mesmo, e a do
                # UniqueValidator só apareceria no que difere na caixa.
                self.assertEqual(
                    [str(m) for m in response.data["email"]],
                    ["Já existe uma conta com este e-mail."],
                )
        self.gestor.refresh_from_db()
        self.assertEqual(self.gestor.email, "gestor@ibict.br")

    def test_usuario_e_perfil_nao_mudam(self) -> None:
        """Quem decide perfil é a administração; usuário é a identidade do login."""
        self.api(self.gestor).patch(
            ME, {"username": "chefe", "profile": Profile.ADMIN}, format="json"
        )
        self.gestor.refresh_from_db()
        self.assertEqual(self.gestor.username, "gestor")
        self.assertEqual(self.gestor.profile, Profile.GESTOR)

    def test_senha_nao_muda_por_aqui(self) -> None:
        self.api(self.gestor).patch(ME, {"password": "outra-senha"}, format="json")
        self.gestor.refresh_from_db()
        self.assertTrue(self.gestor.check_password("x"))

    def test_atualizacao_gera_registro_de_auditoria(self) -> None:
        from apps.audit.models import AuditLog

        self.api(self.gestor).patch(ME, {"institution": "IBICT"}, format="json")
        log = AuditLog.objects.get(action=AuditLog.Action.UPDATE, resource="user.profile")
        self.assertEqual(log.user, self.gestor)
        self.assertEqual(log.resource_id, str(self.gestor.pk))
