from base_fontes import ler, lacunas

dados = ler()
lacu = lacunas(dados)
print(lacu)

dados["platform_product"].value_counts().sum()
instituicoes = dados["institution_name"].value_counts()

