"""Base das views que leem do Harvester."""

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .harvester import HarvesterError


class HarvesterBackedAPIView(APIView):
    """Traduz falhas do Harvester em status HTTP significativos.

    A distinção importa para o frontend: 503 convida a tentar de novo, 502 diz
    que a origem respondeu algo que não dá para usar, e 404 é resposta final.
    """

    permission_classes = [permissions.IsAuthenticated]

    def handle_exception(self, exc):
        if isinstance(exc, HarvesterError):
            if exc.status_code is None:
                return Response(
                    {"detail": f"Harvester inacessível: {exc}"},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            if exc.status_code == 404:
                return Response(
                    {"detail": "Recurso não encontrado no Harvester."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return super().handle_exception(exc)
