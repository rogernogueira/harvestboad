from rest_framework import serializers

from .models import HarvestRequest


class HarvestRequestSerializer(serializers.ModelSerializer):
    """Demanda como a tela a consome. camelCase à mão, com `source`."""

    harvesterRepositoryId = serializers.CharField(
        source="harvester_repository_id", read_only=True
    )
    statusDisplay = serializers.CharField(source="get_status_display", read_only=True)
    requesterUsername = serializers.CharField(source="requester.username", read_only=True)
    snapshotId = serializers.CharField(source="snapshot_id", read_only=True)
    resolvedByUsername = serializers.CharField(source="resolved_by.username", read_only=True)
    resolvedAt = serializers.DateTimeField(source="resolved_at", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = HarvestRequest
        fields = [
            "id",
            "harvesterRepositoryId",
            "acronym",
            "requesterUsername",
            "note",
            "status",
            "statusDisplay",
            "snapshotId",
            "reason",
            "resolvedByUsername",
            "resolvedAt",
            "createdAt",
        ]
        read_only_fields = fields


class HarvestRequestWriteSerializer(serializers.ModelSerializer):
    """Abertura da demanda pelo gestor. Só o repositório e a justificativa."""

    harvesterRepositoryId = serializers.CharField(
        source="harvester_repository_id", max_length=64
    )
    acronym = serializers.CharField(max_length=32, required=False, allow_blank=True)
    note = serializers.CharField(max_length=1000, required=False, allow_blank=True)

    class Meta:
        model = HarvestRequest
        fields = ["harvesterRepositoryId", "acronym", "note"]


class AtenderSerializer(serializers.Serializer):
    """O número da coleta é o retorno concreto que o gestor esperava."""

    snapshotId = serializers.CharField(max_length=64)

    def validate_snapshotId(self, value: str) -> str:
        limpo = value.strip().lstrip("#")
        if not limpo:
            raise serializers.ValidationError("Informe o número da coleta.")
        return limpo


class RecusarSerializer(serializers.Serializer):
    """Motivo obrigatório: sem ele o gestor repete o pedido sem saber por quê."""

    reason = serializers.CharField(max_length=1000)

    def validate_reason(self, value: str) -> str:
        limpo = value.strip()
        if not limpo:
            raise serializers.ValidationError("Informe o motivo da recusa.")
        return limpo
