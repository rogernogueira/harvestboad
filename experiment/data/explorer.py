import os
os.chdir("/app/harvestboard/experiment/")
from ..exp1.base_fontes import quadro, evidencias
import json
import pandas as pd
q = quadro()
evidencias(q)                              # tipo × evidência
q.query("amostravel").natureza.value_counts()
q.query("~classificado").classe_de_falha.value_counts()
data = json.load(open("data/indice-repositorios.json"))
repositorios = data["repositorios"]
print(repositorios[1].keys())
df = pd.DataFrame(repositorios)
tx_validade = df["lastValidSize"].sum()/df['lastSize'].sum() 
TransformationRate = df["lastTransformedSize"].sum() / df['lastSize'].sum()

