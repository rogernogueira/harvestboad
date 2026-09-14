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
