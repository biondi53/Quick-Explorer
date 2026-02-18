# Plan de Optimización: Carga de Carpetas Instantánea

**Objetivo**: Lograr que el contenido de las carpetas se visualice de manera inmediata tras la navegación, eliminando el tiempo de espera "en blanco" en carpetas con miles de archivos.

## Análisis del Problema Actual

Actualmente, la función `list_files` en el backend (Rust) opera de manera **síncrona y atómica**:

1.  Recibe la ruta.
2.  Itera sobre *todos* los elementos usando `IShellItem`.
3.  Para cada elemento, realiza múltiples llamadas costosas:
    *   `GetDisplayName` (COM).
    *   `std::fs::metadata` (I/O adicional para obtener fechas/tamaños).
4.  Acumula todo en un `Vec<FileEntry>`.
5.  Serializa y envía el vector completo al frontend.

**Cuello de Botella**: El usuario no ve nada hasta que el *último* archivo ha sido procesado. En una carpeta con 10,000 archivos, esto genera un "lag" perceptible.

## Solución Propuesta: Streaming por Lotes (Batching)

Cambiaremos el modelo de "Todo o Nada" a "Streaming Progresivo".

### 1. Backend (Rust)

*   **Nuevo Comando**: `start_list_files(path, channel_id)`.
    *   Retorna inmediatamente `Ok()` para liberar el hilo de la UI.
    *   Inicia un **hilo en segundo plano** (o tarea asíncrona) para la lectura.
*   **Iteración Optimizada**:
    *   Reemplazar `IShellItem` (COM, lento) por `FindNextFileW` (Win32, rápido) para la iteración inicial.
    *   `FindNextFileW` ya devuelve metadatos básicos (tamaño, fechas) en la misma estructura de iteración, eliminando la necesidad de llamar a `std::fs::metadata` por cada archivo.
*   **Envío por Lotes**:
    *   En lugar de esperar al final, enviar eventos al frontend cada X archivos (ej: cada 100 archivos o cada 50ms).
    *   Evento: `folder:batch`.

### 2. Frontend (React/Tauri)

*   **Estado Incremental**:
    *   Al navegar, limpiar la lista actual inmediatamente.
    *   Escuchar el evento `folder:batch` y hacer *append* (agregar al final) de los nuevos archivos al estado.
    *   El `Virtualizer` (ya implementado en `FileTable`/`FileGrid`) manejará eficientemente la lista creciente sin degradar el rendimiento de renderizado.

## Fases de Implementación

### Fase 1: Backend Streaming
Implementar la lógica de iteración rápida y envío de eventos en Rust.

files:
- `src-tauri/src/lib.rs`: Nuevo comando `stream_files`.
- `src-tauri/src/sta_worker.rs`: Implementación de iteración con `FindNextFileW` y emisión de eventos.

### Fase 2: Adaptación Frontend
Actualizar el hook `useTabs` para manejar la carga incremental.

files:
- `src/hooks/useTabs.ts`: Reemplazar `invoke('list_files')` por la suscripción a eventos.
- `src/types.ts`: Actualizar definiciones si es necesario.

### Fase 3: Refinamiento de UX
Asegurar que la barra de carga y los indicadores de estado reflejen que la carpeta se está "llenando" y no solo "cargando".

---

**Nota Técnica**: Mantendremos `IShellItem` solo para operaciones complejas posteriores (menú contextual, propiedades), pero para la lista inicial, `FindNextFileW` es órdenes de magnitud más rápido.
