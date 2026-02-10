---
description: Crear un nuevo release en GitHub con changelog, instalador MSI y ejecutable portable
---

# Workflow: Crear Release en GitHub

Este workflow documenta el proceso completo para crear un nuevo release de Quick Explorer en GitHub.

## Prerequisitos

- El usuario ya debe haber compilado la aplicación con `npm run tauri build`
- El changelog debe estar actualizado en `CHANGELOG.md`

## Pasos

### 1. Actualizar versiones en archivos de configuración

Actualizar la versión en los siguientes archivos (ejemplo: de 0.1.6 a 0.1.7):

- `package.json` → campo `version`
- `src-tauri/Cargo.toml` → campo `version`
- `src-tauri/tauri.conf.json` → campo `version`

### 2. Actualizar el CHANGELOG.md

Asegurarse de que `CHANGELOG.md` tenga:
- El título correcto: `# 🚀 Quick Explorer v[VERSION]` (usar "Quick Explorer", no "SpeedExplorer")
- La fecha actualizada
- Todas las nuevas funcionalidades, mejoras y correcciones documentadas
- El footer actualizado: `*Quick Explorer Project © 2026 - Versión [VERSION]*`

### 3. Crear commit y tag

```bash
git add .
git commit -m "chore: release v[VERSION]"
git tag v[VERSION]
git push origin main
git push origin v[VERSION]
```

### 4. Crear el release en GitHub

Subir **AMBOS** archivos al release:

1. **Instalador MSI** (ubicado en `src-tauri/target/release/bundle/msi/Quick Explorer_[VERSION]_x64_en-US.msi`)
2. **Ejecutable portable** (ubicado en `src-tauri/target/release/d-speedexplorer.exe`)

Primero, extraer solo el changelog de la versión actual para las notas del release:

```powershell
# Extraer la primera sección (hasta el primer '---') del CHANGELOG.md
(Get-Content CHANGELOG.md -Raw) -split '---' | Select-Object -First 1 | Out-File -FilePath LATEST_CHANGELOG.md -Encoding utf8
```

Comando para crear el release:

```bash
# Crear release con el instalador MSI usando solo el changelog reciente
gh release create v[VERSION] "src-tauri/target/release/bundle/msi/Quick Explorer_[VERSION]_x64_en-US.msi" --title "Quick Explorer v[VERSION]" --notes-file "LATEST_CHANGELOG.md"

# Agregar el ejecutable portable
gh release upload v[VERSION] "src-tauri/target/release/d-speedexplorer.exe#Quick.Explorer_[VERSION]_x64.exe"

# Eliminar el archivo temporal
Remove-Item LATEST_CHANGELOG.md
```

### 5. Verificar el release

```bash
gh release view v[VERSION]
```

Confirmar que:
- El título sea "Quick Explorer v[VERSION]" (no "SpeedExplorer")
- El changelog esté completo y correcto
- Ambos assets estén disponibles:
  - `Quick.Explorer_[VERSION]_x64.exe` (portable, ~17 MB)
  - `Quick.Explorer_[VERSION]_x64_en-US.msi` (instalador, ~6 MB)

## Notas Importantes

- **Siempre usar "Quick Explorer"** como nombre comercial, no "SpeedExplorer"
- **Subir ambos archivos**: MSI para usuarios regulares, EXE para usuarios avanzados que prefieren portabilidad
- El ejecutable portable es más grande porque incluye todo empaquetado en un solo archivo
- Quick Explorer es una aplicación portable que guarda su configuración en localStorage
