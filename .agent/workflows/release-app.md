---
description: Proceso para generar un nuevo release (incremento de versión, tag y push)
---
Este workflow automatiza la creación de un nuevo release en GitHub.

1. **Incrementar Versión**:
   - Actualizar `version` en `package.json`
   - Actualizar `version` en `src-tauri/tauri.conf.json`

2. **Commit y Tag**:
   - Crear un commit con el mensaje "chore: bump version to v[VERSION]"
   - Crear un tag git `v[VERSION]`

3. **Push**:
   - Hacer push de la rama `main` y del nuevo tag.

// turbo
4. Ejecutar el comando para subir cambios y activar la GitHub Action:
```powershell
$version = (Get-Content package.json | ConvertFrom-Json).version
git add .
git commit -m "chore: bump version to v$version"
git tag "v$version"
git push origin main --tags
```
