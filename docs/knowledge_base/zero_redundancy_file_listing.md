# Zero-Redundancy File Listing

## Problema

La función `list_files_impl` en `sta_worker.rs` realiza **dos lecturas de disco por archivo**:

1. **Enumeración Shell**: Itera con `IEnumShellItems`, obteniendo un `IShellItem` por archivo.
2. **Segunda lectura**: Convierte el `IShellItem` a una ruta string, y luego llama a `get_file_entry(path)` que internamente hace `path.metadata()` — repitiendo la búsqueda en disco.

En una carpeta con 1000 archivos, esto genera ~2000 operaciones de I/O en lugar de ~1000.

## Solución

Eliminar la llamada redundante a `get_file_entry(path)` y extraer los metadatos directamente del `IShellItem` que ya tenemos en el loop de enumeración.

## Cambios Propuestos

### [MODIFY] [sta_worker.rs](file:///d:/SpeedExplorer/src-tauri/src/sta_worker.rs)

Reemplazar el bloque actual (líneas ~611-660) que hace:

```rust
// ACTUAL (lento):
while enum_items.Next(...) {
    let name = child_item.GetDisplayName(SIGDN_NORMALDISPLAY);
    let full_path = child_item.GetDisplayName(SIGDN_FILESYSPATH);
    // ... filtro de ocultos ...
    if let Ok(entry) = get_file_entry(path_obj) {  // ❌ SEGUNDO VIAJE AL DISCO
        files.push(entry);
    }
}
```

Por una versión que usa `std::fs::metadata` sobre el path pero **en paralelo con Rayon**, o mejor aún, usa `FindFirstFileW/FindNextFileW` que devuelve todos los metadatos en una sola llamada del sistema:

```rust
// PROPUESTO (rápido):
// Opción A: Usar WIN32_FIND_DATAW del propio sistema
// Opción B: Mantener IShellItem pero construir FileEntry inline

while enum_items.Next(...) {
    let name = child_item.GetDisplayName(SIGDN_NORMALDISPLAY);
    let full_path = child_item.GetDisplayName(SIGDN_FILESYSPATH);
    // ... filtro de ocultos ...

    // Construir FileEntry directamente con std::fs::metadata
    // pero SOLO UNA VEZ, inline:
    let path_obj = std::path::Path::new(&full_path);
    let metadata = path_obj.metadata();  // Una sola lectura
    
    let entry = FileEntry {
        name,
        path: full_path,
        is_dir: metadata.is_dir(),
        size: if metadata.is_dir() { 0 } else { metadata.len() },
        // ... construir todo inline ...
    };
    files.push(entry);
}
```

### Opción Alternativa (Máxima Velocidad): FindFirstFileW

En lugar de usar la Shell API para enumerar, usar `FindFirstFileW` / `FindNextFileW` que devuelve un struct `WIN32_FIND_DATAW` con:
- Nombre
- Tamaño
- Fecha de creación
- Fecha de modificación
- Atributos (oculto, directorio, etc.)

**Todo en una sola llamada**, sin necesidad de `metadata()` adicional.

```rust
// MÁXIMA VELOCIDAD:
let search_path = format!("{}\\*", path);
let mut find_data: WIN32_FIND_DATAW = ...;
let handle = FindFirstFileW(&search_path, &mut find_data);

loop {
    // find_data YA CONTIENE todo: nombre, tamaño, fechas, atributos
    let entry = FileEntry {
        name: String::from_utf16_lossy(&find_data.cFileName),
        size: (find_data.nFileSizeHigh as u64) << 32 | find_data.nFileSizeLow as u64,
        // ... etc, sin ninguna llamada extra ...
    };
    files.push(entry);
    
    if !FindNextFileW(handle, &mut find_data) { break; }
}
```

> [!WARNING]
> La Opción FindFirstFileW es más rápida pero pierde la capacidad de detectar atajos (.lnk) y archivos especiales del Shell. Habría que manejar esos casos por separado.

### [MODIFY] [lib.rs](file:///d:/SpeedExplorer/src-tauri/src/lib.rs)

La función `get_file_entry` (líneas 99-166) **no se elimina**, ya que se usa en otros contextos (ej: `save_clipboard_image`). Solo se deja de usar desde `list_files_impl`.

## Comparación de Opciones

| Criterio | Opción A (Inline metadata) | Opción B (FindFirstFileW) |
|---|---|---|
| **Velocidad** | ~1.5x más rápido | ~2-3x más rápido |
| **Complejidad** | Baja (cambio mínimo) | Media |
| **Riesgo** | Muy bajo | Bajo (requiere manejo de `.lnk`) |
| **Compatibilidad Shell** | Total (sigue usando IShellItem) | Parcial (pierde detección de shortcuts) |

## Recomendación

Empezar con la **Opción A** (inline metadata). Es el cambio más seguro y ya eliminamos el cuello de botella principal. Si después necesitamos más velocidad, migramos a FindFirstFileW.

## Verificación

1. Medir tiempo de carga de la carpeta Descargas antes y después del cambio.
2. Verificar que archivos ocultos siguen siendo filtrados correctamente.
3. Verificar que shortcuts (.lnk) siguen detectándose.
4. Verificar que el ordenamiento sigue funcionando correctamente.

## Estado

- [x] Implementar Opción A
- [x] Cargo check pasa sin errores
- [ ] Testear en carpeta con muchos archivos
- [ ] Comparar tiempos
