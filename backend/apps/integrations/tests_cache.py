"""Testes do cache das respostas do Harvester.

O foco é o que não pode dar errado: nunca guardar falha, nunca deixar o cache
derrubar a aplicação e tratar valor vazio como valor.
"""

from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase

from .cache import cached


class CacheHelperTests(SimpleTestCase):
    def setUp(self) -> None:
        cache.clear()

    def test_produz_uma_vez_e_reaproveita(self) -> None:
        chamadas = []

        def produzir():
            chamadas.append(1)
            return {"valor": 42}

        self.assertEqual(cached("k", 60, produzir), {"valor": 42})
        self.assertEqual(cached("k", 60, produzir), {"valor": 42})
        self.assertEqual(len(chamadas), 1)

    def test_valor_vazio_tambem_e_cacheado(self) -> None:
        """Sentinela, não `is not None`: {} e [] são respostas legítimas."""
        chamadas = []

        def produzir():
            chamadas.append(1)
            return {}

        cached("vazio", 60, produzir)
        cached("vazio", 60, produzir)
        self.assertEqual(len(chamadas), 1)

    def test_falha_do_produtor_nao_e_cacheada(self) -> None:
        """Erro na origem não pode contaminar a janela do TTL."""
        tentativas = []

        def instavel():
            tentativas.append(1)
            if len(tentativas) == 1:
                raise RuntimeError("origem fora")
            return "ok"

        with self.assertRaises(RuntimeError):
            cached("instavel", 60, instavel)

        self.assertEqual(cached("instavel", 60, instavel), "ok")
        self.assertEqual(len(tentativas), 2)

    def test_cache_fora_do_ar_na_leitura_nao_derruba(self) -> None:
        """Redis inacessível degrada para 'não tinha em cache'."""
        with patch("apps.integrations.cache.cache.get", side_effect=ConnectionError("redis fora")):
            with self.assertLogs("apps.integrations.cache", level="WARNING"):
                self.assertEqual(cached("k2", 60, lambda: "valor"), "valor")

    def test_cache_fora_do_ar_na_gravacao_nao_derruba(self) -> None:
        """Não gravar é perda de desempenho, não de correção."""
        with patch("apps.integrations.cache.cache.set", side_effect=ConnectionError("redis fora")):
            with self.assertLogs("apps.integrations.cache", level="WARNING"):
                self.assertEqual(cached("k3", 60, lambda: "valor"), "valor")

    def test_cache_totalmente_fora_ainda_serve_a_aplicacao(self) -> None:
        """Com leitura e gravação falhando, tudo vira ida à origem."""
        chamadas = []

        def produzir():
            chamadas.append(1)
            return "valor"

        with (
            patch("apps.integrations.cache.cache.get", side_effect=ConnectionError()),
            patch("apps.integrations.cache.cache.set", side_effect=ConnectionError()),
            self.assertLogs("apps.integrations.cache", level="WARNING"),
        ):
            self.assertEqual(cached("k4", 60, produzir), "valor")
            self.assertEqual(cached("k4", 60, produzir), "valor")

        self.assertEqual(len(chamadas), 2)
