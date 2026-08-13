# Patch : recettes capables de piloter une variable DV (force_dv)

## Pourquoi
Le bloc DV du programme Gialix_Distant (varname "consigne abaissée/normale", RF102) réécrit sa sortie à
chaque cycle PLC depuis sa propre valeur interne. Une recette qui ne touche que `setpoints`/`memory` est
donc écrasée au cycle suivant. Ce patch ajoute un 3e champ `dv` aux recettes, appliqué via
`engine.force_dv()`, qui est conçu pour résister au cycle PLC.

## Fichiers
- `recipes.py` → à copier tel quel dans `/opt/rpi-plc/rpi_server/recipes.py` (remplace l'existant).
- `server_py.patch` → patch d'une ligne pour `/opt/rpi-plc/rpi_server/server.py`
  (route `/api/recipes/save`), à appliquer avec `patch -p1 < server_py.patch` depuis la racine du projet,
  ou à reporter à la main (une seule ligne changée).

## Déploiement
```bash
# depuis le PC, copier recipes.py sur le Pi
scp recipes.py pi@<IP_DU_PI3>:/opt/rpi-plc/rpi_server/recipes.py

# sur le Pi : appliquer le patch server.py puis relancer
cd /opt/rpi-plc
sudo patch -p1 < server_py.patch      # ou éditer la ligne à la main
sudo systemctl restart rpi-plc
```

## Recréer les 2 recettes avec le champ dv
```bash
curl -X POST http://<IP_DU_PI3>:5000/api/recipes/save \
  -H "Content-Type: application/json" \
  -d '{"name":"Chauffage_Reduit","description":"Consigne Gialix abaissee (horloge fermee)","setpoints":{},"memory":{},"dv":{"consigne abaissée/normale":true}}'

curl -X POST http://<IP_DU_PI3>:5000/api/recipes/save \
  -H "Content-Type: application/json" \
  -d '{"name":"Chauffage_Normal","description":"Consigne Gialix normale (horloge ouverte)","setpoints":{},"memory":{},"dv":{"consigne abaissée/normale":false}}'
```

## Test rapide
```bash
curl -X POST http://<IP_DU_PI3>:5000/api/recipes/apply -H "Content-Type: application/json" -d '{"name":"Chauffage_Reduit"}'
# attendre 2-3 cycles (200-300ms) puis relire l'état :
curl http://<IP_DU_PI3>:5000/api/status | grep -A2 "consigne"
```
