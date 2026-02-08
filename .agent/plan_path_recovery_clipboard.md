# Plan: Habilitar Copia/Movimiento de Archivos con Rutas Absolutas

**Fecha**: 2026-02-08  
**Estado**: Pendiente de Aprobación

## Situación Actual

- ✅ El cursor de "prohibido" fue eliminado con `dragDropEnabled: false`
- ✅ El evento HTML5 `drop` se dispara correctamente
- ❌ HTML5 solo nos da nombres de archivos (por seguridad del navegador), NO rutas absolutas
- ❌ Sin rutas absolutas, Rust no puede ejecutar la copia/movimiento

## Solución Propuesta: Workaround de Clipboard

En lugar de intentar "desbloquear" el sistema nativo de Tauri (que ya falló muchas veces), vamos a usar un workaround que **NO requiere cambiar `dragDropEnabled`**:

### Paso 1: Crear comando Rust para leer rutas del portapapeles
Cuando Windows arrastra archivos, guarda las rutas en el portapapeles del sistema (formato `CF_HDROP`). Podemos leer esas rutas desde Rust justo cuando el usuario suelta los archivos.

### Paso 2: Llamar al comando desde el handler HTML5
Al detectar el `drop` en JavaScript, inmediatamente llamamos al nuevo comando Rust para obtener las rutas reales.

### Paso 3: Ejecutar la copia/movimiento con las rutas reales
Con las rutas absolutas del portapapeles, llamamos a `drop_items` existente.

---

## Cambios Propuestos

### [NEW] lib.rs - Nuevo comando `get_dropped_file_paths`
```rust
#[tauri::command]
fn get_dropped_file_paths() -> Result<Vec<String>, String> {
    // Lee CF_HDROP del portapapeles de Windows
    // Devuelve las rutas absolutas de los archivos arrastrados
}
```

### [MODIFY] App.tsx - Actualizar handler de drop
```typescript
const handleDrop = async (e: DragEvent) => {
  e.preventDefault();
  // Llamar a Rust para obtener rutas reales
  const paths = await invoke<string[]>('get_dropped_file_paths');
  if (paths.length > 0 && targetPath) {
    await invoke('drop_items', { files: paths, targetPath });
    refreshCurrentTab();
  }
};
```

---

## Verificación

1. Arrastrar un archivo desde el Explorador
2. Verificar que la consola muestre las rutas absolutas (ej: `C:\Users\...`)
3. Verificar que el archivo aparezca en la carpeta de destino

---

## Riesgo Conocido

> [!WARNING]
> El portapapeles se vacía rápidamente después del drop. Si hay un delay, las rutas podrían perderse. Debemos leer el portapapeles inmediatamente al detectar el drop.
