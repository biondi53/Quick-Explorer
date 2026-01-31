---
description: Realiza un release manual compilando localmente y subiendo el instalador a GitHub
---
Este workflow debe usarse cuando el usuario pida un "release manual" o pida subir los instaladores generados en su máquina local.

1. **Incrementar Versión**: Actualizar `version` en `package.json` y `src-tauri/tauri.conf.json`.
2. **Generar Archivos**: Crear o actualizar `CHANGELOG.md` con los cambios del día.
3. **Compilar Localmente (Opcional)**:
   > [!IMPORTANT]
   > Si el usuario ya generó los instaladores para la versión actual, **saltar este paso**. Solo ejecutar si se requiere una compilación limpia con la nueva versión.
   
   ```powershell
   npm run build; npx tauri build
   ```
4. **Sincronizar Git**:
   ```powershell
   git add .
   git commit -m "chore: release v[VERSION]"
   git push origin main
   git tag v[VERSION]
   git push origin v[VERSION]
   ```
5. **Crear Release en GitHub con Asset Local**:
   ```powershell
   gh release create v[VERSION] "src-tauri/target/release/bundle/msi/Quick Explorer_[VERSION]_x64_en-US.msi" -F CHANGELOG.md --title "SpeedExplorer v[VERSION]"
   ```
